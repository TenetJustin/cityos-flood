"""Tests for the offline historical replay evaluator.

The suite is intentionally airtight about evidence provenance: no test reads the
filesystem, touches the network, or relies on a model version changing.
"""
import math
import unittest
from datetime import datetime, timedelta, timezone

from backend.app.evidence_contract import EventManifest
from backend.app.historical_replay import evaluate_replay

UTC8 = timezone(timedelta(hours=8))
ISSUED_CUTOFF = datetime(2023, 9, 7, 20, 0, tzinfo=UTC8)
EVALUATION_CUTOFF = datetime(2023, 9, 8, 12, 0, tzinfo=UTC8)


def _at(hour, minute=0, day=7):
    return datetime(2023, 9, day, hour, minute, tzinfo=UTC8)


def _source():
    return {
        "publisher": "test publisher",
        "source_name": "test source",
        "source_reference": "https://example.invalid/source",
        "retrieved_at": "2023-09-10T10:00:00+08:00",
        "license_id": "terms-review-required",
        "redistribution_allowed": None,
    }


def _record(
    record_id,
    *,
    phenomenon="rainfall",
    evidence_class="observation",
    observed_at=None,
    available_at=None,
    geometry_or_area="station-1",
    value=10.0,
    unit="mm/h",
    quality_flags=("quality_controlled",),
    missing_status="present",
    missing_reason=None,
):
    if observed_at is None:
        observed_at = _at(21)
    if available_at is None:
        available_at = _at(21, 5)
    return {
        "record_id": record_id,
        "phenomenon": phenomenon,
        "evidence_class": evidence_class,
        "observed_at": observed_at,
        "available_at": available_at,
        "timezone": "Asia/Shanghai",
        "spatial": {
            "geometry_or_area": geometry_or_area,
            "horizontal_crs": "EPSG:4326",
            "vertical_datum": (
                "local_datum"
                if phenomenon in {"tide_level", "river_level"}
                else None
            ),
            "spatial_resolution": "station",
        },
        "value": value,
        "unit": unit,
        "source": _source(),
        "quality_flags": list(quality_flags),
        "missing_status": missing_status,
        "missing_reason": missing_reason,
    }


def _manifest(records):
    return EventManifest.model_validate({
        "schema_version": "1.0",
        "event_id": "2023-09-07-shenzhen-extreme-rain",
        "city_id": "shenzhen",
        "event_name": "深圳 9·7 极端特大暴雨",
        "event_start": _at(18),
        "event_end": _at(18, day=8),
        "timezone": "Asia/Shanghai",
        "trigger_summary": "海葵残余环流、季风和弱冷空气共同影响",
        "status": "candidate",
        "records": records,
    })


def _input_obs(record_id="input-obs"):
    return _record(
        record_id,
        observed_at=_at(18, 50),
        available_at=_at(19, 0),
        value=3.0,
    )


def _forecast(
    forecast_id="f1",
    *,
    issued_at=None,
    valid_at=None,
    geometry_or_area="station-1",
    phenomenon="rainfall",
    value=12.0,
    unit="mm/h",
    model_version="flood-v1",
    input_record_ids=("input-obs",),
    **extra,
):
    forecast = {
        "forecast_id": forecast_id,
        "issued_at": _at(19, 30) if issued_at is None else issued_at,
        "valid_at": _at(21) if valid_at is None else valid_at,
        "geometry_or_area": geometry_or_area,
        "phenomenon": phenomenon,
        "value": value,
        "unit": unit,
        "model_version": model_version,
        "input_record_ids": list(input_record_ids),
    }
    forecast.update(extra)
    return forecast


def _evaluate(records, forecasts, *, issued=None, evaluation=None):
    return evaluate_replay(
        _manifest(records),
        forecasts,
        issued_cutoff_at=ISSUED_CUTOFF if issued is None else issued,
        evaluation_cutoff_at=(
            EVALUATION_CUTOFF if evaluation is None else evaluation
        ),
    )


def _codes(result):
    return {item["code"] for item in result["rejections"]}


class HistoricalReplayMetricsTest(unittest.TestCase):
    def test_two_qualified_pairs_compute_mae_rmse_and_bias(self):
        records = [
            _input_obs(),
            _record("obs-21", value=10.0),
            _record("obs-22", observed_at=_at(22), available_at=_at(22, 5), value=20.0),
        ]
        forecasts = [
            _forecast("f1", valid_at=_at(21), value=12.0),
            _forecast("f2", valid_at=_at(22), value=19.0),
        ]

        result = _evaluate(records, forecasts)

        self.assertEqual(result["status"], "evaluated")
        self.assertEqual(result["event_id"], "2023-09-07-shenzhen-extreme-rain")
        self.assertEqual(result["issued_cutoff_at"], "2023-09-07T20:00:00+08:00")
        self.assertEqual(result["evaluation_cutoff_at"], "2023-09-08T12:00:00+08:00")
        self.assertEqual(result["model_versions"], ["flood-v1"])
        self.assertEqual([pair["forecast_id"] for pair in result["matched_pairs"]], ["f1", "f2"])
        self.assertEqual(
            [pair["record_id"] for pair in result["matched_pairs"]],
            ["obs-21", "obs-22"],
        )
        self.assertEqual(
            [pair["residual"] for pair in result["matched_pairs"]],
            [2.0, -1.0],
        )
        self.assertAlmostEqual(result["metrics"]["mae"], 1.5)
        self.assertAlmostEqual(result["metrics"]["rmse"], math.sqrt(2.5))
        self.assertAlmostEqual(result["metrics"]["bias"], 0.5)
        self.assertTrue(result["leakage_checks"]["passed"])
        self.assertTrue(result["leakage_checks"]["input_lineage_verified"])
        self.assertEqual(result["leakage_checks"]["violations"], [])

    def test_only_observations_can_enter_the_metrics(self):
        records = [
            _input_obs(),
            _record("obs-1", value=10.0),
            _record(
                "hist-1", evidence_class="historical_record", value=100.0
            ),
            _record(
                "infer-1", evidence_class="model_inference", value=200.0
            ),
            _record(
                "scenario-1", evidence_class="simulation_scenario", value=300.0
            ),
            _record(
                "gap-1",
                evidence_class="missing",
                value=None,
                missing_status="not_acquired",
                missing_reason="未采集",
            ),
        ]

        result = _evaluate(records, [_forecast("f1", value=12.0)])

        self.assertEqual(result["status"], "evaluated")
        self.assertEqual(len(result["matched_pairs"]), 1)
        self.assertEqual(result["matched_pairs"][0]["record_id"], "obs-1")
        self.assertEqual(result["matched_pairs"][0]["observed_value"], 10.0)
        self.assertAlmostEqual(result["metrics"]["mae"], 2.0)
        self.assertAlmostEqual(result["metrics"]["rmse"], 2.0)
        self.assertAlmostEqual(result["metrics"]["bias"], 2.0)
        self.assertEqual(result["excluded_counts"]["non_observation"], 4)

    def test_truth_after_issue_but_before_evaluation_scores(self):
        records = [
            _input_obs(),
            _record("obs-21", observed_at=_at(21), available_at=_at(21, 5), value=10.0),
            _record(
                "obs-22",
                observed_at=_at(22),
                available_at=_at(0, day=9),
                value=20.0,
            ),
        ]
        forecasts = [
            _forecast("f1", valid_at=_at(21), value=12.0),
            _forecast("f2", valid_at=_at(22), value=19.0),
        ]

        result = _evaluate(records, forecasts)

        self.assertEqual(result["status"], "evaluated")
        self.assertEqual([pair["forecast_id"] for pair in result["matched_pairs"]], ["f1"])
        self.assertEqual(result["excluded_counts"]["available_after_evaluation"], 1)
        self.assertEqual(result["excluded_counts"]["unmatched_forecast"], 1)
        self.assertAlmostEqual(result["metrics"]["mae"], 2.0)

        # An observation that only becomes available after the evaluation
        # cutoff is never scored, even if it would otherwise be a perfect match.
        late_only = _evaluate(
            [_input_obs(), records[2]],
            [_forecast("f2", valid_at=_at(22), value=19.0)],
        )
        self.assertEqual(late_only["status"], "insufficient_data")
        self.assertIsNone(late_only["metrics"])
        self.assertEqual(late_only["matched_pairs"], [])
        self.assertEqual(late_only["excluded_counts"]["available_after_evaluation"], 1)

    def test_truth_available_exactly_at_evaluation_cutoff_is_included(self):
        records = [
            _input_obs(),
            _record(
                "obs-boundary",
                observed_at=_at(23),
                available_at=EVALUATION_CUTOFF,
                value=10.0,
            ),
        ]
        result = _evaluate(
            records, [_forecast("f1", valid_at=_at(23), value=11.0)]
        )
        self.assertEqual(result["status"], "evaluated")
        self.assertEqual(result["matched_pairs"][0]["record_id"], "obs-boundary")
        self.assertAlmostEqual(result["metrics"]["bias"], 1.0)

    def test_no_matching_observation_returns_insufficient_data(self):
        records = [
            _input_obs(),
            _record("obs-far", observed_at=_at(3, day=8), available_at=_at(3, 5, day=8), value=10.0),
        ]
        result = _evaluate(records, [_forecast("f1", valid_at=_at(21))])
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIsNone(result["metrics"])
        self.assertEqual(result["matched_pairs"], [])
        self.assertTrue(result["leakage_checks"]["input_lineage_verified"])


class HistoricalReplayLeakageTest(unittest.TestCase):
    def test_forecast_issued_after_cutoff_is_rejected(self):
        result = _evaluate(
            [_input_obs(), _record("obs-21")],
            [_forecast("f1", issued_at=_at(20, 30), valid_at=_at(21))],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_issued_after_cutoff", _codes(result))
        self.assertIsNone(result["metrics"])

    def test_valid_time_not_after_cutoff_is_rejected(self):
        result = _evaluate(
            [_input_obs(), _record("obs-20", observed_at=_at(20), available_at=_at(20, 5))],
            [_forecast("f1", valid_at=_at(20))],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_valid_at_not_after_cutoff", _codes(result))

    def test_input_available_after_issue_is_leakage(self):
        late_input = _record(
            "late-input", observed_at=_at(19, 40), available_at=_at(19, 45), value=1.0
        )
        result = _evaluate(
            [_input_obs(), late_input, _record("obs-21")],
            [_forecast("f1", issued_at=_at(19, 30), input_record_ids=("late-input",))],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("input_lineage_leak", _codes(result))
        self.assertFalse(result["leakage_checks"]["passed"])
        self.assertFalse(result["leakage_checks"]["input_lineage_verified"])
        self.assertTrue(result["leakage_checks"]["violations"])

    def test_missing_input_reference_is_leakage(self):
        result = _evaluate(
            [_input_obs(), _record("obs-21")],
            [_forecast("f1", input_record_ids=("does-not-exist",))],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("input_lineage_leak", _codes(result))
        self.assertIn(
            "does-not-exist", " ".join(result["leakage_checks"]["violations"])
        )

    def test_non_observation_or_future_evidence_input_is_leakage(self):
        inference = _record(
            "infer-input",
            evidence_class="model_inference",
            observed_at=_at(19),
            available_at=_at(19, 5),
            value=1.0,
        )
        result = _evaluate(
            [_input_obs(), inference, _record("obs-21")],
            [_forecast("f1", input_record_ids=("infer-input",))],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("input_lineage_leak", _codes(result))

    def test_published_historical_record_is_a_legal_input(self):
        history = _record(
            "hist-input",
            evidence_class="historical_record",
            observed_at=_at(19, 20),
            available_at=_at(19, 25),
            value=5.0,
        )
        result = _evaluate(
            [history, _record("obs-21")],
            [_forecast("f1", input_record_ids=("hist-input",))],
        )
        self.assertEqual(result["status"], "evaluated")
        self.assertTrue(result["leakage_checks"]["input_lineage_verified"])
        self.assertTrue(result["leakage_checks"]["passed"])

    def test_cutoff_times_are_strict_and_ordered(self):
        records = [_input_obs(), _record("obs-21")]
        forecasts = [_forecast("f1")]

        naive = _evaluate(
            records,
            forecasts,
            issued=datetime(2023, 9, 7, 20, 0),
        )
        self.assertEqual(naive["status"], "rejected")
        self.assertIn("cutoff_timezone_invalid", _codes(naive))

        wrong_offset = _evaluate(
            records,
            forecasts,
            evaluation=datetime(2023, 9, 8, 4, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(wrong_offset["status"], "rejected")
        self.assertIn("cutoff_timezone_invalid", _codes(wrong_offset))

        backwards = _evaluate(
            records,
            forecasts,
            evaluation=_at(19),
        )
        self.assertEqual(backwards["status"], "rejected")
        self.assertIn("evaluation_before_issue", _codes(backwards))

        iso_cutoffs = _evaluate(
            records,
            forecasts,
            issued="2023-09-07T20:00:00+08:00",
            evaluation="2023-09-08T12:00:00+08:00",
        )
        self.assertEqual(iso_cutoffs["status"], "evaluated")
        self.assertEqual(iso_cutoffs["issued_cutoff_at"], "2023-09-07T20:00:00+08:00")

    def test_forecast_times_must_be_aware_and_utc8(self):
        naive = _forecast("f1", issued_at=datetime(2023, 9, 7, 19, 30))
        result = _evaluate([_input_obs(), _record("obs-21")], [naive])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_issued_at_invalid", _codes(result))

        utc = _forecast(
            "f1", valid_at=datetime(2023, 9, 7, 13, 0, tzinfo=timezone.utc)
        )
        result = _evaluate([_input_obs(), _record("obs-21")], [utc])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_valid_at_invalid", _codes(result))

        iso_ok = _forecast(
            "f1",
            issued_at="2023-09-07T19:30:00+08:00",
            valid_at="2023-09-07T21:00:00+08:00",
        )
        result = _evaluate([_input_obs(), _record("obs-21")], [iso_ok])
        self.assertEqual(result["status"], "evaluated")

        iso_utc = _forecast(
            "f1", valid_at="2023-09-07T13:00:00+00:00"
        )
        result = _evaluate([_input_obs(), _record("obs-21")], [iso_utc])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_valid_at_invalid", _codes(result))


class HistoricalReplayFailClosedTest(unittest.TestCase):
    def test_suspect_or_rejected_quality_is_never_truth(self):
        for flag in ("suspect", "rejected"):
            with self.subTest(flag=flag):
                result = _evaluate(
                    [
                        _input_obs(),
                        _record(
                            "obs-bad",
                            quality_flags=("quality_controlled", flag),
                        ),
                    ],
                    [_forecast("f1")],
                )
                self.assertEqual(result["status"], "insufficient_data")
                self.assertIsNone(result["metrics"])
                self.assertEqual(result["matched_pairs"], [])
                self.assertEqual(result["excluded_counts"]["quality_flagged"], 1)

    def test_uncontrolled_or_missing_quality_is_never_truth(self):
        result = _evaluate(
            [
                _input_obs(),
                _record("obs-raw", quality_flags=("provisional",)),
            ],
            [_forecast("f1")],
        )
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIsNone(result["metrics"])
        self.assertEqual(result["excluded_counts"]["not_quality_controlled"], 1)

        missing = _evaluate(
            [
                _record(
                    "gap-1",
                    evidence_class="missing",
                    value=None,
                    missing_status="not_acquired",
                    missing_reason="未采集",
                )
            ],
            [_forecast("f1", input_record_ids=())],
        )
        self.assertEqual(missing["status"], "insufficient_data")
        self.assertIsNone(missing["metrics"])
        self.assertEqual(missing["excluded_counts"]["non_observation"], 1)

    def test_duplicate_forecast_ids_are_rejected(self):
        result = _evaluate(
            [_input_obs(), _record("obs-21"), _record("obs-22", observed_at=_at(22), available_at=_at(22, 5))],
            [
                _forecast("f1", valid_at=_at(21)),
                _forecast("f1", valid_at=_at(22)),
            ],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("duplicate_forecast_id", _codes(result))

    def test_duplicate_forecast_keys_are_rejected(self):
        result = _evaluate(
            [_input_obs(), _record("obs-21")],
            [
                _forecast("f1", valid_at=_at(21)),
                _forecast("f2", valid_at=_at(21)),
            ],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("duplicate_forecast_key", _codes(result))

    def test_duplicate_eligible_truth_is_rejected(self):
        result = _evaluate(
            [
                _input_obs(),
                _record("obs-a", value=10.0),
                _record("obs-b", value=11.0),
            ],
            [_forecast("f1")],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("duplicate_truth_key", _codes(result))
        self.assertEqual(result["excluded_counts"]["duplicate_truth_key"], 2)

    def test_non_finite_forecasts_are_rejected(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                result = _evaluate(
                    [_input_obs(), _record("obs-21")],
                    [_forecast("f1", value=value)],
                )
                self.assertEqual(result["status"], "rejected")
                self.assertIn("forecast_value_not_finite", _codes(result))
                self.assertIsNone(result["metrics"])

    def test_non_finite_observation_is_rejected(self):
        manifest = _manifest([_input_obs(), _record("obs-nan")])
        record = next(item for item in manifest.records if item.record_id == "obs-nan")
        record.value = float("nan")
        result = evaluate_replay(
            manifest,
            [_forecast("f1")],
            issued_cutoff_at=ISSUED_CUTOFF,
            evaluation_cutoff_at=EVALUATION_CUTOFF,
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("non_finite_observation_value", _codes(result))
        self.assertEqual(result["excluded_counts"]["non_finite_value"], 1)

    def test_missing_and_unexpected_forecast_fields_are_rejected(self):
        missing = _forecast("f1")
        del missing["unit"]
        result = _evaluate([_input_obs(), _record("obs-21")], [missing])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_missing_fields", _codes(result))

        unexpected = _forecast("f1", note="not part of the contract")
        result = _evaluate([_input_obs(), _record("obs-21")], [unexpected])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_unexpected_fields", _codes(result))

        missing_lineage = _forecast("f1")
        del missing_lineage["input_record_ids"]
        result = _evaluate([_input_obs(), _record("obs-21")], [missing_lineage])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_missing_fields", _codes(result))
        self.assertIn("input_record_ids", result["rejections"][0]["detail"])

    def test_non_string_extra_keys_are_rejected_without_raising(self):
        forecast = _forecast("f1")
        forecast[1] = "non-string key"
        forecast[("nested", "key")] = "non-string key"
        result = _evaluate([_input_obs(), _record("obs-21")], [forecast])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_unexpected_fields", _codes(result))
        details = " ".join(item["detail"] for item in result["rejections"])
        self.assertIn("字段名必须是字符串", details)
        self.assertIsNone(result["metrics"])

        single = _forecast("f1")
        single[7] = None
        result = _evaluate([_input_obs(), _record("obs-21")], [single])
        self.assertEqual(result["status"], "rejected")
        self.assertIn("forecast_unexpected_fields", _codes(result))

    def test_mixed_model_versions_are_rejected(self):
        result = _evaluate(
            [
                _input_obs(),
                _record("obs-21"),
                _record("obs-22", observed_at=_at(22), available_at=_at(22, 5)),
            ],
            [
                _forecast("f1", valid_at=_at(21), model_version="flood-v1"),
                _forecast("f2", valid_at=_at(22), model_version="flood-v2"),
            ],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("multiple_model_versions", _codes(result))
        self.assertEqual(result["model_versions"], ["flood-v1", "flood-v2"])
        self.assertIsNone(result["metrics"])
        self.assertEqual(result["matched_pairs"], [])

    def test_unit_inconsistency_is_rejected(self):
        invalid_unit = _evaluate(
            [_input_obs(), _record("obs-21")],
            [_forecast("f1", unit="kg")],
        )
        self.assertEqual(invalid_unit["status"], "rejected")
        self.assertIn("forecast_unit_not_allowed", _codes(invalid_unit))

        mismatched = _evaluate(
            [_input_obs(), _record("obs-21", unit="mm/h")],
            [_forecast("f1", unit="mm")],
        )
        self.assertEqual(mismatched["status"], "rejected")
        self.assertIn("unit_mismatch", _codes(mismatched))
        self.assertIsNone(mismatched["metrics"])

    def test_truth_record_linkage_rejects_non_observation_evidence(self):
        history = _record(
            "hist-1",
            evidence_class="historical_record",
            value=10.0,
        )
        result = _evaluate(
            [_input_obs(), history],
            [_forecast("f1", truth_record_id="hist-1")],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("truth_evidence_class_not_observation", _codes(result))

        result = _evaluate(
            [_input_obs(), _record("obs-21")],
            [_forecast("f1", truth_record_id="no-such-record")],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("truth_record_missing", _codes(result))

    def test_truth_record_linkage_requires_an_eligible_observation(self):
        suspect = _record(
            "obs-suspect",
            quality_flags=("quality_controlled", "suspect"),
        )
        result = _evaluate(
            [_input_obs(), suspect],
            [_forecast("f1", truth_record_id="obs-suspect")],
        )
        self.assertEqual(result["status"], "rejected")
        self.assertIn("truth_record_not_eligible", _codes(result))

    def test_truth_record_linkage_accepts_an_eligible_observation(self):
        result = _evaluate(
            [_input_obs(), _record("obs-21", value=10.0)],
            [_forecast("f1", value=12.0, truth_record_id="obs-21")],
        )
        self.assertEqual(result["status"], "evaluated")
        self.assertEqual(result["matched_pairs"][0]["record_id"], "obs-21")
        self.assertAlmostEqual(result["metrics"]["mae"], 2.0)


class HistoricalReplayDeterminismAndBoundaryTest(unittest.TestCase):
    def test_input_order_does_not_change_the_result(self):
        records = [
            _input_obs(),
            _record("obs-21", value=10.0),
            _record("obs-22", observed_at=_at(22), available_at=_at(22, 5), value=20.0),
            _record("hist-21", evidence_class="historical_record", value=100.0),
        ]
        forecasts = [
            _forecast("f1", valid_at=_at(21), value=12.0),
            _forecast("f2", valid_at=_at(22), value=19.0),
            _forecast("f3", valid_at=_at(23), value=11.0),
        ]

        forward = _evaluate(records, forecasts)
        backward = _evaluate(list(reversed(records)), list(reversed(forecasts)))

        self.assertEqual(forward, backward)
        self.assertEqual(forward["status"], "evaluated")
        self.assertEqual(len(forward["matched_pairs"]), 2)
        self.assertEqual(forward["excluded_counts"]["unmatched_forecast"], 1)

    def test_rejection_lists_are_sorted_and_order_independent(self):
        first = _evaluate(
            [_input_obs(), _record("obs-21")],
            [
                _forecast("f2", valid_at=_at(20)),
                _forecast("f1", issued_at=_at(20, 30)),
            ],
        )
        second = _evaluate(
            [_record("obs-21"), _input_obs()],
            [
                _forecast("f1", issued_at=_at(20, 30)),
                _forecast("f2", valid_at=_at(20)),
            ],
        )
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "rejected")
        sorted_codes = [item["code"] for item in first["rejections"]]
        self.assertEqual(sorted_codes, sorted(sorted_codes))

    def test_empty_input_lineage_is_not_a_full_leakage_pass(self):
        result = _evaluate(
            [_record("obs-21", value=10.0)],
            [_forecast("f1", value=12.0, input_record_ids=())],
        )

        self.assertEqual(result["status"], "evaluated")
        self.assertAlmostEqual(result["metrics"]["mae"], 2.0)
        self.assertFalse(result["leakage_checks"]["input_lineage_verified"])
        self.assertFalse(result["leakage_checks"]["passed"])
        self.assertEqual(result["leakage_checks"]["violations"], [])

    def test_all_capability_flags_are_false_on_every_path(self):
        evaluated = _evaluate(
            [_input_obs(), _record("obs-21", value=10.0)],
            [_forecast("f1", value=12.0)],
        )
        insufficient = _evaluate(
            [_input_obs()],
            [_forecast("f1")],
        )
        rejected = _evaluate(
            [_input_obs(), _record("obs-21")],
            [_forecast("f1", issued_at=_at(20, 30))],
        )

        self.assertEqual(
            {evaluated["status"], insufficient["status"], rejected["status"]},
            {"evaluated", "insufficient_data", "rejected"},
        )
        for result in (evaluated, insufficient, rejected):
            self.assertIs(result["promotion_allowed"], False)
            self.assertIs(result["public_warning_ready"], False)
            self.assertIs(result["automatic_dispatch_ready"], False)
            if result["status"] != "evaluated":
                self.assertIsNone(result["metrics"])

    def test_insufficient_data_never_invents_zero_or_nan_metrics(self):
        result = _evaluate([_input_obs()], [_forecast("f1")])
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIsNone(result["metrics"])
        self.assertEqual(result["matched_pairs"], [])
        self.assertEqual(result["rejections"], [])
        self.assertTrue(result["leakage_checks"]["input_lineage_verified"])


if __name__ == "__main__":
    unittest.main()
