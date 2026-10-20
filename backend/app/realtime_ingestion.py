"""Fail-closed realtime observation ingestion core for configured city scopes.

This module defines the dependency-injection boundary for external providers and
normalises provider candidates into canonical, idempotent observation records.
It deliberately contains no HTTP client, credential lookup, retry loop, thread,
cache, database access, or model integration.  Tests use in-memory fake
providers only.

Key rules
---------
* A candidate has exactly the fields in :data:`CANDIDATE_FIELDS`; extra or
  non-string keys are rejected.
* Times must be timezone-aware.  Canonical output is converted to the fixed
  ``Asia/Shanghai`` UTC+08:00 offset without relying on tzdata files.
* ``available_at`` is exactly the caller-supplied ``processed_at``.
* ``observed_at <= received_at``, ``provider_published_at <= received_at`` and
  ``received_at <= processed_at <= until`` are enforced.
* ``value`` is never coerced from strings, booleans, empty values, NaN, or Inf.
* ``suspect`` records are accepted but remain non-selectable for analysis;
  ``rejected`` quality is rejected at ingestion.
* A canonical record id is a stable hash of the provider identity, version,
  city, phenomenon, station, and observation time.  Identical duplicates collapse;
  the same id with different content rejects the whole batch.
* Version order is decided by ``available_at`` first.  When a batch makes two
  versions available at exactly the same processed time, the provider's declared
  publication time is used only as a deterministic secondary tie-break; if that
  also ties and content differs, the batch is rejected as ``version_conflict``.
  Version strings are never parsed or numerically sorted.

The analysis module imports the pure helpers below.  ``poll_provider`` imports
:func:`realtime_analysis.build_realtime_snapshot` lazily so that importing
either module never creates a cycle.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Protocol

SHANGHAI = timezone(timedelta(hours=8), "Asia/Shanghai")

CITY_ORDER = ("shanghai", "ningbo", "fuzhou", "shenzhen", "haikou")
ZHEJIANG_CITY_ORDER = ("ningbo", "taizhou", "wenzhou", "hangzhou")
ALL_CITY_ORDER = tuple(dict.fromkeys((*CITY_ORDER, *ZHEJIANG_CITY_ORDER)))
CITY_IDS = frozenset(ALL_CITY_ORDER)


class InvalidCityScope(ValueError):
    """The requested snapshot city scope is unknown or ambiguous."""


def normalize_city_order(city_order) -> tuple[str, ...]:
    """Validate and freeze an explicit city scope for ingestion or snapshots."""
    if not isinstance(city_order, (tuple, list)):
        raise InvalidCityScope("city_order must be a list or tuple of city IDs")
    normalized = tuple(city_order)
    if (
        not normalized
        or any(not isinstance(city, str) or city not in CITY_IDS for city in normalized)
        or len(set(normalized)) != len(normalized)
    ):
        raise InvalidCityScope("city_order must contain unique supported city IDs")
    return normalized

PHENOMENON_ORDER = (
    "rainfall",
    "tide_level",
    "river_level",
    "flood_depth",
    "road_closure",
)
PHENOMENON_UNITS = {
    "rainfall": frozenset({"mm", "mm/h"}),
    "tide_level": frozenset({"m"}),
    "river_level": frozenset({"m"}),
    "flood_depth": frozenset({"m"}),
    "road_closure": frozenset({"boolean"}),
}
SUPPORTED_PHENOMENA = frozenset(PHENOMENON_ORDER)

QUALITY_FLAGS = frozenset({
    "raw",
    "provisional",
    "quality_controlled",
    "suspect",
    "rejected",
    "spatially_aggregated",
    "temporally_aggregated",
    "source_not_independently_verified",
    "unknown",
})

DEFAULT_FRESHNESS_LIMITS_MINUTES = {
    "rainfall": 30,
    "tide_level": 30,
    "river_level": 30,
    "flood_depth": 15,
    "road_closure": 15,
}

CANDIDATE_FIELDS = (
    "provider_record_id",
    "provider_record_version",
    "city_id",
    "phenomenon",
    "station_id",
    "geometry_or_area",
    "longitude",
    "latitude",
    "horizontal_crs",
    "vertical_datum",
    "value",
    "unit",
    "observed_at",
    "provider_published_at",
    "source_name",
    "source_reference",
    "license_id",
    "quality_flags",
)

CANONICAL_REQUIRED_FIELDS = (
    "record_id",
    "provider_id",
    *CANDIDATE_FIELDS,
    "received_at",
    "processed_at",
    "available_at",
)
CANONICAL_OPTIONAL_FIELDS = frozenset({
    "latency_seconds",
    "ingestion_latency_seconds",
    "content_fingerprint",
})

ALL_ERROR_CODES = (
    "unknown_city",
    "unknown_phenomenon",
    "extra_field",
    "missing_field",
    "naive_datetime",
    "invalid_time_order",
    "future_observation",
    "invalid_coordinate",
    "invalid_crs",
    "invalid_vertical_datum",
    "invalid_unit",
    "invalid_value",
    "invalid_quality_flag",
    "rejected_quality",
    "duplicate_conflict",
    "invalid_freshness_config",
    "provider_failure",
    "invalid_record",
    "suspect_quality",
    "not_yet_available",
    "cross_provider_conflict",
    "version_conflict",
)

_FINGERPRINT_EXCLUDED = frozenset({
    "record_id",
    "available_at",
    "received_at",
    "processed_at",
    "latency_seconds",
    "ingestion_latency_seconds",
    "content_fingerprint",
})


class InvalidFreshnessConfig(ValueError):
    """The caller-provided freshness limits violate the closed contract."""


class InvalidProviderResponse(TypeError):
    """The provider returned something other than a list of candidates."""


class RealtimeProvider(Protocol):
    """Dependency-injection boundary for an external realtime provider."""

    provider_id: str

    def fetch(
        self,
        *,
        since: datetime | None,
        until: datetime,
    ) -> list[dict]:
        ...


def normalize_freshness_limits(
    config: dict[str, int] | None,
) -> dict[str, int]:
    """Return a complete, ordered freshness configuration or raise."""
    if config is None:
        return {
            phenomenon: DEFAULT_FRESHNESS_LIMITS_MINUTES[phenomenon]
            for phenomenon in PHENOMENON_ORDER
        }
    if not isinstance(config, dict):
        raise InvalidFreshnessConfig("freshness limits must be a mapping")
    if set(config) != set(PHENOMENON_ORDER):
        raise InvalidFreshnessConfig(
            "freshness limits must contain exactly the supported phenomena"
        )
    normalized: dict[str, int] = {}
    for phenomenon in PHENOMENON_ORDER:
        value = config[phenomenon]
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise InvalidFreshnessConfig(
                "freshness limits must be positive integers"
            )
        normalized[phenomenon] = value
    return normalized


def parse_aware_datetime(value: object) -> datetime | None:
    """Parse an aware datetime or ISO-8601 string; naive/invalid returns None."""
    if isinstance(value, datetime):
        candidate = value
    elif isinstance(value, str):
        try:
            candidate = datetime.fromisoformat(value)
        except (TypeError, ValueError, OverflowError):
            return None
    else:
        return None
    try:
        if candidate.tzinfo is None or candidate.utcoffset() is None:
            return None
    except (TypeError, ValueError, OverflowError):
        return None
    return candidate


def to_shanghai(value: datetime) -> datetime:
    return value.astimezone(SHANGHAI)


def iso_shanghai(value: datetime) -> str:
    return to_shanghai(value).isoformat()


def _safe_iso(value: object) -> str | None:
    parsed = parse_aware_datetime(value)
    return iso_shanghai(parsed) if parsed is not None else None


def _non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _safe_field_name(key: object) -> str:
    if isinstance(key, str):
        return key[:64]
    return f"<{type(key).__name__}>"


def _safe_exception_type(exc: BaseException) -> str:
    name = type(exc).__name__ or "Exception"
    name = re.sub(r"[^A-Za-z0-9_]", "_", name)
    return name[:80]


def _rejected(
    code: str,
    detail: str,
    *,
    provider_record_id: str | None = None,
    field: str | None = None,
) -> dict:
    return {
        "code": code,
        "detail": detail,
        "provider_record_id": provider_record_id,
        "field": field,
    }


def _rejected_sort_key(item: dict) -> tuple[str, str, str, str]:
    return (
        str(item.get("code") or ""),
        str(item.get("provider_record_id") or ""),
        str(item.get("field") or ""),
        str(item.get("detail") or ""),
    )


def _sorted_rejections(items: list[dict]) -> list[dict]:
    seen: set[tuple[str, str, str, str]] = set()
    ordered: list[dict] = []
    for item in sorted(items, key=_rejected_sort_key):
        key = _rejected_sort_key(item)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    return ordered


def empty_rejected_counts() -> dict[str, int]:
    """Return a complete deterministic counter map."""
    return {code: 0 for code in ALL_ERROR_CODES}


def validate_city(value: object, *, city_ids=frozenset(CITY_IDS)) -> str | None:
    if not isinstance(value, str) or value not in city_ids:
        return "unknown_city"
    return None


def validate_phenomenon(value: object) -> str | None:
    if not isinstance(value, str) or value not in SUPPORTED_PHENOMENA:
        return "unknown_phenomenon"
    return None


def validate_unit(phenomenon: str, value: object) -> str | None:
    if not isinstance(value, str) or value not in PHENOMENON_UNITS[phenomenon]:
        return "invalid_unit"
    return None


def validate_vertical_datum(phenomenon: str, value: object) -> str | None:
    if value is None:
        if phenomenon in {"tide_level", "river_level"}:
            return "invalid_vertical_datum"
        return None
    if not isinstance(value, str) or not value.strip():
        return "invalid_vertical_datum"
    return None


def validate_value(
    phenomenon: str,
    value: object,
) -> tuple[float | bool | None, str | None]:
    if phenomenon == "road_closure":
        if not isinstance(value, bool):
            return None, "invalid_value"
        return value, None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, "invalid_value"
    try:
        number = float(value)
    except (OverflowError, ValueError):
        return None, "invalid_value"
    if not math.isfinite(number):
        return None, "invalid_value"
    return number, None


def validate_quality_flags(
    value: object,
) -> tuple[list[str] | None, str | None]:
    if not isinstance(value, (list, tuple)) or not value:
        return None, "invalid_quality_flag"
    flags: list[str] = []
    for item in value:
        if not isinstance(item, str) or item not in QUALITY_FLAGS:
            return None, "invalid_quality_flag"
        flags.append(item)
    return sorted(set(flags)), None


def validate_coordinate(
    value: object,
    limit: float,
) -> tuple[float | None, str | None]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, "invalid_coordinate"
    try:
        number = float(value)
    except (OverflowError, ValueError):
        return None, "invalid_coordinate"
    if not math.isfinite(number) or not -limit <= number <= limit:
        return None, "invalid_coordinate"
    return number, None


def validate_crs(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"EPSG:[0-9]+", value) is not None


def canonical_record_id(
    *,
    provider_id: str,
    provider_record_id: str,
    provider_record_version: str,
    city_id: str,
    phenomenon: str,
    station_id: str,
    observed_at: datetime,
) -> str:
    """Stable id from the seven contract fields; never random."""
    payload = json.dumps(
        [
            provider_id,
            provider_record_id,
            provider_record_version,
            city_id,
            phenomenon,
            station_id,
            iso_shanghai(observed_at),
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return "rt-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def record_content_fingerprint(record: dict) -> str:
    """Fingerprint provider content, ignoring system availability timestamps."""
    content = {
        key: value
        for key, value in record.items()
        if key not in _FINGERPRINT_EXCLUDED
    }
    encoded = json.dumps(
        content,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _normalize_candidate(
    candidate: object,
    *,
    provider_id: str,
    received_at: datetime,
    processed_at: datetime,
    until: datetime,
    allowed_city_ids: frozenset[str],
) -> tuple[dict | None, dict | None]:
    """Validate one provider candidate and return a canonical record or error."""
    if not isinstance(candidate, dict):
        return None, _rejected(
            "invalid_record", "candidate must be a mapping"
        )

    provider_record_id = candidate.get("provider_record_id")
    error_record_id = (
        provider_record_id if _non_empty_string(provider_record_id) else None
    )

    non_string_keys = sorted(
        {_safe_field_name(key) for key in candidate if not isinstance(key, str)}
    )
    if non_string_keys:
        return None, _rejected(
            "extra_field",
            "field names must be strings: " + ", ".join(non_string_keys),
            provider_record_id=error_record_id,
        )

    extra = sorted(set(candidate) - set(CANDIDATE_FIELDS))
    if extra:
        return None, _rejected(
            "extra_field",
            "extra fields: " + ", ".join(extra),
            provider_record_id=error_record_id,
        )

    missing = [field for field in CANDIDATE_FIELDS if field not in candidate]
    if missing:
        return None, _rejected(
            "missing_field",
            "missing fields: " + ", ".join(missing),
            provider_record_id=error_record_id,
        )

    if not _non_empty_string(provider_record_id):
        return None, _rejected(
            "invalid_record", "provider_record_id must be a non-empty string"
        )
    provider_record_version = candidate["provider_record_version"]
    if not _non_empty_string(provider_record_version):
        return None, _rejected(
            "invalid_record",
            "provider_record_version must be a non-empty string",
            provider_record_id=error_record_id,
        )
    station_id = candidate["station_id"]
    if not _non_empty_string(station_id):
        return None, _rejected(
            "invalid_record", "station_id must be a non-empty string",
            provider_record_id=error_record_id,
        )
    geometry_or_area = candidate["geometry_or_area"]
    if not _non_empty_string(geometry_or_area):
        return None, _rejected(
            "invalid_record",
            "geometry_or_area must be a non-empty string",
            provider_record_id=error_record_id,
        )
    for field in ("source_name", "source_reference", "license_id"):
        if not _non_empty_string(candidate[field]):
            return None, _rejected(
                "invalid_record",
                f"{field} must be a non-empty string",
                provider_record_id=error_record_id,
                field=field,
            )

    city_id = candidate["city_id"]
    code = validate_city(city_id, city_ids=allowed_city_ids)
    if code:
        return None, _rejected(
            code, "city_id is not in the configured city scope",
            provider_record_id=error_record_id, field="city_id",
        )
    phenomenon = candidate["phenomenon"]
    code = validate_phenomenon(phenomenon)
    if code:
        return None, _rejected(
            code, "phenomenon is not supported in this phase",
            provider_record_id=error_record_id, field="phenomenon",
        )
    unit = candidate["unit"]
    code = validate_unit(phenomenon, unit)
    if code:
        return None, _rejected(
            code, "unit is not allowed for this phenomenon",
            provider_record_id=error_record_id, field="unit",
        )
    vertical_datum = candidate["vertical_datum"]
    code = validate_vertical_datum(phenomenon, vertical_datum)
    if code:
        return None, _rejected(
            code,
            "tide_level and river_level require a non-empty vertical_datum",
            provider_record_id=error_record_id, field="vertical_datum",
        )
    value, code = validate_value(phenomenon, candidate["value"])
    if code:
        return None, _rejected(
            code,
            "value must be finite numeric data or a boolean for road_closure",
            provider_record_id=error_record_id, field="value",
        )
    longitude, code = validate_coordinate(candidate["longitude"], 180.0)
    if code:
        return None, _rejected(
            code, "longitude is not a finite value in [-180, 180]",
            provider_record_id=error_record_id, field="longitude",
        )
    latitude, code = validate_coordinate(candidate["latitude"], 90.0)
    if code:
        return None, _rejected(
            code, "latitude is not a finite value in [-90, 90]",
            provider_record_id=error_record_id, field="latitude",
        )
    horizontal_crs = candidate["horizontal_crs"]
    if not validate_crs(horizontal_crs):
        return None, _rejected(
            "invalid_crs", "horizontal_crs must match EPSG:<digits>",
            provider_record_id=error_record_id, field="horizontal_crs",
        )
    quality_flags, code = validate_quality_flags(candidate["quality_flags"])
    if code:
        return None, _rejected(
            code, "quality_flags contains an empty or unknown flag",
            provider_record_id=error_record_id, field="quality_flags",
        )
    if "rejected" in quality_flags:
        return None, _rejected(
            "rejected_quality", "quality_flags contains rejected",
            provider_record_id=error_record_id, field="quality_flags",
        )

    observed_at = parse_aware_datetime(candidate["observed_at"])
    if observed_at is None:
        return None, _rejected(
            "naive_datetime",
            "observed_at must be timezone-aware",
            provider_record_id=error_record_id, field="observed_at",
        )
    published_raw = candidate["provider_published_at"]
    if published_raw is None or published_raw == "":
        provider_published_at = None
    else:
        provider_published_at = parse_aware_datetime(published_raw)
        if provider_published_at is None:
            return None, _rejected(
                "naive_datetime",
                "provider_published_at must be timezone-aware or empty",
                provider_record_id=error_record_id,
                field="provider_published_at",
            )

    if observed_at > received_at:
        return None, _rejected(
            "future_observation",
            "observed_at is later than received_at",
            provider_record_id=error_record_id, field="observed_at",
        )
    if provider_published_at is not None and provider_published_at > received_at:
        return None, _rejected(
            "invalid_time_order",
            "provider_published_at is later than received_at",
            provider_record_id=error_record_id,
            field="provider_published_at",
        )
    if received_at > processed_at:
        return None, _rejected(
            "invalid_time_order",
            "received_at is later than processed_at",
            provider_record_id=error_record_id, field="received_at",
        )
    if processed_at > until:
        return None, _rejected(
            "invalid_time_order",
            "processed_at is later than until",
            provider_record_id=error_record_id, field="processed_at",
        )

    record = {
        "record_id": canonical_record_id(
            provider_id=provider_id,
            provider_record_id=provider_record_id,
            provider_record_version=provider_record_version,
            city_id=city_id,
            phenomenon=phenomenon,
            station_id=station_id,
            observed_at=observed_at,
        ),
        "provider_id": provider_id,
        "provider_record_id": provider_record_id,
        "provider_record_version": provider_record_version,
        "city_id": city_id,
        "phenomenon": phenomenon,
        "station_id": station_id,
        "geometry_or_area": geometry_or_area,
        "longitude": longitude,
        "latitude": latitude,
        "horizontal_crs": horizontal_crs,
        "vertical_datum": vertical_datum,
        "value": value,
        "unit": unit,
        "observed_at": iso_shanghai(observed_at),
        "provider_published_at": (
            iso_shanghai(provider_published_at)
            if provider_published_at is not None else None
        ),
        "received_at": iso_shanghai(received_at),
        "processed_at": iso_shanghai(processed_at),
        "available_at": iso_shanghai(processed_at),
        "source_name": candidate["source_name"],
        "source_reference": candidate["source_reference"],
        "license_id": candidate["license_id"],
        "quality_flags": quality_flags,
        "latency_seconds": round(
            (processed_at - observed_at).total_seconds(), 6
        ),
        "ingestion_latency_seconds": round(
            (received_at - observed_at).total_seconds(), 6
        ),
    }
    record["content_fingerprint"] = record_content_fingerprint(record)
    return record, None


def _collapse_duplicates(
    records: list[dict],
) -> tuple[list[dict], int, dict | None]:
    groups: dict[str, list[dict]] = {}
    for record in records:
        groups.setdefault(record["record_id"], []).append(record)

    unique: list[dict] = []
    duplicates = 0
    conflicts: list[str] = []
    for record_id in sorted(groups):
        group = sorted(
            groups[record_id],
            key=lambda item: (
                item["available_at"],
                item["received_at"],
                item["record_id"],
            ),
        )
        fingerprints = {item["content_fingerprint"] for item in group}
        if len(fingerprints) > 1:
            conflicts.append(record_id)
            continue
        unique.append(group[0])
        duplicates += len(group) - 1

    if conflicts:
        return [], duplicates, _rejected(
            "duplicate_conflict",
            "same record_id has different content: " + ", ".join(conflicts),
        )
    return unique, duplicates, None


def _new_poll_result(
    provider_id: str | None,
    *,
    since: object,
    until: object,
    received_at: object,
    processed_at: object,
) -> dict:
    return {
        "provider_id": provider_id,
        "query_window": {
            "since": _safe_iso(since) if since is not None else None,
            "until": _safe_iso(until),
        },
        "received_at": _safe_iso(received_at),
        "processed_at": _safe_iso(processed_at),
        "status": "unavailable",
        "provider_error": None,
        "provider_record_count": 0,
        "accepted_count": 0,
        "rejected_count": 0,
        "duplicate_count": 0,
        "superseded_count": 0,
        "accepted_records": [],
        "rejected_records": [],
        "rejected_counts": empty_rejected_counts(),
        "snapshot": None,
        "version_chains": [],
        "forecast_input_ready": False,
        "model_assimilation_ready": False,
        "public_warning_ready": False,
        "automatic_dispatch_ready": False,
    }


def _merge_counts(target: dict[str, int], extra: dict[str, int]) -> None:
    for code in ALL_ERROR_CODES:
        target[code] = target.get(code, 0) + extra.get(code, 0)


def _finish_batch_rejection(
    result: dict,
    *,
    error: dict,
    rejected: list[dict],
    snapshot: dict | None,
) -> dict:
    errors = _sorted_rejections([*rejected, error])
    counts = empty_rejected_counts()
    for item in errors:
        counts[item["code"]] += 1
    result["status"] = "rejected"
    result["rejected_records"] = errors
    result["rejected_count"] = len(errors)
    if snapshot is not None:
        _merge_counts(snapshot["rejected_counts"], counts)
        snapshot["provenance"]["excluded_counts"] = dict(
            snapshot["rejected_counts"]
        )
        result["rejected_counts"] = snapshot["rejected_counts"]
        result["snapshot"] = snapshot
        result["version_chains"] = snapshot.get("version_chains", [])
    else:
        result["rejected_counts"] = counts
    return result


def _provider_failure(
    result: dict,
    *,
    exc: BaseException,
    snapshot: dict | None,
) -> dict:
    result["status"] = "unavailable"
    result["provider_error"] = {
        "type": _safe_exception_type(exc),
        "summary": "provider fetch failed; exception details withheld",
    }
    result["rejected_records"] = [_rejected(
        "provider_failure", "provider fetch failed; details withheld"
    )]
    result["rejected_count"] = 1
    result["rejected_counts"]["provider_failure"] = 1
    if snapshot is not None:
        _merge_counts(snapshot["rejected_counts"], {"provider_failure": 1})
        snapshot["provenance"]["excluded_counts"] = dict(
            snapshot["rejected_counts"]
        )
        snapshot["provenance"]["provider_error"] = result["provider_error"]
        result["snapshot"] = snapshot
        result["version_chains"] = snapshot.get("version_chains", [])
        result["rejected_counts"] = snapshot["rejected_counts"]
    return result


def poll_provider(
    provider: RealtimeProvider,
    *,
    since: datetime | None,
    until: datetime,
    received_at: datetime,
    processed_at: datetime,
    freshness_limits_minutes: dict[str, int] | None = None,
    city_order=CITY_ORDER,
) -> dict:
    """Poll one provider exactly once and return an auditable batch result.

    Provider exceptions and malformed responses become ``unavailable`` results;
    they are never converted into an empty normal snapshot.  Invalid caller
    configuration also fails closed before the provider is called.
    """
    city_order = normalize_city_order(city_order)
    allowed_city_ids = frozenset(city_order)
    provider_id_value = getattr(provider, "provider_id", None)
    provider_id = (
        provider_id_value
        if isinstance(provider_id_value, str) and provider_id_value
        else None
    )
    result = _new_poll_result(
        provider_id,
        since=since,
        until=until,
        received_at=received_at,
        processed_at=processed_at,
    )

    config_errors: list[dict] = []
    if provider_id is None:
        config_errors.append(_rejected(
            "provider_failure", "provider_id must be a non-empty string"
        ))
    if not callable(getattr(provider, "fetch", None)):
        config_errors.append(_rejected(
            "provider_failure", "provider.fetch must be callable"
        ))

    since_dt = parse_aware_datetime(since) if since is not None else None
    until_dt = parse_aware_datetime(until)
    received_dt = parse_aware_datetime(received_at)
    processed_dt = parse_aware_datetime(processed_at)
    for field, raw, parsed in (
        ("since", since, since_dt),
        ("until", until, until_dt),
        ("received_at", received_at, received_dt),
        ("processed_at", processed_at, processed_dt),
    ):
        if raw is not None and parsed is None:
            config_errors.append(_rejected(
                "naive_datetime",
                f"{field} must be timezone-aware",
                field=field,
            ))

    limits: dict[str, int] | None
    try:
        limits = normalize_freshness_limits(freshness_limits_minutes)
    except InvalidFreshnessConfig:
        limits = normalize_freshness_limits(None)
        config_errors.append(_rejected(
            "invalid_freshness_config",
            "freshness limits must contain exactly the supported phenomena "
            "with positive integer minutes",
            field="freshness_limits_minutes",
        ))

    if since_dt is not None and until_dt is not None and since_dt > until_dt:
        config_errors.append(_rejected(
            "invalid_time_order", "since is later than until", field="since"
        ))
    if (
        received_dt is not None
        and processed_dt is not None
        and received_dt > processed_dt
    ):
        config_errors.append(_rejected(
            "invalid_time_order",
            "received_at is later than processed_at",
            field="received_at",
        ))
    if (
        processed_dt is not None
        and until_dt is not None
        and processed_dt > until_dt
    ):
        config_errors.append(_rejected(
            "invalid_time_order",
            "processed_at is later than until",
            field="processed_at",
        ))

    if config_errors:
        result["rejected_records"] = _sorted_rejections(config_errors)
        result["rejected_count"] = len(config_errors)
        for error in config_errors:
            result["rejected_counts"][error["code"]] += 1
        if processed_dt is not None and until_dt is not None:
            from .realtime_analysis import build_realtime_snapshot

            snapshot = build_realtime_snapshot(
                [],
                as_of=processed_dt,
                freshness_limits_minutes=limits,
                city_order=city_order,
            )
            _merge_counts(snapshot["rejected_counts"], result["rejected_counts"])
            snapshot["provenance"]["excluded_counts"] = dict(
                snapshot["rejected_counts"]
            )
            snapshot["provenance"]["config_errors"] = list(
                result["rejected_records"]
            )
            result["snapshot"] = snapshot
            result["rejected_counts"] = snapshot["rejected_counts"]
        return result

    assert since_dt is None or isinstance(since_dt, datetime)
    assert isinstance(until_dt, datetime)
    assert isinstance(received_dt, datetime)
    assert isinstance(processed_dt, datetime)
    assert limits is not None

    result["query_window"] = {
        "since": iso_shanghai(since_dt) if since_dt is not None else None,
        "until": iso_shanghai(until_dt),
    }
    result["received_at"] = iso_shanghai(received_dt)
    result["processed_at"] = iso_shanghai(processed_dt)

    try:
        raw = provider.fetch(since=since_dt, until=until_dt)
    except Exception as exc:  # noqa: BLE001 - intentionally fail closed
        from .realtime_analysis import build_realtime_snapshot

        snapshot = build_realtime_snapshot(
            [],
            as_of=processed_dt,
            freshness_limits_minutes=limits,
            city_order=city_order,
        )
        return _provider_failure(result, exc=exc, snapshot=snapshot)

    if not isinstance(raw, list):
        from .realtime_analysis import build_realtime_snapshot

        snapshot = build_realtime_snapshot(
            [],
            as_of=processed_dt,
            freshness_limits_minutes=limits,
            city_order=city_order,
        )
        return _provider_failure(
            result,
            exc=InvalidProviderResponse("provider.fetch must return a list"),
            snapshot=snapshot,
        )

    result["provider_record_count"] = len(raw)
    accepted: list[dict] = []
    rejected: list[dict] = []
    for candidate in raw:
        try:
            record, error = _normalize_candidate(
                candidate,
                provider_id=provider_id or "",
                received_at=received_dt,
                processed_at=processed_dt,
                until=until_dt,
                allowed_city_ids=allowed_city_ids,
            )
        except Exception:  # noqa: BLE001 - malformed candidate must not escape
            record, error = None, _rejected(
                "invalid_record", "candidate validation failed"
            )
        if error is not None:
            rejected.append(error)
        else:
            accepted.append(record)

    accepted, duplicate_count, conflict = _collapse_duplicates(accepted)

    from .realtime_analysis import build_realtime_snapshot

    snapshot = build_realtime_snapshot(
        accepted,
        as_of=processed_dt,
        freshness_limits_minutes=limits,
        city_order=city_order,
    )

    if conflict is not None:
        _finish_batch_rejection(
            result, error=conflict, rejected=rejected, snapshot=snapshot
        )
        result["provider_record_count"] = len(raw)
        return result

    _merge_counts(snapshot["rejected_counts"], result["rejected_counts"])
    for error in rejected:
        snapshot["rejected_counts"][error["code"]] += 1
    snapshot["provenance"]["excluded_counts"] = dict(
        snapshot["rejected_counts"]
    )
    snapshot["provenance"].update({
        "provider_id": provider_id,
        "query_window": dict(result["query_window"]),
        "received_at": result["received_at"],
        "processed_at": result["processed_at"],
        "provider_record_count": len(raw),
        "accepted_count": len(accepted),
        "rejected_count": len(rejected),
        "duplicate_count": duplicate_count,
    })

    superseded_count = sum(
        len(chain.get("superseded_record_ids", []))
        for chain in snapshot.get("version_chains", [])
    )
    result.update({
        "status": snapshot["status"],
        "accepted_count": len(accepted),
        "rejected_count": len(rejected),
        "duplicate_count": duplicate_count,
        "superseded_count": superseded_count,
        "accepted_records": accepted,
        "rejected_records": _sorted_rejections(rejected),
        "rejected_counts": snapshot["rejected_counts"],
        "snapshot": snapshot,
        "version_chains": snapshot.get("version_chains", []),
    })
    return result
