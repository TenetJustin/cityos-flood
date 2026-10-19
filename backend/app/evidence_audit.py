"""Reproducible, deliberately limited checks on the five-city evidence inventory.

Passing these structural checks is never a claim of independent validation or
operational suitability. The audit does not download data or infer missing facts.
"""
from __future__ import annotations

import csv
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Callable

from pydantic import ValidationError

from .data_paths import BACKEND_DATA, EXTERNAL_DATA
from .evidence_contract import EVIDENCE_CLASSES, EventManifest
from .event_evidence import CSV_FIELDS as EVENT_FIELDS, EventEvidence
from .region import CITIES


ASSETS = (
    {"id": "shenzhen_chirps_daily", "city_id": "shenzhen", "kind": "rainfall",
     "path": "real_gis/shenzhen_chirps_rainfall.csv", "root": "bundled",
     "required": ["date", "mean_mm", "n_pixels"], "key": ["date"],
     "time_field": "date", "time_format": "%Y.%m.%d", "expected_time_grain": "daily",
     "limitations": ["selected_event_days_only", "not_subhourly_rainfall"]},
    {"id": "shenzhen_floodpoint_inventory", "city_id": "shenzhen", "kind": "flood_inventory",
     "path": "real_gis/shenzhen_floodpoints_geo_v2.csv", "root": "bundled",
     "required": ["district", "location", "lat", "lon"], "key": [],
     "limitations": ["susceptibility_inventory_not_event_observations"]},
    {"id": "shenzhen_waterlevel_slice", "city_id": "shenzhen", "kind": "waterlevel",
     "path": "real_gis/shenzhen_waterlevel_hourly.csv", "root": "bundled",
     "required": ["timestamp_bjt", "station_code", "level_m_mean", "quality_flag"],
     "key": ["timestamp_bjt", "station_code"], "time_field": "timestamp_bjt",
     "expected_time_grain": "hourly", "limitations": ["short_slice_not_wet_event_validation",
     "available_at_not_recorded"]},
)

RESPONSE_REQUIRED = ("city_id", "event_id", "actor_type", "action_type",
                     "action_status", "observed_at", "available_at", "area",
                     "source_name", "source_reference", "evidence_level")

# Explicit candidates are reported even before their first manifest is acquired.
CANDIDATE_EVENTS = (("shenzhen", "2023-09-07-shenzhen-extreme-rain"),)


def _parse_time(value: str, fmt: str | None = None) -> datetime:
    return datetime.strptime(value, fmt) if fmt else datetime.fromisoformat(value)


def audit_csv(path: Path, *, required: list[str] | tuple[str, ...],
              key: list[str] | tuple[str, ...] = (), time_field: str | None = None,
              time_format: str | None = None, response_city: str | None = None,
              row_validator: Callable[[dict], object] | None = None) -> dict:
    """Check schema, completeness, duplicates, time and provenance of one CSV."""
    if not path.is_file():
        return {"status": "missing", "path": str(path), "rows": 0,
                "issues": ["file_missing"]}
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = reader.fieldnames or []
            missing_columns = sorted(set(required) - set(columns))
            counts = Counter()
            keys = set()
            duplicate_keys = 0
            invalid_times = 0
            naive_times = 0
            invalid_order = 0
            wrong_city = 0
            invalid_domain_rows = 0
            first = last = None
            rows = 0
            for row in reader:
                rows += 1
                for field in required:
                    if not (row.get(field) or "").strip():
                        counts[field] += 1
                if key and all(row.get(k) for k in key):
                    identity = tuple(row[k] for k in key)
                    if identity in keys:
                        duplicate_keys += 1
                    keys.add(identity)
                if time_field and row.get(time_field):
                    try:
                        value = _parse_time(row[time_field], time_format)
                        if time_format is None and value.tzinfo is None:
                            naive_times += 1
                        stamp = value.isoformat()
                        first = min(first, stamp) if first else stamp
                        last = max(last, stamp) if last else stamp
                    except ValueError:
                        invalid_times += 1
                if response_city:
                    if row.get("city_id") != response_city:
                        wrong_city += 1
                    try:
                        observed = _parse_time(row["observed_at"])
                        available = _parse_time(row["available_at"])
                        if observed.tzinfo is None or available.tzinfo is None:
                            naive_times += 1
                        elif available < observed:
                            invalid_order += 1
                    except (KeyError, ValueError):
                        invalid_times += 1
                if row_validator:
                    try:
                        row_validator(row)
                    except (ValidationError, ValueError, TypeError):
                        invalid_domain_rows += 1
    except (UnicodeError, csv.Error, OSError) as exc:
        return {"status": "unreadable", "path": str(path), "rows": 0,
                "issues": [type(exc).__name__]}
    issues = []
    if missing_columns:
        issues.append("missing_columns")
    if rows == 0:
        issues.append("empty_file")
    if duplicate_keys:
        issues.append("duplicate_keys")
    if invalid_times:
        issues.append("invalid_timestamps")
    if naive_times:
        issues.append("timezone_missing")
    if invalid_order:
        issues.append("available_before_observed")
    if wrong_city:
        issues.append("wrong_city_id")
    if invalid_domain_rows:
        issues.append("invalid_domain_rows")
    if any(counts.values()):
        issues.append("required_values_missing")
    return {
        "status": "structural_checks_passed" if not issues else "structural_issues",
        "path": str(path), "rows": rows, "columns": columns,
        "missing_columns": missing_columns, "missing_required_values": dict(counts),
        "duplicate_keys": duplicate_keys, "invalid_timestamps": invalid_times,
        "timezone_missing": naive_times, "available_before_observed": invalid_order,
        "wrong_city_id": wrong_city, "first_timestamp": first, "last_timestamp": last,
        "invalid_domain_rows": invalid_domain_rows,
        "issues": issues,
    }


def audit_event_manifest(path: Path, *, city_id: str, event_id: str) -> dict:
    """Inspect a v1 event package without certifying its sources or measurements."""
    result = {
        "path": str(path),
        "status": "missing",
        "issues": ["file_missing"],
        "ground_truth_ready": False,
        "forecast_input_ready": False,
        "operational_warning_ready": False,
    }
    if not path.is_file():
        return result
    if path.is_symlink() or path.parent.is_symlink():
        return {**result, "status": "structural_issues", "issues": ["symlink_not_audited"]}
    try:
        manifest = EventManifest.model_validate_json(path.read_text(encoding="utf-8"))
    except (ValidationError, OSError, UnicodeError) as exc:
        issue = "invalid_manifest" if isinstance(exc, ValidationError) else "unreadable_manifest"
        return {**result, "status": "structural_issues", "issues": [issue]}
    if manifest.city_id != city_id or manifest.event_id != event_id:
        return {**result, "status": "structural_issues", "issues": ["path_identity_mismatch"]}

    classes = Counter(record.evidence_class for record in manifest.records)
    phenomena = Counter(record.phenomenon for record in manifest.records)
    missing = Counter(record.phenomenon for record in manifest.records
                      if record.evidence_class == "missing")
    pending_license = sum(record.source.license_id == "terms-review-required"
                          or record.source.redistribution_allowed is None
                          for record in manifest.records)
    qc_observations = sum(record.evidence_class == "observation"
                          and "quality_controlled" in record.quality_flags
                          and "suspect" not in record.quality_flags
                          and "rejected" not in record.quality_flags
                          for record in manifest.records)
    return {
        **result,
        "status": "structural_checks_passed",
        "issues": [],
        "event_status": manifest.status,
        "record_count": len(manifest.records),
        "evidence_class_counts": {kind: classes[kind] for kind in EVIDENCE_CLASSES},
        "phenomenon_counts": dict(sorted(phenomena.items())),
        "missing_by_phenomenon": dict(sorted(missing.items())),
        "quality_controlled_observation_count": qc_observations,
        "license_review_record_count": pending_license,
        "verification_status": "metadata_validated_sources_not_independently_verified",
    }


def _event_manifest_inventory(external_root: Path) -> tuple[list[dict], dict]:
    """List direct city event packages plus named candidates that are still absent."""
    discovered = set(CANDIDATE_EVENTS)
    for city in CITIES:
        city_id = city["id"]
        events_dir = external_root / "cities" / city_id / "events"
        if not events_dir.is_dir() or events_dir.is_symlink():
            continue
        for event_dir in events_dir.iterdir():
            if event_dir.is_dir() and not event_dir.is_symlink():
                discovered.add((city_id, event_dir.name))

    items = []
    for city_id, event_id in sorted(discovered):
        relative_path = f"cities/{city_id}/events/{event_id}/manifest.json"
        items.append({
            "id": f"{city_id}_{event_id}",
            "city_id": city_id,
            "event_id": event_id,
            "kind": "event_manifest",
            "root": "external",
            "path": relative_path,
            "audit": audit_event_manifest(external_root / relative_path,
                                          city_id=city_id, event_id=event_id),
        })
    coverage = {
        city["id"]: {
            "listed": sum(item["city_id"] == city["id"] for item in items),
            "structural_checks_passed": sum(
                item["city_id"] == city["id"]
                and item["audit"]["status"] == "structural_checks_passed"
                for item in items
            ),
        }
        for city in CITIES
    }
    return items, coverage


def audit_inventory(*, bundled_root: Path = BACKEND_DATA,
                    external_root: Path = EXTERNAL_DATA) -> dict:
    assets = []
    for spec in ASSETS:
        item = dict(spec)
        root = bundled_root if spec["root"] == "bundled" else external_root
        item["audit"] = audit_csv(root / spec["path"], required=spec["required"],
                                  key=spec["key"], time_field=spec.get("time_field"),
                                  time_format=spec.get("time_format"))
        assets.append(item)
    for city in CITIES:
        city_id = city["id"]
        path = external_root / "cities" / city_id / "responses.csv"
        assets.append({"id": f"{city_id}_responses", "city_id": city_id,
                       "kind": "real_world_response", "root": "external",
                       "path": f"cities/{city_id}/responses.csv",
                       "limitations": ["source_recorded_not_independently_verified",
                                       "not_yet_linked_to_impact_model"],
                       "audit": audit_csv(path, required=RESPONSE_REQUIRED,
                                          key=("city_id", "event_id", "actor_type",
                                               "action_type", "observed_at", "area"),
                                          response_city=city_id)})
        evidence_path = external_root / "cities" / city_id / "event_evidence.csv"
        assets.append({"id": f"{city_id}_event_evidence", "city_id": city_id,
                       "kind": "event_evidence", "root": "external",
                       "path": f"cities/{city_id}/event_evidence.csv",
                       "limitations": ["source_recorded_not_independently_verified",
                                       "not_forecast_input_or_ground_truth"],
                       "audit": audit_csv(evidence_path, required=EVENT_FIELDS,
                                          key=("event_id", "phenomenon", "site_id", "observed_at"),
                                          time_field="observed_at", response_city=city_id,
                                          row_validator=EventEvidence.model_validate)})
    event_manifests, manifest_coverage_by_city = _event_manifest_inventory(external_root)
    return {"assessment": "structural_only_not_independent_validation",
            "operational_warning_ready": False,
            "cities": [city["id"] for city in CITIES], "assets": assets,
            "event_manifests": event_manifests,
            "manifest_coverage_by_city": manifest_coverage_by_city,
            "not_checked": ["source_authenticity", "physical_plausibility",
                            "event_coverage", "sensor_calibration", "vertical_datum",
                            "license_terms", "forecast_skill", "response_ground_truth"]}


def main() -> None:
    print(json.dumps(audit_inventory(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
