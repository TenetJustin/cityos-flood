"""Contract tests for the five-city realtime ingestion and analysis core.

Every test uses an in-memory fake provider.  Nothing here reads the network,
the filesystem, environment variables, credentials, or production data.
"""
import json
import socket
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from backend.app.realtime_analysis import build_realtime_snapshot
from backend.app.realtime_ingestion import (
    CITY_ORDER,
    ZHEJIANG_CITY_ORDER,
    PHENOMENON_ORDER,
    InvalidCityScope,
    normalize_city_order,
    poll_provider,
)
from backend.app.realtime_store import load_snapshot, save_records

TZ8 = timezone(timedelta(hours=8))
OBSERVED = datetime(2026, 10, 19, 12, 0, tzinfo=TZ8)
PUBLISHED = datetime(2026, 10, 19, 12, 2, tzinfo=TZ8)
RECEIVED = datetime(2026, 10, 19, 12, 5, tzinfo=TZ8)
PROCESSED = datetime(2026, 10, 19, 12, 6, tzinfo=TZ8)
UNTIL = datetime(2026, 10, 19, 12, 10, tzinfo=TZ8)
AS_OF = datetime(2026, 10, 19, 12, 7, tzinfo=TZ8)

_COUNTER = iter(range(1, 10000))


def _values(phenomenon):
    return {
        "rainfall": (10.0, "mm/h"),
        "tide_level": (2.5, "m"),
        "river_level": (1.5, "m"),
        "flood_depth": (0.2, "m"),
        "road_closure": (False, "boolean"),
    }.get(phenomenon, (10.0, "mm/h"))


def _candidate(**overrides):
    phenomenon = overrides.get("phenomenon", "rainfall")
    city_id = overrides.get("city_id", "shenzhen")
    value, unit = _values(phenomenon)
    record = {
        "provider_record_id": f"record-{next(_COUNTER)}",
        "provider_record_version": "v1",
        "city_id": city_id,
        "phenomenon": phenomenon,
        "station_id": f"{city_id}-{phenomenon}-station",
        "geometry_or_area": f"{city_id}-{phenomenon}-area",
        "longitude": 114.05,
        "latitude": 22.55,
        "horizontal_crs": "EPSG:4326",
        "vertical_datum": (
            "local_datum"
            if phenomenon in {"tide_level", "river_level", "flood_depth"}
            else None
        ),
        "value": value,
        "unit": unit,
        "observed_at": OBSERVED,
        "provider_published_at": PUBLISHED,
        "source_name": "fake-source",
        "source_reference": "https://example.invalid/feed",
        "license_id": "test-only-no-redistribution",
        "quality_flags": ["quality_controlled"],
    }
    record.update(overrides)
    return record


def _all_combo_records(**overrides):
    return [
        _candidate(city_id=city, phenomenon=phenomenon, **overrides)
        for city in CITY_ORDER
        for phenomenon in PHENOMENON_ORDER
    ]


class FakeProvider:
    def __init__(
        self,
        records=None,
        *,
        provider_id="fake-provider",
        error=None,
        response=None,
        response_set=False,
    ):
        self.records = list(records or [])
        self.provider_id = provider_id
        self.error = error
        self.response = response
        self.response_set = response_set
        self.calls = []

    def fetch(self, *, since, until):
        self.calls.append({"since": since, "until": until})
        if self.error is not None:
            raise self.error
        if self.response_set:
            return self.response
        return list(self.records)


def _poll(provider, **overrides):
    params = {
        "since": None,
        "until": UNTIL,
        "received_at": RECEIVED,
        "processed_at": PROCESSED,
        "freshness_limits_minutes": None,
    }
    params.update(overrides)
    return poll_provider(provider, **params)


def _poll_records(records, **overrides):
    return _poll(FakeProvider(records), **overrides)


def _codes(result):
    return {item["code"] for item in result["rejected_records"]}


def _assert_flags_false(testcase, result):
    for key in (
        "forecast_input_ready",
        "model_assimilation_ready",
        "public_warning_ready",
        "automatic_dispatch_ready",
    ):
        testcase.assertIs(result[key], False)
    snapshot = result.get("snapshot")
    if snapshot is not None:
        for key in (
            "forecast_input_ready",
            "model_assimilation_ready",
            "public_warning_ready",
            "automatic_dispatch_ready",
        ):
            testcase.assertIs(snapshot[key], False)


class RealtimeIngestionContractTest(unittest.TestCase):
    def test_all_five_cities_accept_valid_records(self):
        records = [_candidate(city_id=city) for city in CITY_ORDER]
        result = _poll_records(records)
        self.assertEqual(result["accepted_count"], len(CITY_ORDER))
        self.assertEqual(result["rejected_count"], 0)
        self.assertEqual(
            {record["city_id"] for record in result["accepted_records"]},
            set(CITY_ORDER),
        )
        for record in result["accepted_records"]:
            self.assertTrue(record["observed_at"].endswith("+08:00"))
            self.assertTrue(record["available_at"].endswith("+08:00"))
            self.assertEqual(record["available_at"], "2026-10-19T12:06:00+08:00")
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["snapshot"]["status"], "degraded")
        _assert_flags_false(self, result)

    def test_unknown_city_phenomenon_unit_and_extra_field_fail_closed(self):
        records = [
            _candidate(city_id="beijing"),
            _candidate(phenomenon="snow"),
            _candidate(unit="m"),
            _candidate(access_token="SECRET-TOKEN"),
        ]
        result = _poll_records(records)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["accepted_count"], 0)
        self.assertEqual(result["rejected_count"], 4)
        self.assertEqual(
            _codes(result),
            {
                "unknown_city",
                "unknown_phenomenon",
                "invalid_unit",
                "extra_field",
            },
        )
        self.assertNotIn("SECRET-TOKEN", json.dumps(result, ensure_ascii=False))

    def test_non_string_extra_keys_and_missing_fields_fail_closed(self):
        non_string = _candidate()
        non_string[17] = "nope"
        result = _poll_records([non_string])
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("extra_field", _codes(result))
        self.assertEqual(result["accepted_count"], 0)

        missing = _candidate()
        del missing["unit"]
        result = _poll_records([missing])
        self.assertIn("missing_field", _codes(result))
        self.assertEqual(result["accepted_count"], 0)

    def test_utc_input_is_converted_to_asia_shanghai(self):
        utc = timezone.utc
        record = _candidate(
            observed_at=datetime(2026, 10, 19, 4, 0, tzinfo=utc),
            provider_published_at=datetime(2026, 10, 19, 4, 2, tzinfo=utc),
        )
        result = _poll(
            FakeProvider([record]),
            received_at=datetime(2026, 10, 19, 4, 5, tzinfo=utc),
            processed_at=datetime(2026, 10, 19, 4, 6, tzinfo=utc),
            until=datetime(2026, 10, 19, 4, 10, tzinfo=utc),
        )
        self.assertEqual(result["accepted_count"], 1)
        accepted = result["accepted_records"][0]
        self.assertEqual(accepted["observed_at"], "2026-10-19T12:00:00+08:00")
        self.assertEqual(
            accepted["provider_published_at"], "2026-10-19T12:02:00+08:00"
        )
        self.assertEqual(accepted["received_at"], "2026-10-19T12:05:00+08:00")
        self.assertEqual(accepted["available_at"], "2026-10-19T12:06:00+08:00")
        self.assertEqual(
            result["query_window"]["until"], "2026-10-19T12:10:00+08:00"
        )

    def test_naive_datetimes_are_rejected(self):
        naive_observed = _candidate(
            observed_at=datetime(2026, 10, 19, 12, 0)
        )
        result = _poll_records([naive_observed])
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("naive_datetime", _codes(result))

        naive_published = _candidate(
            provider_published_at=datetime(2026, 10, 19, 12, 2)
        )
        result = _poll_records([naive_published])
        self.assertIn("naive_datetime", _codes(result))

        provider = FakeProvider([_candidate()])
        result = _poll(
            provider, received_at=datetime(2026, 10, 19, 12, 5)
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("naive_datetime", _codes(result))
        self.assertEqual(provider.calls, [])

        provider = FakeProvider([_candidate()])
        result = _poll(provider, until=datetime(2026, 10, 19, 12, 10))
        self.assertIn("naive_datetime", _codes(result))
        self.assertEqual(provider.calls, [])

    def test_time_order_constraints_fail_closed(self):
        future = _candidate(observed_at=datetime(2026, 10, 19, 12, 6, tzinfo=TZ8))
        result = _poll_records([future])
        self.assertIn("future_observation", _codes(result))

        published_late = _candidate(
            provider_published_at=datetime(2026, 10, 19, 12, 6, tzinfo=TZ8)
        )
        result = _poll_records([published_late])
        self.assertIn("invalid_time_order", _codes(result))

        provider = FakeProvider([_candidate()])
        result = _poll(
            provider,
            received_at=datetime(2026, 10, 19, 12, 7, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 6, tzinfo=TZ8),
        )
        self.assertIn("invalid_time_order", _codes(result))
        self.assertEqual(provider.calls, [])

        provider = FakeProvider([_candidate()])
        result = _poll(
            provider,
            processed_at=datetime(2026, 10, 19, 12, 11, tzinfo=TZ8),
        )
        self.assertIn("invalid_time_order", _codes(result))
        self.assertEqual(provider.calls, [])

        provider = FakeProvider([_candidate()])
        result = _poll(
            provider,
            since=datetime(2026, 10, 19, 12, 11, tzinfo=TZ8),
            until=datetime(2026, 10, 19, 12, 10, tzinfo=TZ8),
        )
        self.assertIn("invalid_time_order", _codes(result))
        self.assertEqual(provider.calls, [])

    def test_invalid_values_are_never_coerced(self):
        bad_values = [None, float("nan"), float("inf"), "", "12.3", True]
        for value in bad_values:
            with self.subTest(value=value):
                result = _poll_records([_candidate(value=value)])
                self.assertEqual(result["status"], "unavailable")
                self.assertIn("invalid_value", _codes(result))
                self.assertEqual(result["accepted_count"], 0)

        for value in (1, 0, "true", None):
            with self.subTest(road_closure=value):
                result = _poll_records([
                    _candidate(phenomenon="road_closure", value=value)
                ])
                self.assertIn("invalid_value", _codes(result))

        zero = _poll_records([_candidate(value=0.0)])
        self.assertEqual(zero["accepted_count"], 1)
        self.assertEqual(
            zero["snapshot"]["summaries"][0]["mean"], 0.0
        )

    def test_coordinate_crs_and_vertical_datum_contract(self):
        for longitude, latitude in ((181.0, 22.5), (114.0, 91.0),
                                    (float("nan"), 22.5), (True, 22.5)):
            with self.subTest(longitude=longitude, latitude=latitude):
                result = _poll_records([
                    _candidate(longitude=longitude, latitude=latitude)
                ])
                self.assertIn("invalid_coordinate", _codes(result))

        for crs in ("WGS84", "EPSG:abc", "epsg:4326"):
            with self.subTest(crs=crs):
                result = _poll_records([_candidate(horizontal_crs=crs)])
                self.assertIn("invalid_crs", _codes(result))

        for phenomenon in ("tide_level", "river_level"):
            with self.subTest(phenomenon=phenomenon):
                missing = _poll_records([
                    _candidate(phenomenon=phenomenon, vertical_datum=None)
                ])
                self.assertIn("invalid_vertical_datum", _codes(missing))
                empty = _poll_records([
                    _candidate(phenomenon=phenomenon, vertical_datum="  ")
                ])
                self.assertIn("invalid_vertical_datum", _codes(empty))

        tide = _poll_records([
            _candidate(phenomenon="tide_level", vertical_datum="local_datum")
        ])
        self.assertEqual(tide["accepted_count"], 1)

    def test_quality_flags_are_closed_and_suspect_records_are_excluded(self):
        for flags in ([], ["not_a_flag"], "quality_controlled"):
            with self.subTest(flags=flags):
                result = _poll_records([_candidate(quality_flags=flags)])
                self.assertIn("invalid_quality_flag", _codes(result))

        rejected = _poll_records([
            _candidate(quality_flags=["quality_controlled", "rejected"])
        ])
        self.assertEqual(rejected["accepted_count"], 0)
        self.assertIn("rejected_quality", _codes(rejected))

        suspect = _poll_records([
            _candidate(quality_flags=["quality_controlled", "suspect"])
        ])
        self.assertEqual(suspect["accepted_count"], 1)
        self.assertEqual(suspect["snapshot"]["status"], "unavailable")
        self.assertEqual(
            suspect["snapshot"]["rejected_counts"]["suspect_quality"], 1
        )
        self.assertEqual(suspect["snapshot"]["summaries"], [])

        provisional = _poll_records([
            _candidate(quality_flags=["provisional"])
        ])
        self.assertEqual(provisional["accepted_count"], 1)
        summary = provisional["snapshot"]["summaries"][0]
        self.assertEqual(summary["provisional_count"], 1)
        self.assertEqual(provisional["snapshot"]["status"], "degraded")

    def test_exact_duplicates_collapse_and_conflicts_reject_the_batch(self):
        first = _candidate(provider_record_id="same-id")
        second = _candidate(provider_record_id="same-id")
        result = _poll_records([first, second])
        self.assertEqual(result["accepted_count"], 1)
        self.assertEqual(result["duplicate_count"], 1)
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["snapshot"]["summaries"][0]["record_count"], 1)

        conflict = _candidate(provider_record_id="same-id", value=11.0)
        result = _poll_records([first, conflict])
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["accepted_count"], 0)
        self.assertIn("duplicate_conflict", _codes(result))

    def test_freshness_limits_are_strict(self):
        custom = {phenomenon: 10 for phenomenon in PHENOMENON_ORDER}
        result = _poll_records([_candidate()], freshness_limits_minutes=custom)
        self.assertEqual(result["accepted_count"], 1)
        self.assertEqual(
            result["snapshot"]["provenance"]["freshness_limits_minutes"], custom
        )

        bad_configs = [
            {key: 10 for key in PHENOMENON_ORDER if key != "rainfall"},
            {**{key: 10 for key in PHENOMENON_ORDER}, "extra": 10},
            {**{key: 10 for key in PHENOMENON_ORDER}, "rainfall": 0},
            {**{key: 10 for key in PHENOMENON_ORDER}, "rainfall": True},
            {**{key: 10 for key in PHENOMENON_ORDER}, "rainfall": 10.0},
            {**{key: 10 for key in PHENOMENON_ORDER}, "rainfall": "10"},
        ]
        for config in bad_configs:
            with self.subTest(config=config):
                provider = FakeProvider([_candidate()])
                result = _poll(
                    provider, freshness_limits_minutes=config
                )
                self.assertEqual(result["status"], "unavailable")
                self.assertIn("invalid_freshness_config", _codes(result))
                self.assertEqual(provider.calls, [])
                snapshot = build_realtime_snapshot(
                    [], as_of=AS_OF, freshness_limits_minutes=config
                )
                self.assertEqual(snapshot["status"], "unavailable")
                self.assertEqual(
                    snapshot["rejected_counts"]["invalid_freshness_config"], 1
                )

    def test_provider_returns_empty_list_as_unavailable(self):
        result = _poll_records([])
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["accepted_count"], 0)
        self.assertIsNone(result["provider_error"])
        self.assertEqual(result["snapshot"]["status"], "unavailable")
        self.assertEqual(result["snapshot"]["summaries"], [])
        self.assertFalse(result["snapshot"]["descriptive_analysis_available"])


class RealtimeSnapshotContractTest(unittest.TestCase):
    def _full_coverage(self, **overrides):
        poll = _poll_records(_all_combo_records(**overrides))
        self.assertEqual(poll["accepted_count"], 25)
        return poll, poll["accepted_records"]

    def test_full_five_city_coverage_is_current(self):
        poll, records = self._full_coverage()
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        self.assertEqual(snapshot["status"], "current")
        self.assertEqual(len(snapshot["summaries"]), 25)
        self.assertEqual(snapshot["missing_city_phenomena"], [])
        self.assertEqual(
            set(snapshot["city_status"].values()), {"current"}
        )
        self.assertEqual(set(snapshot["city_status"]), set(CITY_ORDER))
        self.assertTrue(snapshot["descriptive_analysis_available"])
        self.assertEqual(
            set(snapshot["summaries"][0]),
            {
                "city_id", "phenomenon", "unit", "vertical_datum",
                "record_count", "station_count", "fresh_count",
                "stale_count", "provisional_count", "latest_observed_at",
                "latest_available_at", "minimum", "maximum", "mean",
                "median_latency_seconds", "source_ids",
            },
        )
        _assert_flags_false(self, snapshot)
        _assert_flags_false(self, poll)

    def test_incomplete_coverage_is_degraded(self):
        result = _poll_records([_candidate()])
        snapshot = result["snapshot"]
        self.assertEqual(snapshot["status"], "degraded")
        self.assertEqual(len(snapshot["summaries"]), 1)
        self.assertEqual(len(snapshot["missing_city_phenomena"]), 24)
        self.assertEqual(snapshot["city_status"]["shenzhen"], "current")
        self.assertEqual(snapshot["city_status"]["shanghai"], "unavailable")
        self.assertTrue(snapshot["descriptive_analysis_available"])

    def test_no_records_returns_unavailable_without_zero_fill(self):
        snapshot = build_realtime_snapshot([], as_of=AS_OF)
        self.assertEqual(snapshot["status"], "unavailable")
        self.assertEqual(snapshot["summaries"], [])
        self.assertEqual(len(snapshot["missing_city_phenomena"]), 25)
        self.assertFalse(snapshot["descriptive_analysis_available"])
        self.assertEqual(
            set(snapshot["city_status"].values()), {"unavailable"}
        )
        _assert_flags_false(self, snapshot)

    def test_stale_history_is_never_current(self):
        old = datetime(2026, 10, 19, 10, 0, tzinfo=TZ8)
        poll, records = self._full_coverage(
            observed_at=old,
            provider_published_at=datetime(2026, 10, 19, 10, 2, tzinfo=TZ8),
        )
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        self.assertEqual(snapshot["status"], "degraded")
        self.assertEqual(
            set(snapshot["city_status"].values()), {"degraded"}
        )
        for summary in snapshot["summaries"]:
            self.assertEqual(summary["fresh_count"], 0)
            self.assertEqual(summary["stale_count"], 1)
            self.assertEqual(
                summary["latest_observed_at"], "2026-10-19T10:00:00+08:00"
            )
        self.assertTrue(snapshot["descriptive_analysis_available"])
        _assert_flags_false(self, poll)

    def test_provisional_data_is_displayed_but_degraded(self):
        poll, records = self._full_coverage(quality_flags=["provisional"])
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        self.assertEqual(snapshot["status"], "degraded")
        self.assertEqual(
            set(snapshot["city_status"].values()), {"degraded"}
        )
        for summary in snapshot["summaries"]:
            self.assertEqual(summary["provisional_count"], 1)
        self.assertTrue(snapshot["descriptive_analysis_available"])

    def test_suspect_and_rejected_quality_never_enter_statistics(self):
        poll, records = self._full_coverage()
        suspect = _candidate(
            station_id="extra-station",
            geometry_or_area="extra-area",
            observed_at=datetime(2026, 10, 19, 12, 1, tzinfo=TZ8),
            value=999.0,
            quality_flags=["quality_controlled", "suspect"],
        )
        suspect_poll = _poll_records([suspect])
        merged = records + suspect_poll["accepted_records"]
        snapshot = build_realtime_snapshot(merged, as_of=AS_OF)
        self.assertEqual(snapshot["status"], "current")
        rainfall = next(
            summary for summary in snapshot["summaries"]
            if summary["city_id"] == "shenzhen"
            and summary["phenomenon"] == "rainfall"
            and summary["unit"] == "mm/h"
        )
        self.assertEqual(rainfall["record_count"], 1)
        self.assertNotIn(999.0, (rainfall["minimum"], rainfall["maximum"],
                                 rainfall["mean"]))
        self.assertEqual(
            snapshot["rejected_counts"]["suspect_quality"], 1
        )

        all_suspect = _poll_records(
            _all_combo_records(
                quality_flags=["quality_controlled", "suspect"]
            )
        )
        snapshot = build_realtime_snapshot(
            all_suspect["accepted_records"], as_of=AS_OF
        )
        self.assertEqual(snapshot["status"], "unavailable")
        self.assertEqual(snapshot["summaries"], [])
        self.assertFalse(snapshot["descriptive_analysis_available"])
        self.assertEqual(
            snapshot["rejected_counts"]["suspect_quality"], 25
        )

        rejected = dict(records[0])
        rejected["quality_flags"] = ["rejected"]
        snapshot = build_realtime_snapshot([rejected], as_of=AS_OF)
        self.assertEqual(snapshot["status"], "unavailable")
        self.assertEqual(
            snapshot["rejected_counts"]["rejected_quality"], 1
        )

    def test_huge_finite_values_do_not_emit_non_finite_metrics(self):
        first = _candidate(
            station_id="huge-1", geometry_or_area="huge-1", value=1e308
        )
        second = _candidate(
            station_id="huge-2", geometry_or_area="huge-2", value=1e308
        )
        records = _poll_records([first, second])["accepted_records"]
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        summary = snapshot["summaries"][0]
        self.assertEqual(summary["minimum"], 1e308)
        self.assertEqual(summary["maximum"], 1e308)
        self.assertIsNone(summary["mean"])
        json.dumps(snapshot, allow_nan=False)

    def test_units_and_vertical_datums_are_not_mixed(self):
        mm = _candidate(
            station_id="rain-mm", geometry_or_area="rain-mm",
            unit="mm", value=20.0,
        )
        mmh = _candidate(
            station_id="rain-mmh", geometry_or_area="rain-mmh",
            unit="mm/h", value=5.0,
        )
        records = _poll_records([mm, mmh])["accepted_records"]
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        self.assertEqual(len(snapshot["summaries"]), 2)
        by_unit = {summary["unit"]: summary for summary in snapshot["summaries"]}
        self.assertEqual(by_unit["mm"]["record_count"], 1)
        self.assertEqual(by_unit["mm/h"]["record_count"], 1)
        self.assertEqual(by_unit["mm"]["mean"], 20.0)
        self.assertEqual(by_unit["mm/h"]["mean"], 5.0)

        tide_a = _candidate(
            phenomenon="tide_level", station_id="tide-a",
            geometry_or_area="tide-a", vertical_datum="datum-a", value=2.0,
        )
        tide_b = _candidate(
            phenomenon="tide_level", station_id="tide-b",
            geometry_or_area="tide-b", vertical_datum="datum-b", value=3.0,
        )
        records = _poll_records([tide_a, tide_b])["accepted_records"]
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        self.assertEqual(len(snapshot["summaries"]), 2)
        self.assertEqual(
            {summary["vertical_datum"] for summary in snapshot["summaries"]},
            {"datum-a", "datum-b"},
        )

    def test_road_closure_reports_counts_not_numeric_mean(self):
        first = _candidate(
            phenomenon="road_closure", station_id="road-1",
            geometry_or_area="road-1", value=True,
        )
        second = _candidate(
            phenomenon="road_closure", station_id="road-2",
            geometry_or_area="road-2", value=False,
        )
        records = _poll_records([first, second])["accepted_records"]
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        summary = snapshot["summaries"][0]
        self.assertIsNone(summary["minimum"])
        self.assertIsNone(summary["maximum"])
        self.assertIsNone(summary["mean"])
        self.assertEqual(summary["true_count"], 1)
        self.assertEqual(summary["false_count"], 1)
        self.assertEqual(summary["record_count"], 2)

    def test_median_latency_is_reported_in_seconds(self):
        first = _candidate(
            station_id="late-1", geometry_or_area="late-1",
            observed_at=datetime(2026, 10, 19, 12, 0, tzinfo=TZ8),
        )
        second = _candidate(
            station_id="late-2", geometry_or_area="late-2",
            observed_at=datetime(2026, 10, 19, 12, 2, tzinfo=TZ8),
        )
        records = _poll_records([first, second])["accepted_records"]
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        summary = snapshot["summaries"][0]
        self.assertEqual(summary["median_latency_seconds"], 300.0)
        self.assertEqual(summary["record_count"], 2)
        self.assertEqual(summary["station_count"], 2)

    def test_available_at_controls_snapshot_inclusion(self):
        poll = _poll_records([_candidate()])
        record = poll["accepted_records"][0]
        before = build_realtime_snapshot(
            [record], as_of=datetime(2026, 10, 19, 12, 5, tzinfo=TZ8)
        )
        self.assertEqual(before["status"], "unavailable")
        self.assertEqual(
            before["rejected_counts"]["not_yet_available"], 1
        )
        self.assertEqual(before["summaries"], [])

        after = build_realtime_snapshot([record], as_of=AS_OF)
        self.assertEqual(after["summaries"][0]["record_count"], 1)
        self.assertEqual(after["status"], "degraded")

    def test_poll_input_order_does_not_change_result(self):
        candidates = _all_combo_records()
        forward = _poll_records(candidates)
        backward = _poll_records(list(reversed(candidates)))
        self.assertEqual(forward, backward)
        self.assertEqual(forward["accepted_count"], 25)
        self.assertEqual(forward["status"], "current")

    def test_input_order_does_not_change_snapshot(self):
        records = _poll_records(_all_combo_records())["accepted_records"]
        forward = build_realtime_snapshot(records, as_of=AS_OF)
        backward = build_realtime_snapshot(
            list(reversed(records)), as_of=AS_OF
        )
        self.assertEqual(forward, backward)
        self.assertEqual(forward["snapshot_id"], backward["snapshot_id"])

        repeated = build_realtime_snapshot(records, as_of=AS_OF)
        self.assertEqual(forward["snapshot_id"], repeated["snapshot_id"])

        later = build_realtime_snapshot(
            records, as_of=datetime(2026, 10, 19, 12, 8, tzinfo=TZ8)
        )
        self.assertNotEqual(forward["snapshot_id"], later["snapshot_id"])

    def test_missing_city_phenomena_are_explicit_not_zero(self):
        result = _poll_records([_candidate(city_id="shenzhen")])
        snapshot = result["snapshot"]
        missing = {
            (item["city_id"], item["phenomenon"])
            for item in snapshot["missing_city_phenomena"]
        }
        self.assertNotIn(("shenzhen", "rainfall"), missing)
        self.assertIn(("shenzhen", "tide_level"), missing)
        self.assertIn(("haikou", "rainfall"), missing)
        self.assertEqual(len(snapshot["summaries"]), 1)


class RealtimeVersionAndConflictTest(unittest.TestCase):
    def test_version_chain_uses_available_at_and_keeps_history(self):
        old = _candidate(
            provider_record_id="corrected-record",
            provider_record_version="v1",
            value=10.0,
        )
        new = _candidate(
            provider_record_id="corrected-record",
            provider_record_version="v2",
            value=12.0,
            provider_published_at=datetime(2026, 10, 19, 12, 8, tzinfo=TZ8),
        )
        first = _poll_records(
            [old],
            received_at=datetime(2026, 10, 19, 12, 5, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 6, tzinfo=TZ8),
        )
        second = _poll_records(
            [new],
            received_at=datetime(2026, 10, 19, 12, 9, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 10, tzinfo=TZ8),
            until=datetime(2026, 10, 19, 12, 15, tzinfo=TZ8),
        )
        records = first["accepted_records"] + second["accepted_records"]
        snapshot = build_realtime_snapshot(
            records, as_of=datetime(2026, 10, 19, 12, 12, tzinfo=TZ8)
        )
        self.assertEqual(snapshot["provenance"]["version_chain_count"], 1)
        self.assertEqual(snapshot["provenance"]["superseded_count"], 1)
        chain = snapshot["version_chains"][0]
        self.assertEqual(len(chain["versions"]), 2)
        self.assertEqual(
            chain["selected_record_id"],
            second["accepted_records"][0]["record_id"],
        )
        self.assertEqual(
            chain["superseded_record_ids"],
            [first["accepted_records"][0]["record_id"]],
        )
        self.assertEqual(
            [item["status"] for item in chain["versions"]],
            ["superseded", "selected"],
        )
        self.assertEqual(snapshot["summaries"][0]["mean"], 12.0)

    def test_latest_suspect_version_does_not_replace_good_version(self):
        good = _candidate(
            provider_record_id="suspect-correction",
            provider_record_version="v1",
            value=10.0,
        )
        suspect = _candidate(
            provider_record_id="suspect-correction",
            provider_record_version="v2",
            value=999.0,
            quality_flags=["quality_controlled", "suspect"],
            provider_published_at=datetime(2026, 10, 19, 12, 8, tzinfo=TZ8),
        )
        first = _poll_records(
            [good],
            received_at=datetime(2026, 10, 19, 12, 5, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 6, tzinfo=TZ8),
        )
        second = _poll_records(
            [suspect],
            received_at=datetime(2026, 10, 19, 12, 9, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 10, tzinfo=TZ8),
            until=datetime(2026, 10, 19, 12, 15, tzinfo=TZ8),
        )
        snapshot = build_realtime_snapshot(
            first["accepted_records"] + second["accepted_records"],
            as_of=datetime(2026, 10, 19, 12, 12, tzinfo=TZ8),
        )
        self.assertEqual(snapshot["summaries"][0]["mean"], 10.0)
        self.assertEqual(snapshot["rejected_counts"]["suspect_quality"], 1)
        chain = snapshot["version_chains"][0]
        self.assertEqual(
            chain["selected_record_id"],
            first["accepted_records"][0]["record_id"],
        )
        statuses = {item["status"] for item in chain["versions"]}
        self.assertEqual(statuses, {"selected", "excluded_quality"})

    def test_version_strings_are_not_sorted_numerically(self):
        later_published = _candidate(
            provider_record_id="version-order",
            provider_record_version="9",
            value=20.0,
            provider_published_at=datetime(2026, 10, 19, 12, 8, tzinfo=TZ8),
        )
        earlier_published = _candidate(
            provider_record_id="version-order",
            provider_record_version="10",
            value=10.0,
            provider_published_at=datetime(2026, 10, 19, 12, 2, tzinfo=TZ8),
        )
        result = _poll_records(
            [later_published, earlier_published],
            received_at=datetime(2026, 10, 19, 12, 9, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 10, tzinfo=TZ8),
            until=datetime(2026, 10, 19, 12, 15, tzinfo=TZ8),
        )
        self.assertEqual(result["accepted_count"], 2)
        self.assertEqual(result["superseded_count"], 1)
        chain = result["snapshot"]["version_chains"][0]
        selected = next(
            item for item in chain["versions"]
            if item["status"] == "selected"
        )
        self.assertEqual(selected["provider_record_version"], "9")
        self.assertEqual(result["snapshot"]["summaries"][0]["mean"], 20.0)

    def test_version_chain_with_changed_unit_is_rejected(self):
        old = _candidate(
            provider_record_id="unit-change",
            provider_record_version="v1",
            unit="mm",
            value=10.0,
        )
        new = _candidate(
            provider_record_id="unit-change",
            provider_record_version="v2",
            unit="mm/h",
            value=5.0,
            provider_published_at=datetime(2026, 10, 19, 12, 8, tzinfo=TZ8),
        )
        first = _poll_records(
            [old],
            received_at=datetime(2026, 10, 19, 12, 5, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 6, tzinfo=TZ8),
        )
        second = _poll_records(
            [new],
            received_at=datetime(2026, 10, 19, 12, 9, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 10, tzinfo=TZ8),
            until=datetime(2026, 10, 19, 12, 15, tzinfo=TZ8),
        )
        snapshot = build_realtime_snapshot(
            first["accepted_records"] + second["accepted_records"],
            as_of=datetime(2026, 10, 19, 12, 12, tzinfo=TZ8),
        )
        self.assertEqual(snapshot["status"], "unavailable")
        self.assertEqual(snapshot["summaries"], [])
        self.assertEqual(
            snapshot["rejected_counts"]["version_conflict"], 1
        )
        self.assertFalse(snapshot["descriptive_analysis_available"])

    def test_version_available_after_as_of_is_not_used(self):
        old = _candidate(
            provider_record_id="future-version",
            provider_record_version="v1",
            value=10.0,
        )
        new = _candidate(
            provider_record_id="future-version",
            provider_record_version="v2",
            value=20.0,
            provider_published_at=datetime(2026, 10, 19, 12, 11, tzinfo=TZ8),
        )
        first = _poll_records(
            [old],
            received_at=datetime(2026, 10, 19, 12, 5, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 6, tzinfo=TZ8),
        )
        second = _poll_records(
            [new],
            received_at=datetime(2026, 10, 19, 12, 11, tzinfo=TZ8),
            processed_at=datetime(2026, 10, 19, 12, 12, tzinfo=TZ8),
            until=datetime(2026, 10, 19, 12, 15, tzinfo=TZ8),
        )
        snapshot = build_realtime_snapshot(
            first["accepted_records"] + second["accepted_records"],
            as_of=datetime(2026, 10, 19, 12, 8, tzinfo=TZ8),
        )
        self.assertEqual(snapshot["rejected_counts"]["not_yet_available"], 1)
        self.assertEqual(snapshot["provenance"]["superseded_count"], 0)
        self.assertEqual(snapshot["provenance"]["version_chain_count"], 1)
        self.assertEqual(snapshot["summaries"][0]["mean"], 10.0)

    def test_different_providers_same_space_time_are_not_mixed(self):
        first = _candidate(
            provider_record_id="p1-record",
            station_id="shared-station",
            geometry_or_area="shared-area",
            value=10.0,
        )
        second = _candidate(
            provider_record_id="p2-record",
            station_id="shared-station",
            geometry_or_area="shared-area",
            value=20.0,
        )
        first_poll = _poll(FakeProvider([first], provider_id="provider-1"))
        second_poll = _poll(FakeProvider([second], provider_id="provider-2"))
        records = (
            first_poll["accepted_records"]
            + second_poll["accepted_records"]
        )
        snapshot = build_realtime_snapshot(records, as_of=AS_OF)
        self.assertEqual(snapshot["status"], "unavailable")
        self.assertEqual(snapshot["summaries"], [])
        self.assertEqual(
            snapshot["rejected_counts"]["cross_provider_conflict"], 1
        )
        self.assertFalse(snapshot["descriptive_analysis_available"])
        self.assertEqual(
            snapshot["provenance"]["conflict_details"][0]["code"],
            "cross_provider_conflict",
        )

    def test_same_id_different_content_rejects_batch_and_is_auditable(self):
        first = _candidate(provider_record_id="conflict-record", value=10.0)
        second = _candidate(provider_record_id="conflict-record", value=20.0)
        result = _poll_records([first, second])
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["accepted_records"], [])
        self.assertIn("duplicate_conflict", _codes(result))
        self.assertIn(
            "duplicate_conflict", result["rejected_counts"]
        )
        self.assertEqual(result["rejected_counts"]["duplicate_conflict"], 1)
        _assert_flags_false(self, result)


class RealtimeFailureAndSafetyTest(unittest.TestCase):
    def test_provider_exception_becomes_unavailable_without_leaking_secret(self):
        provider = FakeProvider(
            error=RuntimeError("SECRET-TOKEN should never appear")
        )
        result = _poll(provider)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["provider_error"]["type"], "RuntimeError")
        self.assertEqual(result["rejected_count"], 1)
        self.assertEqual(result["rejected_records"][0]["code"], "provider_failure")
        self.assertEqual(len(provider.calls), 1)
        self.assertNotIn("SECRET-TOKEN", json.dumps(result, ensure_ascii=False))
        _assert_flags_false(self, result)
        self.assertEqual(result["snapshot"]["status"], "unavailable")
        self.assertEqual(result["snapshot"]["summaries"], [])

    def test_invalid_provider_response_is_auditable(self):
        for response in ({}, None, "not-a-list", 42):
            with self.subTest(response=response):
                provider = FakeProvider(response=response, response_set=True)
                result = _poll(provider)
                self.assertEqual(result["status"], "unavailable")
                self.assertEqual(
                    result["provider_error"]["type"],
                    "InvalidProviderResponse",
                )
                self.assertEqual(result["rejected_count"], 1)
                self.assertEqual(
                    result["rejected_records"][0]["code"], "provider_failure"
                )
                self.assertEqual(len(provider.calls), 1)
                _assert_flags_false(self, result)
                self.assertEqual(result["snapshot"]["summaries"], [])

    def test_configuration_errors_do_not_call_provider(self):
        provider = FakeProvider([_candidate()])
        result = _poll(
            provider,
            freshness_limits_minutes={"rainfall": 10},
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(provider.calls, [])
        self.assertIn("invalid_freshness_config", _codes(result))

        provider = FakeProvider([_candidate()])
        result = _poll(
            provider,
            since=datetime(2026, 10, 19, 12, 11, tzinfo=TZ8),
        )
        self.assertEqual(provider.calls, [])
        self.assertIn("invalid_time_order", _codes(result))

    def test_invalid_extra_fields_do_not_leak_values(self):
        record = _candidate()
        record["api_token"] = "SECRET-TOKEN"
        result = _poll_records([record])
        self.assertIn("extra_field", _codes(result))
        self.assertNotIn("SECRET-TOKEN", json.dumps(result, ensure_ascii=False))
        self.assertIn("api_token", result["rejected_records"][0]["detail"])

    def test_pipeline_does_not_touch_network_files_or_environment(self):
        record = _candidate()
        with patch.object(socket, "socket", side_effect=AssertionError("network")), \
                patch("builtins.open", side_effect=AssertionError("filesystem")), \
                patch("os.getenv", side_effect=AssertionError("environment")):
            result = _poll_records([record])
            snapshot = build_realtime_snapshot(
                result["accepted_records"], as_of=AS_OF
            )
        self.assertEqual(result["accepted_count"], 1)
        self.assertEqual(snapshot["status"], "degraded")

    def test_all_paths_keep_capability_flags_false(self):
        current = _poll_records(_all_combo_records())
        unavailable = _poll_records([])
        rejected = _poll_records(
            [
                _candidate(provider_record_id="x", value=1.0),
                _candidate(provider_record_id="x", value=2.0),
            ]
        )
        failure = _poll(
            FakeProvider(error=RuntimeError("provider down"))
        )
        for result in (current, unavailable, rejected, failure):
            _assert_flags_false(self, result)
            if result["snapshot"] is not None:
                _assert_flags_false(self, result["snapshot"])

    def test_snapshot_id_is_stable_and_content_sensitive(self):
        records = _poll_records(_all_combo_records())["accepted_records"]
        first = build_realtime_snapshot(records, as_of=AS_OF)
        second = build_realtime_snapshot(
            list(reversed(records)), as_of=AS_OF
        )
        self.assertEqual(first["snapshot_id"], second["snapshot_id"])
        changed = _poll_records([
            _candidate(city_id="shenzhen", value=99.0)
        ])["accepted_records"]
        other = build_realtime_snapshot(changed, as_of=AS_OF)
        self.assertNotEqual(first["snapshot_id"], other["snapshot_id"])
        self.assertTrue(first["snapshot_id"].startswith("sha256:"))

    def test_invalid_snapshot_inputs_fail_closed(self):
        naive = build_realtime_snapshot([], as_of=datetime(2026, 10, 19, 12, 7))
        self.assertEqual(naive["status"], "unavailable")
        self.assertEqual(naive["rejected_counts"]["naive_datetime"], 1)

        not_list = build_realtime_snapshot(None, as_of=AS_OF)
        self.assertEqual(not_list["status"], "unavailable")
        self.assertEqual(not_list["rejected_counts"]["invalid_record"], 1)

        invalid = build_realtime_snapshot([{}], as_of=AS_OF)
        self.assertEqual(invalid["status"], "unavailable")
        self.assertEqual(
            invalid["rejected_counts"]["missing_field"], 1
        )
        self.assertEqual(invalid["summaries"], [])

        extra = build_realtime_snapshot([{"bad": "record"}], as_of=AS_OF)
        self.assertEqual(extra["status"], "unavailable")
        self.assertEqual(extra["rejected_counts"]["extra_field"], 1)

    def test_zhejiang_scope_is_four_cities_and_rejects_other_region_records(self):
        records = [
            _candidate(city_id=city)
            for city in ZHEJIANG_CITY_ORDER
        ]
        accepted = _poll_records(records, city_order=ZHEJIANG_CITY_ORDER)
        self.assertEqual(accepted["accepted_count"], 4)
        self.assertEqual(
            set(accepted["snapshot"]["city_status"]),
            set(ZHEJIANG_CITY_ORDER),
        )
        self.assertEqual(len(accepted["snapshot"]["missing_city_phenomena"]), 16)

        wrong_scope = _poll_records(
            [_candidate(city_id="shanghai")],
            city_order=ZHEJIANG_CITY_ORDER,
        )
        self.assertEqual(wrong_scope["accepted_count"], 0)
        self.assertEqual(wrong_scope["rejected_counts"]["unknown_city"], 1)

    def test_zhejiang_snapshot_storage_is_scoped_and_validated(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "zhejiang.sqlite3"
            empty = load_snapshot(path, as_of=AS_OF, city_order=ZHEJIANG_CITY_ORDER)
            self.assertEqual(set(empty["city_status"]), set(ZHEJIANG_CITY_ORDER))
            self.assertEqual(len(empty["missing_city_phenomena"]), 20)

            records = _poll_records(
                [_candidate(city_id="hangzhou")],
                city_order=ZHEJIANG_CITY_ORDER,
            )["accepted_records"]
            self.assertEqual(save_records(path, records)["inserted_count"], 1)
            populated = load_snapshot(path, as_of=AS_OF, city_order=ZHEJIANG_CITY_ORDER)
            self.assertEqual(populated["stored_record_count"], 1)
            self.assertNotIn("shanghai", populated["city_status"])

        with self.assertRaises(InvalidCityScope):
            normalize_city_order(("ningbo", "ningbo"))


if __name__ == "__main__":
    unittest.main()
