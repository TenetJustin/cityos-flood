"""Deterministic descriptive snapshots for canonical realtime observations.

This module only aggregates records produced by
:mod:`backend.app.realtime_ingestion`.  It never fetches data, reads files, uses
environment variables, trains a model, publishes warnings, or dispatches
resources.  Every result keeps the four capability flags ``False``.

The snapshot is deliberately descriptive: it reports counts, extrema, means,
latencies, provenance, and missing city/phenomenon combinations.  It never
computes trends, probabilities, risk levels, or causal statements, and it never
fills missing values with zero, a historical mean, or a simulated value.
"""
from __future__ import annotations

import hashlib
import json
import math
import statistics
from datetime import datetime

from .realtime_ingestion import (
    CANONICAL_OPTIONAL_FIELDS,
    CANONICAL_REQUIRED_FIELDS,
    ALL_CITY_ORDER,
    CITY_ORDER,
    canonical_record_id,
    InvalidFreshnessConfig,
    PHENOMENON_ORDER,
    empty_rejected_counts,
    iso_shanghai,
    normalize_freshness_limits,
    normalize_city_order,
    parse_aware_datetime,
    record_content_fingerprint,
    validate_city,
    validate_coordinate,
    validate_crs,
    validate_phenomenon,
    validate_quality_flags,
    validate_unit,
    validate_value,
    validate_vertical_datum,
)

CITY_RANK = {city: index for index, city in enumerate(ALL_CITY_ORDER)}
PHENOMENON_RANK = {
    phenomenon: index for index, phenomenon in enumerate(PHENOMENON_ORDER)
}

SNAPSHOT_REQUIRED_FIELDS = tuple(
    field for field in CANONICAL_REQUIRED_FIELDS
    if field != "provider_published_at"
)
SNAPSHOT_ALLOWED_FIELDS = frozenset(
    {*SNAPSHOT_REQUIRED_FIELDS, "provider_published_at", *CANONICAL_OPTIONAL_FIELDS}
)

_QUALITY_EXCLUSION_PRIORITY = ("rejected", "suspect")


def _safe_field_name(key: object) -> str:
    if isinstance(key, str):
        return key[:64]
    return f"<{type(key).__name__}>"


def _record_payload(record: dict) -> dict:
    """Return the JSON-normalised canonical projection used for output/hash."""
    return {
        "record_id": record["record_id"],
        "provider_id": record["provider_id"],
        "provider_record_id": record["provider_record_id"],
        "provider_record_version": record["provider_record_version"],
        "city_id": record["city_id"],
        "phenomenon": record["phenomenon"],
        "station_id": record["station_id"],
        "geometry_or_area": record["geometry_or_area"],
        "longitude": record["longitude"],
        "latitude": record["latitude"],
        "horizontal_crs": record["horizontal_crs"],
        "vertical_datum": record["vertical_datum"],
        "value": record["value"],
        "unit": record["unit"],
        "observed_at": iso_shanghai(record["observed_at"]),
        "provider_published_at": (
            iso_shanghai(record["provider_published_at"])
            if record["provider_published_at"] is not None else None
        ),
        "received_at": iso_shanghai(record["received_at"]),
        "processed_at": iso_shanghai(record["processed_at"]),
        "available_at": iso_shanghai(record["available_at"]),
        "source_name": record["source_name"],
        "source_reference": record["source_reference"],
        "license_id": record["license_id"],
        "quality_flags": list(record["quality_flags"]),
        "latency_seconds": record["_latency_seconds"],
        "ingestion_latency_seconds": record["_ingestion_latency_seconds"],
    }


def _normalise_record(
    raw: object,
    *,
    allowed_city_ids: frozenset[str],
) -> tuple[dict | None, str | None]:
    """Validate a canonical record; return (record, quality_exclusion_code)."""
    if not isinstance(raw, dict):
        return None, "invalid_record"

    non_string_keys = sorted({
        _safe_field_name(key) for key in raw if not isinstance(key, str)
    })
    if non_string_keys:
        return None, "extra_field"
    extra = sorted(set(raw) - SNAPSHOT_ALLOWED_FIELDS)
    if extra:
        return None, "extra_field"
    missing = [field for field in SNAPSHOT_REQUIRED_FIELDS if field not in raw]
    if missing:
        return None, "missing_field"

    record_id = raw["record_id"]
    if not isinstance(record_id, str) or not record_id:
        return None, "invalid_record"
    for field in (
        "provider_id",
        "provider_record_id",
        "provider_record_version",
        "station_id",
        "geometry_or_area",
        "source_name",
        "source_reference",
        "license_id",
    ):
        if not isinstance(raw[field], str) or not raw[field]:
            return None, "invalid_record"

    code = validate_city(raw["city_id"], city_ids=allowed_city_ids)
    if code:
        return None, code
    city_id = raw["city_id"]
    code = validate_phenomenon(raw["phenomenon"])
    if code:
        return None, code
    phenomenon = raw["phenomenon"]
    code = validate_unit(phenomenon, raw["unit"])
    if code:
        return None, code
    unit = raw["unit"]
    code = validate_vertical_datum(phenomenon, raw["vertical_datum"])
    if code:
        return None, code
    vertical_datum = raw["vertical_datum"]
    value, code = validate_value(phenomenon, raw["value"])
    if code:
        return None, code
    longitude, code = validate_coordinate(raw["longitude"], 180.0)
    if code:
        return None, code
    latitude, code = validate_coordinate(raw["latitude"], 90.0)
    if code:
        return None, code
    if not validate_crs(raw["horizontal_crs"]):
        return None, "invalid_crs"
    quality_flags, code = validate_quality_flags(raw["quality_flags"])
    if code:
        return None, code
    assert quality_flags is not None

    observed_at = parse_aware_datetime(raw["observed_at"])
    received_at = parse_aware_datetime(raw["received_at"])
    processed_at = parse_aware_datetime(raw["processed_at"])
    available_at = parse_aware_datetime(raw["available_at"])
    if any(stamp is None for stamp in (
        observed_at, received_at, processed_at, available_at
    )):
        return None, "naive_datetime"
    assert observed_at is not None
    assert received_at is not None
    assert processed_at is not None
    assert available_at is not None

    provider_published_at: datetime | None = None
    if raw.get("provider_published_at") not in (None, ""):
        provider_published_at = parse_aware_datetime(
            raw.get("provider_published_at")
        )
        if provider_published_at is None:
            return None, "naive_datetime"

    if available_at != processed_at:
        return None, "invalid_record"
    if received_at > processed_at:
        return None, "invalid_time_order"
    if observed_at > received_at:
        return None, "future_observation"
    if provider_published_at is not None and provider_published_at > received_at:
        return None, "invalid_time_order"

    quality_code: str | None = None
    for flag in _QUALITY_EXCLUSION_PRIORITY:
        if flag in quality_flags:
            quality_code = f"{flag}_quality"
            break

    record = {
        "record_id": record_id,
        "provider_id": raw["provider_id"],
        "provider_record_id": raw["provider_record_id"],
        "provider_record_version": raw["provider_record_version"],
        "city_id": city_id,
        "phenomenon": phenomenon,
        "station_id": raw["station_id"],
        "geometry_or_area": raw["geometry_or_area"],
        "longitude": longitude,
        "latitude": latitude,
        "horizontal_crs": raw["horizontal_crs"],
        "vertical_datum": vertical_datum,
        "value": value,
        "unit": unit,
        "observed_at": observed_at,
        "provider_published_at": provider_published_at,
        "received_at": received_at,
        "processed_at": processed_at,
        "available_at": available_at,
        "source_name": raw["source_name"],
        "source_reference": raw["source_reference"],
        "license_id": raw["license_id"],
        "quality_flags": quality_flags,
        "_selectable": quality_code is None,
        "_latency_seconds": round(
            (available_at - observed_at).total_seconds(), 6
        ),
        "_ingestion_latency_seconds": round(
            (received_at - observed_at).total_seconds(), 6
        ),
    }
    record["_content_fingerprint"] = record_content_fingerprint(
        _record_payload(record)
    )
    if quality_code is not None:
        return record, quality_code
    expected_id = canonical_record_id(
        provider_id=record["provider_id"],
        provider_record_id=record["provider_record_id"],
        provider_record_version=record["provider_record_version"],
        city_id=city_id,
        phenomenon=phenomenon,
        station_id=record["station_id"],
        observed_at=observed_at,
    )
    if record_id != expected_id:
        return None, "invalid_record"
    if (
        "content_fingerprint" in raw
        and raw["content_fingerprint"] != record["_content_fingerprint"]
    ):
        return None, "invalid_record"
    return record, quality_code


def _version_primary(record: dict) -> tuple[datetime, bool, datetime]:
    published = record["provider_published_at"]
    return (
        record["available_at"],
        published is not None,
        published or record["available_at"],
    )


def _version_sort_key(record: dict) -> tuple[datetime, bool, datetime, str]:
    return (*_version_primary(record), record["record_id"])


def _exclusion_detail(
    code: str,
    *,
    record_id: str | None = None,
    provider_record_id: str | None = None,
) -> dict:
    return {
        "code": code,
        "record_id": record_id,
        "provider_record_id": provider_record_id,
    }


def _exclusion_sort_key(item: dict) -> tuple[str, str, str]:
    return (
        str(item.get("code") or ""),
        str(item.get("record_id") or ""),
        str(item.get("provider_record_id") or ""),
    )


def _unavailable_snapshot(
    *,
    limits: dict[str, int],
    rejected_counts: dict[str, int],
    provenance: dict,
    as_of_iso: str | None,
    city_order: tuple[str, ...],
) -> dict:
    city_status = {city: "unavailable" for city in city_order}
    missing = [
        {"city_id": city, "phenomenon": phenomenon}
        for city in city_order
        for phenomenon in PHENOMENON_ORDER
    ]
    payload = {
        "as_of": as_of_iso,
        "freshness_limits_minutes": limits,
        "status": "unavailable",
        "city_status": city_status,
        "summaries": [],
        "missing_city_phenomena": missing,
        "version_chains": [],
        "selected_records": [],
    }
    snapshot_id = _snapshot_id(payload)
    return {
        "snapshot_id": snapshot_id,
        "as_of": as_of_iso,
        "status": "unavailable",
        "city_status": city_status,
        "summaries": [],
        "rejected_counts": rejected_counts,
        "missing_city_phenomena": missing,
        "provenance": {
            **provenance,
            "excluded_counts": dict(rejected_counts),
            "note": (
                "没有可用的实时观测；不补零、不使用历史均值、不生成模拟值。"
                "仅描述性核心，不得用于同化、公众预警或调度。"
            ),
        },
        "version_chains": [],
        "descriptive_analysis_available": False,
        "forecast_input_ready": False,
        "model_assimilation_ready": False,
        "public_warning_ready": False,
        "automatic_dispatch_ready": False,
    }


def _snapshot_id(payload: dict) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _build_version_chains(
    pool: list[dict],
    *,
    rejected_counts: dict[str, int],
    conflict_details: list[dict],
) -> tuple[list[dict], list[dict], bool, int]:
    """Return chains, selected records, conflict flag, superseded count."""
    conflicts = False
    chain_groups: dict[tuple, list[dict]] = {}
    for record in pool:
        key = (
            record["city_id"],
            record["phenomenon"],
            record["station_id"],
            record["observed_at"],
            record["provider_id"],
        )
        chain_groups.setdefault(key, []).append(record)

    cross_groups: dict[tuple, set[str]] = {}
    for record in pool:
        if not record["_selectable"]:
            continue
        key = (
            record["city_id"],
            record["phenomenon"],
            record["station_id"],
            record["observed_at"],
        )
        cross_groups.setdefault(key, set()).add(record["provider_id"])
    for key, providers in sorted(
        cross_groups.items(),
        key=lambda item: (
            CITY_RANK[item[0][0]],
            PHENOMENON_RANK[item[0][1]],
            item[0][2],
            item[0][3].isoformat(),
        ),
    ):
        if len(providers) > 1:
            conflicts = True
            rejected_counts["cross_provider_conflict"] += 1
            conflict_details.append({
                "code": "cross_provider_conflict",
                "city_id": key[0],
                "phenomenon": key[1],
                "station_id": key[2],
                "observed_at": iso_shanghai(key[3]),
                "provider_count": len(providers),
            })

    chains: list[dict] = []
    selected: list[dict] = []
    superseded_count = 0
    for key in sorted(
        chain_groups,
        key=lambda item: (
            CITY_RANK[item[0]],
            PHENOMENON_RANK[item[1]],
            item[2],
            item[3].isoformat(),
            item[4],
        ),
    ):
        group = sorted(chain_groups[key], key=_version_sort_key)
        selectable = [record for record in group if record["_selectable"]]
        if selectable:
            units = {record["unit"] for record in selectable}
            datums = {record["vertical_datum"] for record in selectable}
            if len(units) > 1 or len(datums) > 1:
                conflicts = True
                rejected_counts["version_conflict"] += 1
                conflict_details.append({
                    "code": "version_conflict",
                    "city_id": key[0],
                    "phenomenon": key[1],
                    "station_id": key[2],
                    "observed_at": iso_shanghai(key[3]),
                    "provider_id": key[4],
                    "reason": "unit_or_vertical_datum_changed_in_chain",
                })
            latest_primary = _version_primary(selectable[-1])
            top = [
                record for record in selectable
                if _version_primary(record) == latest_primary
            ]
            if len(top) > 1 and len({
                record["_content_fingerprint"] for record in top
            }) > 1:
                conflicts = True
                rejected_counts["version_conflict"] += 1
                conflict_details.append({
                    "code": "version_conflict",
                    "city_id": key[0],
                    "phenomenon": key[1],
                    "station_id": key[2],
                    "observed_at": iso_shanghai(key[3]),
                    "provider_id": key[4],
                    "reason": "ambiguous_latest_available_version",
                })
            selected_record = selectable[-1]
            selected.append(selected_record)
            superseded = [
                record for record in selectable
                if record["record_id"] != selected_record["record_id"]
            ]
            superseded_count += len(superseded)
        else:
            selected_record = None
            superseded = []

        versions = []
        for record in group:
            if selected_record is not None and (
                record["record_id"] == selected_record["record_id"]
            ):
                status = "selected"
            elif record["_selectable"]:
                status = "superseded"
            else:
                status = "excluded_quality"
            versions.append({
                "record_id": record["record_id"],
                "provider_id": record["provider_id"],
                "provider_record_id": record["provider_record_id"],
                "provider_record_version": record["provider_record_version"],
                "available_at": iso_shanghai(record["available_at"]),
                "value": record["value"],
                "quality_flags": list(record["quality_flags"]),
                "status": status,
            })
        chains.append({
            "city_id": key[0],
            "phenomenon": key[1],
            "station_id": key[2],
            "observed_at": iso_shanghai(key[3]),
            "provider_id": key[4],
            "versions": versions,
            "selected_record_id": (
                selected_record["record_id"]
                if selected_record is not None else None
            ),
            "superseded_record_ids": [
                record["record_id"] for record in superseded
            ],
            "excluded_record_ids": [
                record["record_id"] for record in group
                if not record["_selectable"]
            ],
        })
    return chains, selected, conflicts, superseded_count


def _summary_sort_key(summary: dict) -> tuple[int, int, str, str]:
    return (
        CITY_RANK[summary["city_id"]],
        PHENOMENON_RANK[summary["phenomenon"]],
        summary["unit"],
        summary["vertical_datum"] or "",
    )


def _build_summaries(
    selected: list[dict],
    *,
    as_of: datetime,
    limits: dict[str, int],
) -> list[dict]:
    groups: dict[tuple, list[dict]] = {}
    for record in selected:
        key = (
            record["city_id"],
            record["phenomenon"],
            record["unit"],
            record["vertical_datum"],
        )
        groups.setdefault(key, []).append(record)

    summaries: list[dict] = []
    for key in sorted(
        groups,
        key=lambda item: (
            CITY_RANK[item[0]],
            PHENOMENON_RANK[item[1]],
            item[2],
            item[3] or "",
        ),
    ):
        city_id, phenomenon, unit, vertical_datum = key
        records = sorted(
            groups[key],
            key=lambda record: (record["observed_at"], record["record_id"]),
        )
        fresh_count = 0
        stale_count = 0
        limit_seconds = limits[phenomenon] * 60
        for record in records:
            age_seconds = (as_of - record["observed_at"]).total_seconds()
            if age_seconds <= limit_seconds:
                fresh_count += 1
            else:
                stale_count += 1

        summary = {
            "city_id": city_id,
            "phenomenon": phenomenon,
            "unit": unit,
            "vertical_datum": vertical_datum,
            "record_count": len(records),
            "station_count": len({record["station_id"] for record in records}),
            "fresh_count": fresh_count,
            "stale_count": stale_count,
            "provisional_count": sum(
                "provisional" in record["quality_flags"]
                for record in records
            ),
            "latest_observed_at": iso_shanghai(
                max(record["observed_at"] for record in records)
            ),
            "latest_available_at": iso_shanghai(
                max(record["available_at"] for record in records)
            ),
            "minimum": None,
            "maximum": None,
            "mean": None,
            "median_latency_seconds": float(statistics.median([
                record["_latency_seconds"] for record in records
            ])),
            "source_ids": sorted({record["provider_id"] for record in records}),
        }

        if phenomenon == "road_closure":
            summary["true_count"] = sum(
                record["value"] is True for record in records
            )
            summary["false_count"] = sum(
                record["value"] is False for record in records
            )
        else:
            values = [float(record["value"]) for record in records]
            summary["minimum"] = min(values)
            summary["maximum"] = max(values)
            try:
                mean = math.fsum(values) / len(values)
            except OverflowError:
                mean = None
            if mean is not None and not math.isfinite(mean):
                mean = None
            summary["mean"] = mean
        summaries.append(summary)
    summaries.sort(key=_summary_sort_key)
    return summaries


def build_realtime_snapshot(
    records: list[dict],
    *,
    as_of: datetime,
    freshness_limits_minutes: dict[str, int] | None = None,
    city_order=CITY_ORDER,
) -> dict:
    """Build a deterministic descriptive snapshot from canonical records."""
    city_order = normalize_city_order(city_order)
    allowed_city_ids = frozenset(city_order)
    rejected_counts = empty_rejected_counts()
    excluded: list[dict] = []
    conflict_details: list[dict] = []
    as_of_dt = parse_aware_datetime(as_of)
    if as_of_dt is None:
        rejected_counts["naive_datetime"] += 1
        return _unavailable_snapshot(
            limits={},
            rejected_counts=rejected_counts,
            provenance={"input_record_count": 0},
            as_of_iso=None,
            city_order=city_order,
        )
    as_of_iso = iso_shanghai(as_of_dt)

    try:
        limits = normalize_freshness_limits(freshness_limits_minutes)
    except InvalidFreshnessConfig:
        rejected_counts["invalid_freshness_config"] += 1
        return _unavailable_snapshot(
            limits={},
            rejected_counts=rejected_counts,
            provenance={"input_record_count": 0},
            as_of_iso=as_of_iso,
            city_order=city_order,
        )

    if not isinstance(records, list):
        rejected_counts["invalid_record"] += 1
        return _unavailable_snapshot(
            limits=limits,
            rejected_counts=rejected_counts,
            provenance={"input_record_count": 0},
            as_of_iso=as_of_iso,
            city_order=city_order,
        )

    input_count = len(records)
    pool: list[dict] = []
    duplicate_count = 0
    for raw in records:
        try:
            record, quality_code = _normalise_record(
                raw, allowed_city_ids=allowed_city_ids
            )
        except Exception:  # noqa: BLE001 - malformed input must not escape
            record, quality_code = None, "invalid_record"
        if record is None:
            rejected_counts[quality_code or "invalid_record"] += 1
            provider_record_id = (
                raw.get("provider_record_id")
                if isinstance(raw, dict) else None
            )
            record_id = raw.get("record_id") if isinstance(raw, dict) else None
            excluded.append(_exclusion_detail(
                quality_code or "invalid_record",
                record_id=record_id if isinstance(record_id, str) else None,
                provider_record_id=(
                    provider_record_id
                    if isinstance(provider_record_id, str) else None
                ),
            ))
            continue
        if quality_code is not None:
            rejected_counts[quality_code] += 1
            excluded.append(_exclusion_detail(
                quality_code,
                record_id=record["record_id"],
                provider_record_id=record["provider_record_id"],
            ))
        pool.append(record)

    duplicate_groups: dict[str, list[dict]] = {}
    for record in pool:
        duplicate_groups.setdefault(record["record_id"], []).append(record)
    deduped: list[dict] = []
    for record_id in sorted(duplicate_groups):
        group = sorted(
            duplicate_groups[record_id],
            key=lambda record: (
                record["available_at"],
                record["received_at"],
                record["record_id"],
            ),
        )
        fingerprints = {
            record["_content_fingerprint"] for record in group
        }
        if len(fingerprints) > 1:
            rejected_counts["duplicate_conflict"] += 1
            conflict_details.append({
                "code": "duplicate_conflict",
                "record_id": record_id,
                "version_count": len(group),
            })
            deduped.append(group[0])
        else:
            deduped.append(group[0])
            duplicate_count += len(group) - 1

    available_pool: list[dict] = []
    for record in deduped:
        if record["available_at"] > as_of_dt:
            rejected_counts["not_yet_available"] += 1
            excluded.append(_exclusion_detail(
                "not_yet_available",
                record_id=record["record_id"],
                provider_record_id=record["provider_record_id"],
            ))
            continue
        if record["observed_at"] > as_of_dt:
            rejected_counts["future_observation"] += 1
            excluded.append(_exclusion_detail(
                "future_observation",
                record_id=record["record_id"],
                provider_record_id=record["provider_record_id"],
            ))
            continue
        available_pool.append(record)

    chains, selected, chain_conflict, superseded_count = _build_version_chains(
        available_pool,
        rejected_counts=rejected_counts,
        conflict_details=conflict_details,
    )
    batch_conflict = bool(conflict_details) or chain_conflict

    if batch_conflict:
        summaries: list[dict] = []
        city_status = {city: "unavailable" for city in city_order}
        missing = [
            {"city_id": city, "phenomenon": phenomenon}
            for city in city_order
            for phenomenon in PHENOMENON_ORDER
        ]
        status = "unavailable"
        descriptive = False
        selected_payload: list[dict] = []
    else:
        summaries = _build_summaries(
            selected, as_of=as_of_dt, limits=limits
        )
        covered = {
            (summary["city_id"], summary["phenomenon"])
            for summary in summaries
        }
        missing = [
            {"city_id": city, "phenomenon": phenomenon}
            for city in city_order
            for phenomenon in PHENOMENON_ORDER
            if (city, phenomenon) not in covered
        ]
        fresh_non_provisional = any(
            (as_of_dt - record["observed_at"]).total_seconds()
            <= limits[record["phenomenon"]] * 60
            and "provisional" not in record["quality_flags"]
            for record in selected
        )
        if not selected:
            status = "unavailable"
            descriptive = False
        elif missing:
            status = "degraded"
            descriptive = True
        elif not fresh_non_provisional:
            status = "degraded"
            descriptive = True
        else:
            status = "current"
            descriptive = True

        city_status = {}
        for city in city_order:
            city_records = [
                record for record in selected if record["city_id"] == city
            ]
            if not city_records:
                city_status[city] = "unavailable"
            elif any(
                (as_of_dt - record["observed_at"]).total_seconds()
                <= limits[record["phenomenon"]] * 60
                and "provisional" not in record["quality_flags"]
                for record in city_records
            ):
                city_status[city] = "current"
            else:
                city_status[city] = "degraded"
        selected_payload = [
            _record_payload(record)
            for record in sorted(selected, key=lambda item: item["record_id"])
        ]

    if not selected:
        status = "unavailable"
        descriptive = False

    rejected_counts_snapshot = dict(rejected_counts)
    provenance = {
        "input_record_count": input_count,
        "input_record_ids": sorted({
            record["record_id"] for record in pool
        }),
        "selected_record_ids": sorted({
            record["record_id"] for record in selected
        }),
        "provider_ids": sorted({
            record["provider_id"] for record in pool
        }),
        "source_ids": sorted({
            record["provider_id"] for record in selected
        }),
        "source_names": sorted({
            record["source_name"] for record in selected
        }),
        "duplicate_record_count": duplicate_count,
        "version_chain_count": len(chains),
        "superseded_count": superseded_count,
        "conflict_details": sorted(
            conflict_details,
            key=lambda item: (
                str(item.get("code") or ""),
                str(item.get("record_id") or ""),
                str(item.get("city_id") or ""),
                str(item.get("station_id") or ""),
            ),
        ),
        "excluded_records": sorted(excluded, key=_exclusion_sort_key),
        "excluded_counts": dict(rejected_counts),
        "freshness_limits_minutes": limits,
        "note": (
            "仅描述性统计；来源未独立认证；不得用于预测同化、公众预警或调度。"
        ),
    }

    payload = {
        "as_of": as_of_iso,
        "freshness_limits_minutes": limits,
        "status": status,
        "city_status": city_status,
        "summaries": summaries,
        "missing_city_phenomena": missing,
        "version_chains": chains,
        "selected_records": selected_payload,
    }
    return {
        "snapshot_id": _snapshot_id(payload),
        "as_of": as_of_iso,
        "status": status,
        "city_status": city_status,
        "summaries": summaries,
        "rejected_counts": rejected_counts_snapshot,
        "missing_city_phenomena": missing,
        "provenance": provenance,
        "version_chains": chains,
        "descriptive_analysis_available": descriptive,
        "forecast_input_ready": False,
        "model_assimilation_ready": False,
        "public_warning_ready": False,
        "automatic_dispatch_ready": False,
    }
