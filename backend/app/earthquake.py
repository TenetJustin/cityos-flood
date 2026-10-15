# -*- coding: utf-8 -*-
"""Earthquake module: catalog, faults, shake-intensity assessment, risk.

Shenzhen sits on the southeast China coastal seismic belt (华南沿海地震带).
The city itself has no destructive earthquake on record, but the region around
it does: the Xinfengjiang reservoir region (河源, ~180 km NE) produced M6.1 in
1962 and frequent M4–5 events; the offshore Binhai fault zone (滨海断裂带)
is the closest capable source (~25–50 km south of the city).

Data:
- ``shenzhen-flood/data/earthquake/sz_region_quakes.csv`` — real USGS catalog
  (1970–2026, M≥4, box 18–26°N / 106–118°E, 98 events).
- ``backend/data/earthquake/shenzhen_faults.json`` — faults compiled from
  published tectonic maps (approximate traces, labelled as such).
- Intensity attenuation: simplified GA-style (MMI) formula, approximate.

Everything is deterministic and local; no network access at request time.
"""
from __future__ import annotations

import csv
import json
import math
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import shenzhen
from .data_paths import EXTERNAL_DATA

DATA_BASE = Path(__file__).resolve().parent.parent / "data"
_SZ_FLOOD_DATA = EXTERNAL_DATA
CATALOG_FILE = _SZ_FLOOD_DATA / "earthquake" / "sz_region_quakes.csv"
FAULTS_FILE = DATA_BASE / "earthquake" / "shenzhen_faults.json"

# Shenzhen urban reference (福田 CBD)
SZ_LAT, SZ_LON = 22.545, 114.060

_LOCK = threading.RLock()
_CACHE: Dict[str, Any] = {}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _load_catalog() -> List[Dict[str, Any]]:
    with _LOCK:
        if "catalog" in _CACHE:
            return _CACHE["catalog"]
    rows: List[Dict[str, Any]] = []
    if CATALOG_FILE.exists():
        with CATALOG_FILE.open(encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                try:
                    rows.append({
                        "time": row["time"],
                        "mag": float(row["mag"]) if row.get("mag") else None,
                        "place": row.get("place", ""),
                        "lat": float(row["lat"]),
                        "lon": float(row["lon"]),
                        "depth_km": float(row["depth_km"]) if row.get("depth_km") else None,
                        "id": row.get("id", ""),
                        "distance_km": round(_haversine_km(SZ_LAT, SZ_LON,
                                                           float(row["lat"]), float(row["lon"])), 1),
                    })
                except (ValueError, KeyError, TypeError):
                    continue
    rows.sort(key=lambda r: r.get("time") or "")
    with _LOCK:
        _CACHE["catalog"] = rows
    return rows


def _load_faults() -> List[Dict[str, Any]]:
    with _LOCK:
        if "faults" in _CACHE:
            return _CACHE["faults"]
    faults: List[Dict[str, Any]] = []
    if FAULTS_FILE.exists():
        try:
            faults = json.loads(FAULTS_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            faults = []
    with _LOCK:
        _CACHE["faults"] = faults
    return faults


def _distance_to_segment_km(lat: float, lon: float, seg: List[List[float]]) -> float:
    """Distance (km) from point to a polyline (fault trace)."""
    best = float("inf")
    for (ax, ay), (bx, by) in zip(seg, seg[1:]):
        px, py = lon, lat
        vx, vy = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        L2 = vx * vx + vy * vy
        if L2 <= 0:
            best = min(best, _haversine_km(lat, lon, ay, ax))
            continue
        t = max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
        cx, cy = ax + t * vx, ay + t * vy
        best = min(best, _haversine_km(lat, lon, cy, cx))
    return best if math.isfinite(best) else float("inf")


def _mmi_from_mag_depth(mag: float, depth_km: float, dist_km: float) -> float:
    """Simplified MMI attenuation (GA-style), approximate.

    Epicentral intensity I0 ≈ 1.5·M − 3.5; decays logarithmically with
    hypocentral distance.  No site-amplification term.
    """
    if dist_km <= 0:
        return max(1.0, 1.5 * mag - 3.5)
    hypo = math.hypot(dist_km, max(depth_km, 5.0))
    i0 = 1.5 * mag - 3.5
    # decay: -3.2 log10(R/10) beyond 10 km hypocentral
    return max(1.0, i0 - 3.2 * math.log10(max(hypo, 10.0) / 10.0))


def _mmi_label(mmi: float) -> str:
    if mmi >= 8: return "Ⅷ 破坏性大震"
    if mmi >= 7: return "Ⅶ 房屋破坏"
    if mmi >= 6: return "Ⅵ 建筑物受损"
    if mmi >= 5: return "Ⅴ 普遍有感"
    if mmi >= 4: return "Ⅳ 室内有感"
    if mmi >= 3: return "Ⅲ 轻微有感"
    return "Ⅱ 无感"


def catalog(min_mag: float = 0.0, max_distance_km: Optional[float] = None,
            limit: int = 100) -> Dict[str, Any]:
    """Historical catalog around Shenzhen (USGS, real data)."""
    rows = [r for r in _load_catalog() if (r["mag"] or 0) >= min_mag]
    if max_distance_km is not None:
        rows = [r for r in rows if r["distance_km"] <= max_distance_km]
    rows = rows[-limit:]
    recent = [r for r in rows if (r["time"] or "") >= "2020-01-01"]
    max_mag = max((r["mag"] for r in rows if r["mag"]), default=0.0)
    return {
        "total_in_region": len(_load_catalog()),
        "shown": len(rows),
        "min_mag": min_mag,
        "max_distance_km": max_distance_km,
        "max_mag_shown": max_mag,
        "recent_since_2020": len(recent),
        "events": rows,
        "provenance": "observed(USGS FDSN catalog 1970–2026, M≥4, 18–26°N/106–118°E)",
    }


def faults() -> Dict[str, Any]:
    f = _load_faults()
    features = []
    for flt in f:
        features.append({
            "id": flt["id"], "name": flt["name"], "type": flt.get("type", ""),
            "length_km": flt.get("length_km"), "note": flt.get("note", ""),
            "coordinates": flt["coords"],
        })
    return {
        "count": len(features),
        "faults": features,
        "provenance": "published tectonic maps (approximate traces, not surveyed)",
        "note": "断裂位置为公开文献示意，非实测勘测；用于风险分级示意",
    }


def scenario(mag: float = 6.0, lat: float = SZ_LAT, lon: float = SZ_LON,
             depth_km: float = 10.0, name: str = "") -> Dict[str, Any]:
    """Rapid intensity assessment for a scenario earthquake (approximate)."""
    if not 3.0 <= mag <= 8.5:
        raise ValueError("mag must be within [3.0, 8.5]")
    districts = []
    for d in shenzhen.DISTRICTS:
        dlat, dlon = d["center"]
        dist = _haversine_km(lat, lon, dlat, dlon)
        mmi = _mmi_from_mag_depth(mag, depth_km, dist)
        districts.append({
            "district_id": d["id"], "district_name": d["name"],
            "distance_km": round(dist, 1),
            "mmi": round(mmi, 2), "mmi_label": _mmi_label(mmi),
            "impact": _impact(mmi),
        })
    districts.sort(key=lambda x: -x["mmi"])
    radius_km = {}
    for level, mmi in (("有感(≥Ⅲ)", 3.0), ("普遍有感(≥Ⅴ)", 5.0), ("破坏(≥Ⅵ)", 6.0)):
        radius_km[level] = _radius_for_mmi(mag, depth_km, mmi)
    epic_mmi = _mmi_from_mag_depth(mag, depth_km, 0.0)
    return {
        "scenario": name or f"M{mag} 情景",
        "hypocenter": {"lat": round(lat, 4), "lon": round(lon, 4), "depth_km": depth_km},
        "epicentral_mmi": round(epic_mmi, 2),
        "epicentral_mmi_label": _mmi_label(epic_mmi),
        "radius_km": radius_km,
        "districts": districts,
        "method": "GA-style MMI attenuation (approximate, no site amplification)",
        "provenance": "modeled(快速烈度评估, 非官方地震预警)",
        "limitations": [
            "烈度衰减为经验公式，未计入场地土放大/建筑结构差异",
            "非地震预警系统输出，仅指挥决策参考",
            "断裂带情景震源位置为示意",
        ],
    }


def _radius_for_mmi(mag: float, depth_km: float, target_mmi: float) -> float:
    i0 = 1.5 * mag - 3.5
    if target_mmi >= i0:
        return 0.0
    ratio = 10.0 ** ((i0 - target_mmi) / 3.2)  # hypocentral distance
    hypo = max(ratio * 10.0, 10.0)
    return round(max(0.0, math.sqrt(max(hypo * hypo - depth_km * depth_km, 0.0))), 1)


def _impact(mmi: float) -> str:
    if mmi >= 7: return "严重：老旧建筑可能倒塌，需紧急疏散与搜救"
    if mmi >= 6: return "较高：房屋受损，危险建筑撤离，交通管制"
    if mmi >= 5: return "明显：普遍有感，个别建筑裂缝，检查高危设施"
    if mmi >= 4: return "轻度：室内有感，无需疏散"
    return "基本无影响"


def nearest_fault(lat: float = SZ_LAT, lon: float = SZ_LON) -> Dict[str, Any]:
    best, best_d = None, float("inf")
    for flt in _load_faults():
        d = _distance_to_segment_km(lat, lon, flt["coords"])
        if d < best_d:
            best, best_d = flt, d
    if best is None:
        return {"error": "no fault data"}
    return {
        "point": {"lat": round(lat, 4), "lon": round(lon, 4)},
        "nearest_fault": best["name"],
        "distance_km": round(best_d, 1),
        "fault_type": best.get("type", ""),
        "note": best.get("note", ""),
    }


def risk_summary() -> Dict[str, Any]:
    """District-level seismic risk: fault proximity + historic seismicity + exposure."""
    faults_data = _load_faults()
    catalog_rows = _load_catalog()
    districts = []
    for d in shenzhen.DISTRICTS:
        dlat, dlon = d["center"]
        nearest = min(
            (_distance_to_segment_km(dlat, dlon, flt["coords"]) for flt in faults_data),
            default=float("inf"),
        )
        nearby = [r for r in catalog_rows if r["distance_km"] <= 120 and (r["mag"] or 0) >= 4.5]
        max_mag = max((r["mag"] for r in nearby), default=0.0)
        # score 0-100: proximity (60) + historic (25) + exposure (15)
        prox = 0.0 if nearest < 5 else min(60.0, max(0.0, (60.0 - nearest) * 1.2))
        hist = min(25.0, max_mag * 4.0)
        expo = min(15.0, (d.get("impervious_ratio", 0.5) * 15.0))
        score = round(prox + hist + expo, 1)
        level = "high" if score >= 50 else "medium" if score >= 30 else "low"
        districts.append({
            "district_id": d["id"], "district_name": d["name"],
            "nearest_fault_km": round(nearest, 1),
            "historic_max_mag_120km": max_mag,
            "score": score, "level": level,
        })
    districts.sort(key=lambda x: -x["score"])
    return {
        "districts": districts,
        "city_level": "medium",
        "basis": "断裂带邻近度 + 120km 内历史最大震级 + 建成区暴露度",
        "provenance": "modeled(公开断层示意 + USGS 真实目录, 近似分级)",
        "note": "深圳主城区 1970 年以来无破坏性地震记录；风险主要来自邻区（河源震区、滨海断裂带）",
    }


def reset_cache() -> None:
    with _LOCK:
        _CACHE.clear()


__all__ = ["catalog", "faults", "scenario", "nearest_fault", "risk_summary", "reset_cache"]
