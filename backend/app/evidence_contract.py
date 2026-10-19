"""Strict, fail-closed contract for five-city event evidence.

The contract separates physical observation time from system availability time
and makes non-observational evidence impossible to mistake for an observation.
It validates metadata and structure only; it never authenticates a source or
promotes a record into forecast input, calibration data, or public warnings.
"""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, model_validator

from .data_paths import MissingResearchDataError, external_file


CITY_IDS = frozenset({"shanghai", "ningbo", "fuzhou", "shenzhen", "haikou"})
EVIDENCE_CLASSES = (
    "observation",
    "historical_record",
    "model_inference",
    "simulation_scenario",
    "missing",
)
PRESENT_STATUS = "present"


class InvalidEventManifestError(ValueError):
    """An event manifest failed the shared five-city contract."""


class SourceAttribution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publisher: str = Field(min_length=1)
    source_name: str = Field(min_length=1)
    source_reference: str = Field(min_length=1)
    retrieved_at: AwareDatetime
    license_id: str = Field(min_length=1)
    license_uri: str | None = None
    redistribution_allowed: bool | None = None
    access_notes: str | None = None


class SpatialReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    geometry_or_area: str = Field(min_length=1)
    horizontal_crs: str = Field(pattern=r"^EPSG:\d+$")
    vertical_datum: str | None = None
    spatial_resolution: str = Field(min_length=1)


class EvidenceRecord(BaseModel):
    """One value, historical statement, model result, scenario, or explicit gap."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    record_id: str = Field(min_length=1)
    phenomenon: Literal[
        "typhoon_track", "rainfall", "tide_level", "river_level",
        "flood_depth", "road_closure", "transport_impact",
        "resident_response", "emergency_response",
    ]
    evidence_class: Literal[
        "observation", "historical_record", "model_inference",
        "simulation_scenario", "missing",
    ]
    observed_at: AwareDatetime | None = None
    available_at: AwareDatetime | None = None
    timezone: Literal["Asia/Shanghai"] = "Asia/Shanghai"
    spatial: SpatialReference
    value: float | int | str | bool | None = None
    unit: str = Field(min_length=1)
    source: SourceAttribution
    quality_flags: list[Literal[
        "raw", "provisional", "quality_controlled", "suspect", "rejected",
        "spatially_aggregated", "temporally_aggregated", "hindsight_only",
        "source_not_independently_verified", "unknown",
    ]] = Field(min_length=1)
    missing_status: Literal[
        "present", "not_collected", "not_published", "access_restricted",
        "not_acquired", "not_applicable", "unknown",
    ] = PRESENT_STATUS
    missing_reason: str | None = None

    @model_validator(mode="after")
    def validate_semantics(self) -> "EvidenceRecord":
        eight_hours = timedelta(hours=8)
        for name, stamp in (("observed_at", self.observed_at),
                            ("available_at", self.available_at),
                            ("source.retrieved_at", self.source.retrieved_at)):
            if stamp is not None and stamp.utcoffset() != eight_hours:
                raise ValueError(f"{name} 必须使用 Asia/Shanghai 的 UTC+08:00 偏移")
        if self.observed_at and self.available_at and self.available_at < self.observed_at:
            raise ValueError("available_at 不得早于 observed_at")
        if self.evidence_class == "missing":
            if self.value is not None or self.missing_status == PRESENT_STATUS:
                raise ValueError("缺失记录必须 value=null 且 missing_status 不是 present")
            if not self.missing_reason:
                raise ValueError("缺失记录必须说明 missing_reason")
        elif self.value is None or self.missing_status != PRESENT_STATUS:
            raise ValueError("非缺失记录必须提供 value 且 missing_status=present")
        elif self.observed_at is None or self.available_at is None:
            raise ValueError("非缺失记录必须提供 observed_at 和实际 available_at")
        allowed_units = {
            "typhoon_track": {"degree", "km"},
            "rainfall": {"mm", "mm/h"},
            "tide_level": {"m"},
            "river_level": {"m"},
            "flood_depth": {"m"},
            "road_closure": {"boolean"},
            "transport_impact": {"count", "minute", "categorical"},
            "resident_response": {"person", "count", "categorical"},
            "emergency_response": {"person", "count", "categorical"},
        }[self.phenomenon]
        if self.unit != "unknown" and self.unit not in allowed_units:
            raise ValueError(f"{self.phenomenon} 的单位不在允许集合中")
        if self.evidence_class != "missing" and self.unit == "unknown":
            raise ValueError("非缺失记录不得使用 unknown 单位")
        if self.phenomenon in {"tide_level", "river_level"}:
            datum = self.spatial.vertical_datum
            if self.evidence_class != "missing" and not datum:
                raise ValueError("潮位或河水位记录必须提供 vertical_datum")
        return self


class EventManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"]
    event_id: str = Field(min_length=1)
    city_id: Literal["shanghai", "ningbo", "fuzhou", "shenzhen", "haikou"]
    event_name: str = Field(min_length=1)
    event_start: AwareDatetime
    event_end: AwareDatetime
    timezone: Literal["Asia/Shanghai"] = "Asia/Shanghai"
    trigger_summary: str = Field(min_length=1)
    status: Literal["candidate", "development", "locked_backtest"] = "candidate"
    records: list[EvidenceRecord]
    public_warning_ready: Literal[False] = False
    automatic_dispatch_ready: Literal[False] = False

    @model_validator(mode="after")
    def validate_event(self) -> "EventManifest":
        if self.event_start.utcoffset() != timedelta(hours=8) or self.event_end.utcoffset() != timedelta(hours=8):
            raise ValueError("事件窗口必须使用 Asia/Shanghai 的 UTC+08:00 偏移")
        if self.event_end < self.event_start:
            raise ValueError("event_end 不得早于 event_start")
        ids = [record.record_id for record in self.records]
        if len(ids) != len(set(ids)):
            raise ValueError("record_id 不得重复")
        return self


def manifest_path(city_id: str, event_id: str) -> Path:
    if city_id not in CITY_IDS:
        raise ValueError(f"未知城市: {city_id}")
    if not event_id or "/" in event_id or "\\" in event_id or event_id in {".", ".."}:
        raise ValueError("event_id 不合法")
    return external_file("cities", city_id, "events", event_id, "manifest.json")


def load_manifest(city_id: str, event_id: str) -> dict:
    path = manifest_path(city_id, event_id)
    if not path.is_file():
        raise MissingResearchDataError(f"cities/{city_id}/events/{event_id}/manifest.json")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        manifest = EventManifest.model_validate(raw)
    except (OSError, UnicodeError, json.JSONDecodeError, ValidationError) as exc:
        detail = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else type(exc).__name__
        raise InvalidEventManifestError(f"事件 manifest 不符合契约: {detail}") from exc
    if manifest.city_id != city_id or manifest.event_id != event_id:
        raise InvalidEventManifestError("路径中的城市/事件与 manifest 不一致")
    counts = {kind: 0 for kind in EVIDENCE_CLASSES}
    for record in manifest.records:
        counts[record.evidence_class] += 1
    return {
        "manifest": manifest.model_dump(mode="json"),
        "evidence_class_counts": counts,
        "verification_status": "metadata_validated_sources_not_independently_verified",
        "forecast_input_ready": False,
        "ground_truth_ready": False,
        "public_warning_ready": False,
        "automatic_dispatch_ready": False,
    }
