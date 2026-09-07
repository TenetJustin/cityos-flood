# -*- coding: utf-8 -*-
"""Observed drainage / recession diagnostics from Shenzhen waterlogging stations.

This module is an *observation* layer, not a pipe-network model.  It separates two
questions that a single "drainage design capacity" scalar cannot answer:

1. How severe was the ponding at each station/district?  (peak depth)
2. How quickly did it recede afterwards?  (recession hours, recovery score)

Futian is the motivating case: ponding can be severe while recovery is fast --
but the naive peak-to-threshold reading is biased by *censoring*.  A station
whose water level is still rising at the end of the observation window has an
unknown recession time; counting it as "slow" (or as a completed event) is wrong
in both directions.  This module therefore splits every station's record into
episodes with explicit censoring semantics.

Episode semantics (per station, hourly grid, missing hours stay absent --
never imputed as zero):

- ``completed``        -- wet episode followed by an *observed* below-threshold
                          hour; recession_time_h = first_below - peak index.
- ``gap_unresolved``   -- wet episode followed by an observation gap; recession
                          cannot be defined (do not impute).
- ``right_censored``   -- wet episode that continues to the station's last
                          observed hour (water may still be rising); recession
                          unknown, bounded only by external snapshots.

District aggregation uses only ``completed`` episodes for the median recession;
censored and gap episodes are counted separately and listed per district.  A
district whose episodes are all censored reports ``undefined_right_censored``;
a district with no wet stations reports ``no_events`` and yields no recession
median (never a zero-valued median).

Data sources (project-local, no network):
- ``backend/data/real_gis/shenzhen_waterlevel_hourly.csv``  -- hourly QC water
  levels, 148 waterlogging stations, 2026-08-19/20 operational slice.
- ``backend/data/station_district_map.csv``                 -- station -> district.

Provenance is ``observed-derived``.  This is a short operational slice with 1cm
sensor quantization; it is NOT a verified flood-event archive and must not be
used for replay/assimilation (the hourly cache has no ``available_at`` column
and would fail the fail-closed audit in ``observations.py``).
"""
from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LEVEL_FILE = DATA_DIR / "real_gis" / "shenzhen_waterlevel_hourly.csv"
MAP_FILE = DATA_DIR / "station_district_map.csv"

# Depth at or below which a station is considered "receded" (metres).
# Legacy threshold from docs/data_dictionary.md §12.
THRESHOLD_M = 0.02
# Severity label threshold (metres) aligned with risk.level mid band.
SEVERE_DEPTH_M = 0.15
# Recovery score half-life (hours): score = 1 / (1 + median_recession / H).
RECOVERY_HALF_LIFE_H = 6.0
# Fast-recovery score threshold used for the "severe_fast_recovery" profile.
FAST_RECOVERY_SCORE = 0.5
# Two wet readings further apart than this (hours) split into separate episodes;
# the first becomes gap_unresolved because recession cannot be observed.
MAX_GAP_H = 2.0

_EMPTY_DISTRICT: Dict[str, Any] = {
    "district_id": "",
    "station_count": 0,
    "active_station_count": 0,
    "peak_depth_m": 0.0,
    "median_peak_depth_m": 0.0,
    "median_recession_hours": None,
    "recession_observed_station_count": 0,
    "recovery_score": None,
    "severity_recovery_profile": "unavailable",
    "episodes": {"total": 0, "completed": 0, "gap_unresolved": 0, "right_censored": 0},
    "censored_details": [],
    "provenance": "unavailable",
}


def _read_rows() -> List[Dict[str, str]]:
    if not LEVEL_FILE.exists():
        return []
    with LEVEL_FILE.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _station_district_map() -> Dict[str, str]:
    if not MAP_FILE.exists():
        return {}
    with MAP_FILE.open(encoding="utf-8-sig", newline="") as fh:
        return {
            str(row.get("czbm", "")).strip(): str(row.get("district_id", "")).strip()
            for row in csv.DictReader(fh)
            if row.get("czbm")
        }


def _parse_time(raw: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _split_episodes(
    times: List[datetime], levels: List[float]
) -> List[Dict[str, Any]]:
    """Split one station's hourly series into wet episodes with censoring tags.

    Missing hours remain absent (they are simply absent from the series).  A wet
    run that resumes after a > MAX_GAP_H interruption starts a new episode and
    marks the previous one gap_unresolved.
    """
    episodes: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    def close(kind: str, end_index: int) -> None:
        nonlocal current
        if current is None:
            return
        current["end_index"] = end_index
        current["status"] = kind
        episodes.append(current)
        current = None

    for index, level in enumerate(levels):
        wet = level > THRESHOLD_M
        if wet:
            if current is None:
                current = {
                    "start_index": index,
                    "peak_index": index,
                    "peak_depth_m": level,
                }
            else:
                gap_h = (times[index] - times[current["end_index_placeholder"]]).total_seconds() / 3600.0
                if gap_h > MAX_GAP_H:
                    close("gap_unresolved", current["end_index_placeholder"])
                    current = {
                        "start_index": index,
                        "peak_index": index,
                        "peak_depth_m": level,
                    }
                elif level > current["peak_depth_m"]:
                    current["peak_index"] = index
                    current["peak_depth_m"] = level
            if current is not None:
                current["end_index_placeholder"] = index
        else:
            if current is not None:
                close("completed", index)

    if current is not None:
        close("right_censored", current["end_index_placeholder"])

    for episode in episodes:
        # ``end_index`` is the episode's *closure* index: for completed episodes
        # it is the first observed below-threshold hour; for gap/censored ones
        # it equals the last wet hour (end_index_placeholder).
        if episode["status"] == "completed":
            recession_h = (
                times[episode["end_index"]] - times[episode["peak_index"]]
            ).total_seconds() / 3600.0
            episode["recession_hours"] = round(max(0.0, recession_h), 2)
        else:
            episode["recession_hours"] = None
        episode["peak_time"] = times[episode["peak_index"]].isoformat()
        episode["last_time"] = times[episode["end_index"]].isoformat()
        episode["last_depth_m"] = round(levels[episode["end_index"]], 4)
        episode.pop("end_index_placeholder", None)
    return episodes


def _station_records() -> Dict[str, Dict[str, Any]]:
    grouped: Dict[str, List[tuple]] = defaultdict(list)
    for row in _read_rows():
        code = str(row.get("station_code", "")).strip()
        if not code:
            continue
        stamp = _parse_time(row.get("timestamp_bjt", ""))
        if stamp is None:
            continue
        try:
            level = float(row.get("level_m_max") or row.get("level_m_mean") or 0.0)
        except (TypeError, ValueError):
            continue
        if level < 0:
            continue
        grouped[code].append((stamp, level, row))

    records: Dict[str, Dict[str, Any]] = {}
    for code, values in grouped.items():
        values.sort(key=lambda item: item[0])
        times = [item[0] for item in values]
        levels = [item[1] for item in values]
        episodes = _split_episodes(times, levels)
        wet_episodes = [e for e in episodes if e["peak_depth_m"] > THRESHOLD_M]
        peak_episode = max(
            episodes, key=lambda e: e["peak_depth_m"], default=None
        )
        sample_row = values[-1][2]
        records[code] = {
            "station_code": code,
            "station_name": sample_row.get("station_name") or code,
            "sample_count": len(values),
            "peak_depth_m": round(peak_episode["peak_depth_m"], 4) if peak_episode else 0.0,
            "peak_time": peak_episode["peak_time"] if peak_episode else None,
            "episodes": wet_episodes,
            "episode_counts": {
                "total": len(wet_episodes),
                "completed": sum(1 for e in wet_episodes if e["status"] == "completed"),
                "gap_unresolved": sum(1 for e in wet_episodes if e["status"] == "gap_unresolved"),
                "right_censored": sum(1 for e in wet_episodes if e["status"] == "right_censored"),
            },
            "quality_flag": sample_row.get("quality_flag") or "unknown",
            "lat": float(sample_row["lat"]) if sample_row.get("lat") else None,
            "lon": float(sample_row["lon"]) if sample_row.get("lon") else None,
        }
    return records


def _recovery_score(median_recession_h: Optional[float]) -> Optional[float]:
    if median_recession_h is None:
        return None
    return round(1.0 / (1.0 + median_recession_h / RECOVERY_HALF_LIFE_H), 3)


_CACHE: Optional[Dict[str, Any]] = None


def _district_summary() -> Dict[str, Dict[str, Any]]:
    mapping = _station_district_map()
    stations = _station_records()

    by_district: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for code, record in stations.items():
        district = mapping.get(code)
        if district:
            by_district[district].append(record)

    districts: Dict[str, Dict[str, Any]] = {}
    for did, items in sorted(by_district.items()):
        peaks = [item["peak_depth_m"] for item in items]
        completed_recessions = [
            episode["recession_hours"]
            for item in items
            for episode in item["episodes"]
            if episode["status"] == "completed" and episode["recession_hours"] is not None
        ]
        episode_counts = {"total": 0, "completed": 0, "gap_unresolved": 0, "right_censored": 0}
        for item in items:
            for key in episode_counts:
                episode_counts[key] += item["episode_counts"][key]

        median_recession = (
            sorted(completed_recessions)[len(completed_recessions) // 2]
            if completed_recessions
            else None
        )
        score = _recovery_score(median_recession)
        censored_details = [
            {
                "station_code": item["station_code"],
                "station_name": item["station_name"],
                "peak_depth_m": episode["peak_depth_m"],
                "last_depth_m": episode["last_depth_m"],
                "last_time": episode["last_time"],
                "status": episode["status"],
            }
            for item in items
            for episode in item["episodes"]
            if episode["status"] in ("right_censored", "gap_unresolved")
        ]

        wet_station_count = sum(1 for p in peaks if p > THRESHOLD_M)
        severe = max(peaks) >= SEVERE_DEPTH_M if peaks else False
        if episode_counts["total"] == 0:
            profile = "no_events"
        elif episode_counts["completed"] == 0 and episode_counts["right_censored"] > 0:
            profile = "undefined_right_censored"
        elif severe and score is not None and score >= FAST_RECOVERY_SCORE:
            profile = "severe_fast_recovery"
        elif severe:
            profile = "severe_slow_recovery"
        else:
            profile = "observed"

        districts[did] = {
            "district_id": did,
            "station_count": len(items),
            "active_station_count": wet_station_count,
            "peak_depth_m": round(max(peaks), 4) if peaks else 0.0,
            "median_peak_depth_m": (
                round(sorted(peaks)[len(peaks) // 2], 4) if peaks else 0.0
            ),
            "median_recession_hours": median_recession,
            "completed_episode_count": episode_counts["completed"],
            "episode_counts": episode_counts,
            "censored_details": censored_details,
            "recession_observed_station_count": len(completed_recessions),
            "recovery_score": score,
            "severity_recovery_profile": profile,
            "provenance": (
                "observed-derived(深圳市水务局积涝点水位 hourly QC slice; "
                "episode-level recession with explicit right-censoring)"
            ),
        }
    return districts


def get_drainage_summary() -> Dict[str, Any]:
    """District/station level observed ponding severity and recession speed."""
    global _CACHE
    if _CACHE is None:
        districts = _district_summary()
        stations = sorted(
            _station_records().values(),
            key=lambda item: (-item["peak_depth_m"], item["station_code"]),
        )
        station_view = [
            {
                "station_code": s["station_code"],
                "station_name": s["station_name"],
                "peak_depth_m": s["peak_depth_m"],
                "peak_time": s["peak_time"],
                "episode_counts": s["episode_counts"],
                "recession_hours": next(
                    (e["recession_hours"] for e in s["episodes"] if e["status"] == "completed"),
                    None,
                ),
                "sample_count": s["sample_count"],
                "lat": s["lat"],
                "lon": s["lon"],
            }
            for s in stations
        ]
        _CACHE = {
            "threshold_m": THRESHOLD_M,
            "severe_depth_m": SEVERE_DEPTH_M,
            "recovery_half_life_h": RECOVERY_HALF_LIFE_H,
            "max_gap_h": MAX_GAP_H,
            "episode_semantics": {
                "completed": "wet episode followed by an observed below-threshold hour; recession measurable",
                "gap_unresolved": "wet episode followed by an observation gap; recession undefined",
                "right_censored": "wet episode continuing to the station's last observed hour; recession unknown",
            },
            "districts": districts,
            "stations": station_view,
            "data_source": str(LEVEL_FILE),
            "provenance": (
                "observed-derived(深圳市水务局积涝点水位 · hourly QC slice 2026-08-19/20); "
                "recession bounded by observation window with explicit censoring"
            ),
            "limitations": [
                "观测层不是排水管网容量；无管径/坡度/泵曲线时不替代 SWMM 或管网水力模型",
                "未退净（right_censored）与缺测（gap_unresolved）事件的退水时间未知，绝不外推或填零",
                "单次短运行切片（45h，1cm 量化），非已核验暴雨事件档案，不可外推为常年退水能力",
                "本表无 available_at 列，不得用于回放/同化（fail-closed 审计会拒绝）",
            ],
        }
    return _CACHE


def district_features(district_id: str) -> Dict[str, Any]:
    """Per-district observed drainage features for model/API consumption."""
    summary = get_drainage_summary()
    district = summary["districts"].get(str(district_id))
    if district is not None:
        return dict(district)
    return {**_EMPTY_DISTRICT, "district_id": str(district_id)}


def reset_cache() -> None:
    """Drop the memoised summary (used by tests after swapping data files)."""
    global _CACHE
    _CACHE = None


__all__ = [
    "THRESHOLD_M",
    "SEVERE_DEPTH_M",
    "MAX_GAP_H",
    "get_drainage_summary",
    "district_features",
    "reset_cache",
]
