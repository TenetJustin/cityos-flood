"""Read-only intake for source-attributed, city-specific event evidence.

The presence of a row does not establish that its source or value is authentic.
No row is automatically used for forecasting, calibration, or public warnings.
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, model_validator

from .data_paths import MissingResearchDataError, external_file
from .realworld_response import CITY_IDS

PHENOMENA = ("rainfall", "tide_level", "river_level", "flood_depth", "road_closure")


class InvalidEventEvidenceError(ValueError):
    """The supplied research CSV does not meet the declared event contract."""


class EventEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    record_id: str = Field(min_length=1)
    city_id: str = Field(min_length=1)
    event_id: str = Field(min_length=1)
    phenomenon: Literal["rainfall", "tide_level", "river_level", "flood_depth", "road_closure"]
    site_id: str = Field(min_length=1)
    area: str = Field(min_length=1)
    observed_at: AwareDatetime
    available_at: AwareDatetime
    value: float
    unit: Literal["mm", "m", "boolean"]
    datum: str = Field(min_length=1)
    spatial_resolution: str = Field(min_length=1)
    temporal_resolution: str = Field(min_length=1)
    source_name: str = Field(min_length=1)
    source_reference: str = Field(min_length=1)
    license: str = Field(min_length=1)
    evidence_level: Literal["observed", "official_record", "derived"]
    quality_flags: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_measurement(self) -> "EventEvidence":
        expected_unit = {
            "rainfall": "mm", "tide_level": "m", "river_level": "m",
            "flood_depth": "m", "road_closure": "boolean",
        }[self.phenomenon]
        if self.unit != expected_unit:
            raise ValueError(f"{self.phenomenon} 的单位必须是 {expected_unit}")
        if self.phenomenon in {"rainfall", "flood_depth"} and self.value < 0:
            raise ValueError("雨量和积水深度不得为负")
        if self.phenomenon == "road_closure" and self.value not in (0, 1):
            raise ValueError("道路中断值只能为 0 或 1")
        if self.phenomenon in {"tide_level", "river_level"} and self.datum == "not_applicable":
            raise ValueError("潮位和河水位必须说明高程基准")
        if self.available_at < self.observed_at:
            raise ValueError("资料可获得时间不得早于观测时间")
        return self


CSV_FIELDS = tuple(EventEvidence.model_fields)


def observations(city_id: str, event_id: str | None = None,
                 phenomenon: str | None = None) -> dict:
    if city_id not in CITY_IDS:
        raise ValueError(f"未知城市: {city_id}")
    if phenomenon is not None and phenomenon not in PHENOMENA:
        raise ValueError(f"未知现象: {phenomenon}")
    path = external_file("cities", city_id, "event_evidence.csv")
    if not path.is_file():
        raise MissingResearchDataError(f"cities/{city_id}/event_evidence.csv")
    records = []
    seen_ids: set[str] = set()
    seen_grain: set[tuple[str, str, str, str]] = set()
    try:
        with Path(path).open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if set(reader.fieldnames or ()) != set(CSV_FIELDS):
                raise InvalidEventEvidenceError("event_evidence.csv 列名与数据契约不一致")
            for line_no, raw in enumerate(reader, 2):
                try:
                    record = EventEvidence.model_validate(raw)
                except ValidationError as exc:
                    raise InvalidEventEvidenceError(
                        f"event_evidence.csv 第 {line_no} 行不符合数据契约: {exc.errors()[0]['msg']}") from exc
                if record.city_id != city_id:
                    raise InvalidEventEvidenceError(f"event_evidence.csv 第 {line_no} 行城市不匹配")
                grain = (record.event_id, record.phenomenon, record.site_id,
                         record.observed_at.isoformat())
                if record.record_id in seen_ids or grain in seen_grain:
                    raise InvalidEventEvidenceError(f"event_evidence.csv 第 {line_no} 行记录编号或事件粒度重复")
                seen_ids.add(record.record_id)
                seen_grain.add(grain)
                if (event_id is None or record.event_id == event_id) and (
                    phenomenon is None or record.phenomenon == phenomenon
                ):
                    records.append(record.model_dump(mode="json"))
    except (UnicodeError, csv.Error) as exc:
        raise InvalidEventEvidenceError("event_evidence.csv 编码或 CSV 格式错误") from exc
    return {
        "city_id": city_id, "event_id": event_id, "phenomenon": phenomenon,
        "count": len(records), "records": records,
        "verification_status": "source_recorded_not_independently_verified",
        "forecast_input_ready": False, "ground_truth_ready": False,
        "note": "结构与基本领域规则已检查；来源真实性、许可、仪器标定、空间代表性和独立事件核验仍需人工确认。",
    }
