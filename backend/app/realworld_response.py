"""Source-backed resident and emergency-action observations.

These records are an evidence intake layer, not inferred behaviour or a
command channel.  A recorded source is not independently verified.
"""
from __future__ import annotations

import csv
from pathlib import Path

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from .data_paths import external_file, MissingResearchDataError
from .region import CITIES

CITY_IDS = frozenset(city["id"] for city in CITIES)


class InvalidResponseDataError(ValueError):
    pass


class ResponseObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    city_id: str
    event_id: str = Field(min_length=1)
    actor_type: str = Field(pattern="^(resident|emergency_department)$")
    action_type: str = Field(min_length=1)
    action_status: str = Field(pattern="^(reported|executed|verified)$")
    observed_at: AwareDatetime
    available_at: AwareDatetime
    area: str = Field(min_length=1)
    source_name: str = Field(min_length=1)
    source_reference: str = Field(min_length=1)
    evidence_level: str = Field(pattern="^(observed|official_record)$")
    affected_count: int | None = Field(default=None, ge=0)


CSV_FIELDS = tuple(ResponseObservation.model_fields)


def observations(city_id: str, event_id: str | None = None) -> dict:
    if city_id not in CITY_IDS:
        raise ValueError(f"未知城市: {city_id}")
    path = external_file("cities", city_id, "responses.csv")
    if not path.is_file():
        raise MissingResearchDataError(f"cities/{city_id}/responses.csv")
    rows = []
    try:
        with Path(path).open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if set(reader.fieldnames or ()) != set(CSV_FIELDS):
                raise InvalidResponseDataError("responses.csv 列名与数据契约不一致")
            for line_no, raw in enumerate(reader, 2):
                values = {key: value for key, value in raw.items()
                          if key != "affected_count" or value not in ("", None)}
                try:
                    record = ResponseObservation.model_validate(values)
                except ValidationError as exc:
                    raise InvalidResponseDataError(
                        f"responses.csv 第 {line_no} 行不符合数据契约: {exc.errors()[0]['loc']}") from exc
                if record.city_id != city_id:
                    raise InvalidResponseDataError(f"responses.csv 第 {line_no} 行城市不匹配")
                if record.available_at < record.observed_at:
                    raise InvalidResponseDataError(f"responses.csv 第 {line_no} 行发布时间早于发生时间")
                if event_id is None or record.event_id == event_id:
                    rows.append(record.model_dump(mode="json"))
    except UnicodeError as exc:
        raise InvalidResponseDataError("responses.csv 编码错误，应为 UTF-8") from exc
    return {
        "city_id": city_id,
        "event_id": event_id,
        "count": len(rows),
        "actor_counts": {
            "resident": sum(r["actor_type"] == "resident" for r in rows),
            "emergency_department": sum(r["actor_type"] == "emergency_department"
                                        for r in rows),
        },
        "records": rows,
        "verification_status": "source_recorded_not_independently_verified",
        "model_feedback_ready": False,
        "note": "已记录来源与时间；仍需原件核查、事件对齐和偏差评估后才能用于模型反馈。",
    }
