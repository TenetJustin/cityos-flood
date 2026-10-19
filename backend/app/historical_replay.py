"""Offline, fail-closed evaluation of historical forecast replays.

This module consumes only data that has already passed
:class:`backend.app.evidence_contract.EventManifest`.  It never downloads data,
reads the filesystem, calls the network, trains a model, changes a model
version, publishes a warning, or dispatches resources.  The three capability
flags in every result are therefore hard-coded to ``False``.

Contract highlights
-------------------
* Cutoff arguments must be timezone-aware ``datetime`` values with a UTC+08:00
  offset (ISO-8601 strings carrying that offset are also accepted).  Forecast
  times may be such datetimes or ISO-8601 strings.  Naive times and other
  offsets are rejected, never converted.
* A forecast is usable only when ``issued_at <= issued_cutoff_at < valid_at``.
  Its input lineage may contain only ``observation`` or ``historical_record``
  versions whose ``available_at <= issued_at``.  Unknown references, later
  versions, and other evidence classes are leakage and reject the whole run.
* An empty ``input_record_ids`` list is legal, but it means input lineage could
  not be audited.  ``input_lineage_verified`` stays ``False`` and
  ``leakage_checks["passed"]`` stays ``False``; no full leak-free claim is made.
* Ground truth is drawn exclusively from ``observation`` records that are
  present, quality controlled, not suspect/rejected, available no later than
  the evaluation cutoff, finite-valued, and exactly consistent with the
  forecast's phenomenon, geometry/area, valid time, and unit.  Other evidence
  classes may stay in the manifest but can never enter the metrics.
* Rejections are fail-closed and order-independent: late issue, non-future
  valid time, duplicate keys, leakage, unit inconsistencies, non-finite values,
  and attempts to nominate a non-observation record as truth all yield
  ``status="rejected"`` with an explicit ``rejections`` list.

Optional ``truth_record_id``
----------------------------
Besides the required forecast fields, a forecast may name an explicit
``truth_record_id``.  When present it must resolve to an eligible observation
that matches the forecast exactly; naming a ``historical_record``,
``model_inference``, ``simulation_scenario``, ``missing`` record, or an
ineligible observation is rejected.  When absent, truth is matched by key.

Result shape
------------
``matched_pairs`` contains one dictionary per scored pair with the forecast id,
record id, phenomenon, geometry/area, valid time, observation time, unit, model
version, forecast value, observed value, and ``residual`` (forecast minus
observed).  ``metrics`` (``mae``, ``rmse``, ``bias``) uses those residuals and is
``None`` unless the status is ``evaluated``.  ``excluded_counts`` is a stable
dictionary of integer counters keyed by exclusion reason.  ``rejections`` lists
``{code, detail, forecast_id, record_id}`` dictionaries and is empty only when
nothing was rejected.  The three capability flags are always ``False``.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta

from .evidence_contract import EventManifest

UTC8 = timedelta(hours=8)

# Mirrors the unit sets in ``EvidenceRecord.validate_semantics`` (contract
# v1.0).  Kept local because this module must not edit the shared contract.
PHENOMENON_UNITS: dict[str, frozenset[str]] = {
    "typhoon_track": frozenset({"degree", "km"}),
    "rainfall": frozenset({"mm", "mm/h"}),
    "tide_level": frozenset({"m"}),
    "river_level": frozenset({"m"}),
    "flood_depth": frozenset({"m"}),
    "road_closure": frozenset({"boolean"}),
    "transport_impact": frozenset({"count", "minute", "categorical"}),
    "resident_response": frozenset({"person", "count", "categorical"}),
    "emergency_response": frozenset({"person", "count", "categorical"}),
}

FORECAST_REQUIRED_FIELDS = frozenset({
    "forecast_id",
    "issued_at",
    "valid_at",
    "geometry_or_area",
    "phenomenon",
    "value",
    "unit",
    "model_version",
    "input_record_ids",
})
FORECAST_OPTIONAL_FIELDS = frozenset({"truth_record_id"})

INPUT_EVIDENCE_CLASSES = frozenset({"observation", "historical_record"})
TRUTH_INELIGIBLE_QUALITY = frozenset({"suspect", "rejected"})

# Every excluded manifest record or forecast is counted under exactly one of
# these deterministic keys.
EXCLUDED_COUNT_KEYS = (
    "non_observation",
    "missing_status",
    "missing_observed_at",
    "missing_availability",
    "invalid_time_offset",
    "available_after_evaluation",
    "quality_flagged",
    "not_quality_controlled",
    "non_finite_value",
    "non_numeric_value",
    "duplicate_truth_key",
    "unit_mismatch",
    "no_matching_forecast",
    "unmatched_forecast",
)


def _has_utc8_offset(value: object) -> bool:
    return (
        isinstance(value, datetime)
        and value.tzinfo is not None
        and value.utcoffset() == UTC8
    )


def _as_utc8_datetime(value: object) -> datetime | None:
    """Accept only an aware datetime or ISO-8601 string with a UTC+08:00 offset."""
    if isinstance(value, datetime):
        return value if _has_utc8_offset(value) else None
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return parsed if _has_utc8_offset(parsed) else None
    return None


def _iso(value: object) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _empty_excluded_counts() -> dict[str, int]:
    return {key: 0 for key in EXCLUDED_COUNT_KEYS}


def _rejection(
    code: str,
    detail: str,
    *,
    forecast_id: str | None = None,
    record_id: str | None = None,
) -> dict[str, str | None]:
    return {
        "code": code,
        "detail": detail,
        "forecast_id": forecast_id,
        "record_id": record_id,
    }


def _sorted_rejections(items: list[dict]) -> list[dict]:
    def sort_key(item: dict) -> tuple[str, str, str, str]:
        return (
            str(item.get("code") or ""),
            str(item.get("forecast_id") or ""),
            str(item.get("record_id") or ""),
            str(item.get("detail") or ""),
        )

    seen: set[tuple[str, str, str, str]] = set()
    unique: list[dict] = []
    for item in sorted(items, key=sort_key):
        key = sort_key(item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _finite_number(value: object) -> tuple[float | None, str | None]:
    """Return ``(number, reason)``; reason is ``non_numeric`` or ``non_finite``."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, "non_numeric"
    try:
        number = float(value)
    except OverflowError:
        return None, "non_finite"
    if not math.isfinite(number):
        return None, "non_finite"
    return number, None


def _truth_exclusion(record, evaluation_cutoff_at: datetime) -> str | None:
    """Return the exclusion key for a record that cannot be numeric truth."""
    if record.evidence_class != "observation":
        return "non_observation"
    if record.missing_status != "present" or record.value is None:
        return "missing_status"
    if record.observed_at is None:
        return "missing_observed_at"
    if record.available_at is None:
        return "missing_availability"
    if not _has_utc8_offset(record.observed_at) or not _has_utc8_offset(
        record.available_at
    ):
        return "invalid_time_offset"
    if record.available_at > evaluation_cutoff_at:
        return "available_after_evaluation"
    flags = set(record.quality_flags)
    if flags & TRUTH_INELIGIBLE_QUALITY:
        return "quality_flagged"
    if "quality_controlled" not in flags:
        return "not_quality_controlled"
    _, reason = _finite_number(record.value)
    if reason == "non_finite":
        return "non_finite_value"
    if reason == "non_numeric":
        return "non_numeric_value"
    return None


def _observation_key(record) -> tuple[str, str, datetime, str]:
    return (
        record.phenomenon,
        record.spatial.geometry_or_area,
        record.observed_at,
        record.unit,
    )


def _forecast_match_key(forecast: dict) -> tuple[str, str, datetime, str]:
    return (
        forecast["phenomenon"],
        forecast["geometry_or_area"],
        forecast["valid_at"],
        forecast["unit"],
    )


def _build_result(
    *,
    status: str,
    manifest: EventManifest,
    issued_cutoff_at: object,
    evaluation_cutoff_at: object,
    model_versions: set[str],
    matched_pairs: list[dict],
    excluded_counts: dict[str, int],
    leakage_checks: dict,
    metrics: dict | None,
    rejections: list[dict],
) -> dict:
    return {
        "status": status,
        "event_id": manifest.event_id,
        "issued_cutoff_at": _iso(issued_cutoff_at),
        "evaluation_cutoff_at": _iso(evaluation_cutoff_at),
        "model_versions": sorted(model_versions),
        "matched_pairs": matched_pairs,
        "excluded_counts": excluded_counts,
        "leakage_checks": leakage_checks,
        "metrics": metrics,
        "rejections": rejections,
        "promotion_allowed": False,
        "public_warning_ready": False,
        "automatic_dispatch_ready": False,
    }


def evaluate_replay(
    manifest: EventManifest,
    forecasts: list[dict],
    *,
    issued_cutoff_at: datetime,
    evaluation_cutoff_at: datetime,
) -> dict:
    """Score as-issued forecasts against eligible independent observations.

    ``issued_cutoff_at`` freezes the forecast inputs.  ``evaluation_cutoff_at``
    is the later (or equal) moment at which truth collection is declared
    complete.  The result is a plain JSON-serialisable dictionary; see the
    module docstring and the task contract for field semantics.
    """
    if not isinstance(manifest, EventManifest):
        raise TypeError("manifest 必须是已通过 EventManifest 校验的事件清单")

    rejections: list[dict] = []
    lineage_violations: list[str] = []
    lineage_incomplete = False
    model_versions: set[str] = set()

    issued_parsed = _as_utc8_datetime(issued_cutoff_at)
    evaluation_parsed = _as_utc8_datetime(evaluation_cutoff_at)
    issued_ok = issued_parsed is not None
    evaluation_ok = evaluation_parsed is not None
    if issued_ok:
        issued_cutoff_at = issued_parsed
    if evaluation_ok:
        evaluation_cutoff_at = evaluation_parsed
    if not issued_ok:
        rejections.append(_rejection(
            "cutoff_timezone_invalid",
            "issued_cutoff_at 必须是带 UTC+08:00 偏移的 datetime",
        ))
    if not evaluation_ok:
        rejections.append(_rejection(
            "cutoff_timezone_invalid",
            "evaluation_cutoff_at 必须是带 UTC+08:00 偏移的 datetime",
        ))

    timing_usable = issued_ok and evaluation_ok
    if timing_usable and evaluation_cutoff_at < issued_cutoff_at:
        timing_usable = False
        rejections.append(_rejection(
            "evaluation_before_issue",
            "evaluation_cutoff_at 不得早于 issued_cutoff_at",
        ))

    if not isinstance(forecasts, list):
        rejections.append(_rejection(
            "forecasts_not_a_list", "forecasts 必须是显式列表"
        ))
        forecast_entries: list = []
        lineage_incomplete = True
    else:
        forecast_entries = forecasts

    record_by_id = {record.record_id: record for record in manifest.records}

    usable: list[dict] = []
    seen_forecast_ids: set[str] = set()
    seen_forecast_keys: set[tuple] = set()

    for entry in forecast_entries:
        if not isinstance(entry, dict):
            rejections.append(_rejection(
                "forecast_not_mapping", "forecast 必须是字典"
            ))
            lineage_incomplete = True
            continue

        version = entry.get("model_version")
        if isinstance(version, str) and version:
            model_versions.add(version)

        forecast_id = entry.get("forecast_id")
        forecast_id_ok = isinstance(forecast_id, str) and bool(forecast_id)
        if not forecast_id_ok:
            forecast_id = None
            rejections.append(_rejection(
                "forecast_id_invalid", "forecast_id 必须是非空字符串"
            ))

        missing = sorted(FORECAST_REQUIRED_FIELDS - set(entry))
        unexpected = sorted(
            set(entry) - FORECAST_REQUIRED_FIELDS - FORECAST_OPTIONAL_FIELDS
        )
        if missing:
            rejections.append(_rejection(
                "forecast_missing_fields",
                "缺少字段: " + ", ".join(missing),
                forecast_id=forecast_id,
            ))
            lineage_incomplete = True
            continue
        if unexpected:
            rejections.append(_rejection(
                "forecast_unexpected_fields",
                "不允许的字段: " + ", ".join(unexpected),
                forecast_id=forecast_id,
            ))
            lineage_incomplete = True
            continue
        if not forecast_id_ok:
            lineage_incomplete = True
            continue

        problems: list[dict] = []

        issued_at = _as_utc8_datetime(entry.get("issued_at"))
        valid_at = _as_utc8_datetime(entry.get("valid_at"))
        issued_at_ok = issued_at is not None
        valid_at_ok = valid_at is not None
        if not issued_at_ok:
            problems.append(_rejection(
                "forecast_issued_at_invalid",
                "issued_at 必须是带 UTC+08:00 偏移的 datetime",
                forecast_id=forecast_id,
            ))
        if not valid_at_ok:
            problems.append(_rejection(
                "forecast_valid_at_invalid",
                "valid_at 必须是带 UTC+08:00 偏移的 datetime",
                forecast_id=forecast_id,
            ))
        if issued_at_ok and valid_at_ok and issued_at >= valid_at:
            problems.append(_rejection(
                "forecast_valid_at_not_after_issue",
                "valid_at 必须晚于 issued_at",
                forecast_id=forecast_id,
            ))
        if timing_usable and issued_at_ok and issued_at > issued_cutoff_at:
            problems.append(_rejection(
                "forecast_issued_after_cutoff",
                "issued_at 晚于 issued_cutoff_at",
                forecast_id=forecast_id,
            ))
        if timing_usable and valid_at_ok and valid_at <= issued_cutoff_at:
            problems.append(_rejection(
                "forecast_valid_at_not_after_cutoff",
                "valid_at 必须晚于 issued_cutoff_at",
                forecast_id=forecast_id,
            ))

        phenomenon = entry.get("phenomenon")
        phenomenon_ok = isinstance(phenomenon, str) and phenomenon in PHENOMENON_UNITS
        if not phenomenon_ok:
            problems.append(_rejection(
                "forecast_phenomenon_invalid",
                "phenomenon 不在五城契约的现象集合中",
                forecast_id=forecast_id,
            ))

        geometry = entry.get("geometry_or_area")
        geometry_ok = isinstance(geometry, str) and bool(geometry)
        if not geometry_ok:
            problems.append(_rejection(
                "forecast_geometry_invalid",
                "geometry_or_area 必须是非空字符串",
                forecast_id=forecast_id,
            ))

        unit = entry.get("unit")
        unit_ok = isinstance(unit, str) and bool(unit)
        if not unit_ok:
            problems.append(_rejection(
                "forecast_unit_invalid",
                "unit 必须是非空字符串",
                forecast_id=forecast_id,
            ))
        elif phenomenon_ok and unit not in PHENOMENON_UNITS[phenomenon]:
            problems.append(_rejection(
                "forecast_unit_not_allowed",
                f"{phenomenon} 不允许单位 {unit!r}",
                forecast_id=forecast_id,
            ))

        version_ok = isinstance(version, str) and bool(version)
        if not version_ok:
            problems.append(_rejection(
                "forecast_model_version_invalid",
                "model_version 必须是非空字符串",
                forecast_id=forecast_id,
            ))

        forecast_value, value_reason = _finite_number(entry.get("value"))
        if value_reason == "non_finite":
            problems.append(_rejection(
                "forecast_value_not_finite",
                "forecast value 必须是有限数值",
                forecast_id=forecast_id,
            ))
        elif value_reason == "non_numeric":
            problems.append(_rejection(
                "forecast_value_not_numeric",
                "forecast value 必须是数值",
                forecast_id=forecast_id,
            ))

        truth_record_id = entry.get("truth_record_id")
        truth_record_id_ok = truth_record_id is None or (
            isinstance(truth_record_id, str) and bool(truth_record_id)
        )
        if not truth_record_id_ok:
            problems.append(_rejection(
                "truth_record_id_invalid",
                "truth_record_id 必须是非空字符串",
                forecast_id=forecast_id,
            ))

        if forecast_id in seen_forecast_ids:
            problems.append(_rejection(
                "duplicate_forecast_id",
                "forecast_id 重复",
                forecast_id=forecast_id,
            ))
        else:
            seen_forecast_ids.add(forecast_id)

        if (
            forecast_id_ok
            and issued_at_ok
            and valid_at_ok
            and phenomenon_ok
            and geometry_ok
            and unit_ok
            and version_ok
        ):
            key = (phenomenon, geometry, valid_at, unit, version)
            if key in seen_forecast_keys:
                problems.append(_rejection(
                    "duplicate_forecast_key",
                    "同一现象、区域、有效时间、单位和模型版本重复",
                    forecast_id=forecast_id,
                ))
            else:
                seen_forecast_keys.add(key)

        # Input lineage is audited even when the forecast has other problems.
        input_record_ids = entry.get("input_record_ids")
        lineage_ok = isinstance(input_record_ids, list) and not any(
            not isinstance(item, str) or not item for item in input_record_ids
        )
        if not lineage_ok:
            lineage_incomplete = True
            problems.append(_rejection(
                "input_lineage_invalid",
                "input_record_ids 必须是字符串列表",
                forecast_id=forecast_id,
            ))
        else:
            if not input_record_ids:
                lineage_incomplete = True
            elif not issued_at_ok:
                lineage_incomplete = True
            else:
                for input_record_id in sorted(set(input_record_ids)):
                    record = record_by_id.get(input_record_id)
                    if record is None:
                        reason = "引用的记录不存在"
                    elif record.evidence_class not in INPUT_EVIDENCE_CLASSES:
                        reason = (
                            "输入证据类别为 "
                            f"{record.evidence_class}，只允许 observation 或 historical_record"
                        )
                    elif record.missing_status != "present" or record.value is None:
                        reason = "输入记录不是可用的非缺失版本"
                    elif record.available_at is None:
                        reason = "输入记录缺少 available_at"
                    elif not _has_utc8_offset(record.available_at):
                        reason = "输入记录的 available_at 不是 UTC+08:00"
                    elif record.available_at > issued_at:
                        reason = "输入记录在 issued_at 之后才可获得"
                    elif record.observed_at is not None and not _has_utc8_offset(
                        record.observed_at
                    ):
                        reason = "输入记录的 observed_at 不是 UTC+08:00"
                    elif record.observed_at is not None and record.observed_at > issued_at:
                        reason = "输入记录的观测时刻晚于 issued_at"
                    else:
                        reason = None
                    if reason is not None:
                        message = (
                            f"{forecast_id}: 输入 {input_record_id} 泄漏风险: {reason}"
                        )
                        lineage_violations.append(message)
                        problems.append(_rejection(
                            "input_lineage_leak",
                            reason,
                            forecast_id=forecast_id,
                            record_id=input_record_id,
                        ))

        if problems:
            rejections.extend(problems)
            continue

        usable.append({
            "forecast_id": forecast_id,
            "issued_at": issued_at,
            "valid_at": valid_at,
            "geometry_or_area": geometry,
            "phenomenon": phenomenon,
            "value": forecast_value,
            "unit": unit,
            "model_version": version,
            "truth_record_id": truth_record_id,
        })

    input_lineage_verified = (
        bool(forecast_entries)
        and not lineage_incomplete
        and not lineage_violations
    )
    leakage_checks = {
        "passed": (not lineage_violations) and input_lineage_verified,
        "violations": sorted(set(lineage_violations)),
        "input_lineage_verified": input_lineage_verified,
    }

    if not timing_usable:
        return _build_result(
            status="rejected",
            manifest=manifest,
            issued_cutoff_at=issued_cutoff_at,
            evaluation_cutoff_at=evaluation_cutoff_at,
            model_versions=model_versions,
            matched_pairs=[],
            excluded_counts=_empty_excluded_counts(),
            leakage_checks=leakage_checks,
            metrics=None,
            rejections=_sorted_rejections(rejections),
        )

    excluded = _empty_excluded_counts()
    eligible = []
    for record in manifest.records:
        reason = _truth_exclusion(record, evaluation_cutoff_at)
        if reason is None:
            eligible.append(record)
            continue
        excluded[reason] += 1
        if reason == "non_observation":
            continue
        if reason == "non_finite_value":
            rejections.append(_rejection(
                "non_finite_observation_value",
                "观测值不是有限数值",
                record_id=record.record_id,
            ))
        elif reason == "invalid_time_offset":
            rejections.append(_rejection(
                "observation_time_timezone_invalid",
                "观测记录时间不是 UTC+08:00",
                record_id=record.record_id,
            ))

    truth_groups: dict[tuple, list] = defaultdict(list)
    for record in eligible:
        truth_groups[_observation_key(record)].append(record)

    truth_by_key: dict[tuple, object] = {}
    for key in sorted(
        truth_groups,
        key=lambda item: (item[0], item[1], item[2].isoformat(), item[3]),
    ):
        group = sorted(truth_groups[key], key=lambda record: record.record_id)
        if len(group) > 1:
            excluded["duplicate_truth_key"] += len(group)
            rejections.append(_rejection(
                "duplicate_truth_key",
                "同一现象、区域、有效时间和单位存在多条合格观测: "
                + ", ".join(record.record_id for record in group),
                record_id=group[0].record_id,
            ))
            continue
        truth_by_key[key] = group[0]

    eligible_by_id = {record.record_id: record for record in truth_by_key.values()}
    units_by_space_time: dict[tuple, set[str]] = defaultdict(set)
    for record in eligible:
        units_by_space_time[
            (record.phenomenon, record.spatial.geometry_or_area, record.observed_at)
        ].add(record.unit)

    matched_pairs: list[dict] = []
    matched_record_ids: set[str] = set()
    forecast_units_by_space_time: dict[tuple, set[str]] = defaultdict(set)
    for forecast in usable:
        forecast_units_by_space_time[
            (forecast["phenomenon"], forecast["geometry_or_area"], forecast["valid_at"])
        ].add(forecast["unit"])

    for forecast in sorted(
        usable, key=lambda item: (item["forecast_id"], item["model_version"])
    ):
        forecast_id = forecast["forecast_id"]
        truth_record_id = forecast.get("truth_record_id")

        if truth_record_id is not None:
            record = record_by_id.get(truth_record_id)
            if record is None:
                rejections.append(_rejection(
                    "truth_record_missing",
                    "truth_record_id 引用的记录不存在",
                    forecast_id=forecast_id,
                    record_id=truth_record_id,
                ))
                continue
            if record.evidence_class != "observation":
                rejections.append(_rejection(
                    "truth_evidence_class_not_observation",
                    f"truth_record_id 指向 {record.evidence_class}，不能作为观测真值",
                    forecast_id=forecast_id,
                    record_id=truth_record_id,
                ))
                continue
            if truth_record_id not in eligible_by_id:
                reason = _truth_exclusion(record, evaluation_cutoff_at)
                if reason is None:
                    reason = "duplicate_truth_key"
                rejections.append(_rejection(
                    "truth_record_not_eligible",
                    f"truth_record_id 不合格: {reason}",
                    forecast_id=forecast_id,
                    record_id=truth_record_id,
                ))
                continue
            same_place_time = (
                record.phenomenon == forecast["phenomenon"]
                and record.spatial.geometry_or_area == forecast["geometry_or_area"]
                and record.observed_at == forecast["valid_at"]
            )
            if not same_place_time:
                rejections.append(_rejection(
                    "truth_record_mismatch",
                    "truth_record_id 与 forecast 的现象、区域或有效时间不一致",
                    forecast_id=forecast_id,
                    record_id=truth_record_id,
                ))
                continue
            if record.unit != forecast["unit"]:
                rejections.append(_rejection(
                    "unit_mismatch",
                    f"forecast 单位 {forecast['unit']!r} 与观测单位 {record.unit!r} 不一致",
                    forecast_id=forecast_id,
                    record_id=truth_record_id,
                ))
                continue
            pair_record = record
        else:
            pair_record = truth_by_key.get(_forecast_match_key(forecast))
            if pair_record is None:
                excluded["unmatched_forecast"] += 1
                space_time = (
                    forecast["phenomenon"],
                    forecast["geometry_or_area"],
                    forecast["valid_at"],
                )
                units = units_by_space_time.get(space_time, set())
                if units and forecast["unit"] not in units:
                    rejections.append(_rejection(
                        "unit_mismatch",
                        "forecast 单位 "
                        f"{forecast['unit']!r} 与该时刻合格观测的单位 "
                        f"{sorted(units)!r} 不一致",
                        forecast_id=forecast_id,
                    ))
                # If the unit is present but truth_by_key has no entry, the
                # truth key was rejected as a duplicate above.
                continue

        observed_value = float(pair_record.value)
        residual = forecast["value"] - observed_value
        if not math.isfinite(residual):
            rejections.append(_rejection(
                "non_finite_residual",
                "预报值与观测值之差不是有限数值",
                forecast_id=forecast_id,
                record_id=pair_record.record_id,
            ))
            continue
        matched_pairs.append({
            "forecast_id": forecast_id,
            "record_id": pair_record.record_id,
            "phenomenon": forecast["phenomenon"],
            "geometry_or_area": forecast["geometry_or_area"],
            "valid_at": forecast["valid_at"].isoformat(),
            "observed_at": pair_record.observed_at.isoformat(),
            "unit": forecast["unit"],
            "model_version": forecast["model_version"],
            "forecast_value": forecast["value"],
            "observed_value": observed_value,
            "residual": residual,
        })
        matched_record_ids.add(pair_record.record_id)

    for record in truth_by_key.values():
        if record.record_id in matched_record_ids:
            continue
        space_time = (
            record.phenomenon,
            record.spatial.geometry_or_area,
            record.observed_at,
        )
        forecast_units = forecast_units_by_space_time.get(space_time, set())
        if forecast_units and record.unit not in forecast_units:
            excluded["unit_mismatch"] += 1
        else:
            excluded["no_matching_forecast"] += 1

    matched_pairs.sort(
        key=lambda pair: (
            pair["forecast_id"],
            pair["record_id"],
            pair["model_version"],
        )
    )

    metrics: dict | None = None
    status = "insufficient_data"
    if rejections:
        status = "rejected"
        matched_pairs = []
    elif matched_pairs:
        residuals = [pair["residual"] for pair in matched_pairs]
        try:
            count = len(residuals)
            mae = math.fsum(abs(value) for value in residuals) / count
            rmse = math.sqrt(
                math.fsum(value * value for value in residuals) / count
            )
            bias = math.fsum(residuals) / count
        except OverflowError:
            mae = rmse = bias = math.inf
        if not all(math.isfinite(value) for value in (mae, rmse, bias)):
            rejections.append(_rejection(
                "non_finite_metric",
                "指标计算结果不是有限数值",
            ))
            status = "rejected"
            matched_pairs = []
            metrics = None
        else:
            metrics = {"mae": mae, "rmse": rmse, "bias": bias}
            status = "evaluated"

    return _build_result(
        status=status,
        manifest=manifest,
        issued_cutoff_at=issued_cutoff_at,
        evaluation_cutoff_at=evaluation_cutoff_at,
        model_versions=model_versions,
        matched_pairs=matched_pairs,
        excluded_counts=excluded,
        leakage_checks=leakage_checks,
        metrics=metrics,
        rejections=_sorted_rejections(rejections),
    )
