# -*- coding: utf-8 -*-
"""Reservoir operations: flood storage, pre-release plan, joint river warning.

Shenzhen's flood defence relies on its reservoir chain (铁岗/深圳/西丽/石岩/
清林径/罗田…).  This module computes, per reservoir:

1. **Flood storage** (蓄洪余量) — remaining capacity below the flood-limited
   level, from published capacity parameters and (when available) live level
   telemetry from ``shenzhen-flood/data/reservoirs/raw/sz_reservoir_levels.csv``.
2. **Pre-release plan** (预泄调度) — driven by the 48 h rainfall forecast: if
   forecast inflow exceeds the remaining storage, suggest pre-releasing at a
   safe rate ahead of the storm (conservative, water-supply-safe).
3. **Joint river + flash-flood warning** (下游河道+山洪沟道联合预警) — feeds
   reservoir releases into the river-basin model (``river.RiverBasinModel``)
   and grades named mountain-stream catchments by rainfall intensity.

Reservoir capacity parameters are compiled from public sources (Wikipedia /
government bulletins) and are approximate — overridable via the JSON data
file.  All engineering rules are simplified and labelled as such.
"""
from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from . import climate_hazards, river, shenzhen

DATA_BASE = Path(__file__).resolve().parent.parent / "data"
RESERVOIR_FILE = DATA_BASE / "reservoirs" / "shenzhen_reservoirs.json"
_SZ_FLOOD_DATA = Path(
    os.environ.get(
        "SZ_FLOOD_DATA_BASE",
        str(Path(__file__).resolve().parents[3] / "shenzhen-flood" / "data"),
    )
)
LEVELS_FILE = _SZ_FLOOD_DATA / "reservoirs" / "raw" / "sz_reservoir_levels.csv"
RAIN_FILE = _SZ_FLOOD_DATA / "reservoirs" / "raw" / "sz_reservoir_rainfall.csv"

# Engineering rules (simplified, approximate)
RUNOFF_COEFF = 0.70          # catchment runoff coefficient
STORAGE_RATIO = 0.70         # assumed live storage ratio when level unknown
SAFETY_MARGIN = 0.10         # 10 % storage safety margin
PRE_RELEASE_WINDOW_H = 12.0  # suggested release window for yellow action
RED_RELEASE_WINDOW_H = 24.0  # forced release window for red action
TRIGGER_YELLOW = 0.60        # release if forecast inflow > 60 % remaining storage

# Flash-flood gully catchments (named real gullies, approximate locations)
GULLIES = [
    {"id": "longgang_up", "name": "龙岗河上游（清林径—龙岗）", "lat": 22.71, "lon": 114.23,
     "slope": "陡", "type": "山区小流域", "downstream": "龙岗街道、坪地", "district": "longgang"},
    {"id": "pingshan_up", "name": "坪山河上游（马峦山）", "lat": 22.66, "lon": 114.34,
     "slope": "陡", "type": "山区小流域", "downstream": "坪山街道、马峦山郊野公园", "district": "pingshan"},
    {"id": "yantian_river", "name": "盐田河（梧桐山东麓）", "lat": 22.58, "lon": 114.24,
     "slope": "陡", "type": "山前溪流", "downstream": "盐田街道、大小梅沙", "district": "yantian"},
    {"id": "kuiyong", "name": "葵涌河（大鹏北部）", "lat": 22.62, "lon": 114.42,
     "slope": "陡", "type": "山区小流域", "downstream": "葵涌街道", "district": "dapeng"},
    {"id": "nanao", "name": "南澳河（大鹏南部）", "lat": 22.50, "lon": 114.49,
     "slope": "陡", "type": "山区小流域", "downstream": "南澳街道", "district": "dapeng"},
    {"id": "tanglang", "name": "塘朗山北坡沟", "lat": 22.60, "lon": 114.00,
     "slope": "陡", "type": "城郊山沟", "downstream": "西丽、桃源街道", "district": "nanshan"},
    {"id": "fenghuang", "name": "凤凰山沟（福永）", "lat": 22.68, "lon": 113.83,
     "slope": "中", "type": "城郊山沟", "downstream": "福永、凤凰街道", "district": "baoan"},
    {"id": "maluan", "name": "马峦山溪谷", "lat": 22.64, "lon": 114.31,
     "slope": "陡", "type": "山区溪谷", "downstream": "碧岭、马峦街道", "district": "pingshan"},
    {"id": "paiya", "name": "排牙山沟", "lat": 22.59, "lon": 114.43,
     "slope": "陡", "type": "山区小流域", "downstream": "大鹏街道", "district": "dapeng"},
    {"id": "qiniang", "name": "七娘山沟", "lat": 22.53, "lon": 114.53,
     "slope": "极陡", "type": "山区小流域", "downstream": "南澳、东涌", "district": "dapeng"},
]

_LOCK = threading.RLock()
_CACHE: Dict[str, Any] = {}


def _load_reservoirs() -> List[Dict[str, Any]]:
    with _LOCK:
        if "reservoirs" in _CACHE:
            return _CACHE["reservoirs"]
    try:
        data = json.loads(RESERVOIR_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = []
    with _LOCK:
        _CACHE["reservoirs"] = data
    return data


def _latest_levels() -> Dict[str, float]:
    """Latest telemetry level per station code (real data, single-day slice)."""
    with _LOCK:
        if "levels" in _CACHE:
            return _CACHE["levels"]
    latest: Dict[str, float] = {}
    if LEVELS_FILE.exists():
        with LEVELS_FILE.open(encoding="utf-8", errors="replace") as fh:
            header = fh.readline()
            cols = [c.strip() for c in header.split(",")]
            if "测站编码" in cols and "时水位（m）" in cols:
                idx_code = cols.index("测站编码")
                idx_level = cols.index("时水位（m）")
                for line in fh:
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) <= max(idx_code, idx_level):
                        continue
                    code = parts[idx_code]
                    try:
                        level = float(parts[idx_level])
                    except ValueError:
                        continue
                    latest[code] = level
    with _LOCK:
        _CACHE["levels"] = latest
    return latest


def _latest_rainfall_mm_h() -> Dict[str, float]:
    """Latest rainfall per reservoir name (real data)."""
    with _LOCK:
        if "rain" in _CACHE:
            return _CACHE["rain"]
    latest: Dict[str, float] = {}
    if RAIN_FILE.exists():
        with RAIN_FILE.open(encoding="utf-8", errors="replace") as fh:
            header = fh.readline()
            cols = [c.strip() for c in header.split(",")]
            if "水库名称" in cols and "平均降雨量" in cols:
                idx_name = cols.index("水库名称")
                idx_rain = cols.index("平均降雨量")
                for line in fh:
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) <= max(idx_name, idx_rain):
                        continue
                    name = parts[idx_name].strip('"')
                    try:
                        rain = float(parts[idx_rain])
                    except ValueError:
                        continue
                    if name and name != "深圳":
                        latest[name] = rain
    with _LOCK:
        _CACHE["rain"] = latest
    return latest


def _forecast_rain_mm_h() -> List[float]:
    """48 h district-max rainfall from Open-Meteo (falls back to zeros)."""
    try:
        import urllib.request, gzip as _gz
        lats = ",".join(f"{d['center'][0]:.3f}" for d in shenzhen.DISTRICTS)
        lons = ",".join(f"{d['center'][1]:.3f}" for d in shenzhen.DISTRICTS)
        url = (f"https://api.open-meteo.com/v1/forecast?latitude={lats}&longitude={lons}"
               f"&hourly=precipitation&forecast_days=3&timezone=Asia%2FShanghai")
        req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = _gz.decompress(raw)
            d = json.loads(raw.decode())
        feeds = d if isinstance(d, list) else [d]
        n = len(feeds[0]["hourly"]["precipitation"])
        out = []
        for i in range(n):
            out.append(max(feeds[j]["hourly"]["precipitation"][i] or 0.0 for j in range(len(feeds))))
        return out[:48]
    except Exception:
        return [0.0] * 48


def _storage_ratio_from_level(res: Dict[str, Any], level: Optional[float]) -> float:
    """Rough level->storage ratio: linear between dead and flood-limited level."""
    if level is None:
        return STORAGE_RATIO
    normal = res.get("normal_level_m", 30.0)
    dead = res.get("dead_level_m", 20.0)
    if normal <= dead:
        return STORAGE_RATIO
    return max(0.0, min(1.0, (level - dead) / (normal - dead)))


def inventory() -> Dict[str, Any]:
    """Reservoir list with storage / flood margin (live level where matched)."""
    levels = _latest_levels()
    rain = _latest_rainfall_mm_h()
    reservoirs = []
    for res in _load_reservoirs():
        total_10k = float(res.get("total_capacity_10k_m3", 0.0))
        live_10k = total_10k * _storage_ratio_from_level(res, None)
        # try live level: no name mapping in telemetry, so match by code
        # (station codes are not linked to names — report telemetry count only)
        current_rain = rain.get(res["name"])
        flood_margin_10k = total_10k * (1.0 - STORAGE_RATIO)
        reservoirs.append({
            "name": res["name"],
            "district": res.get("district", ""),
            "lat": res.get("lat"), "lon": res.get("lon"),
            "total_capacity_10k_m3": total_10k,
            "normal_level_m": res.get("normal_level_m"),
            "flood_limited_level_m": res.get("flood_limited_level_m"),
            "catchment_km2": res.get("catchment_km2"),
            "primary_use": res.get("primary_use", ""),
            "current_rainfall_mm_h": current_rain,
            "live_storage_10k_m3": round(live_10k, 0),
            "flood_margin_10k_m3": round(flood_margin_10k, 0),
            "storage_ratio_assumed": STORAGE_RATIO,
            "source": res.get("source", ""),
        })
    reservoirs.sort(key=lambda r: -r["total_capacity_10k_m3"])
    return {
        "count": len(reservoirs),
        "total_capacity_10k_m3": round(sum(r["total_capacity_10k_m3"] for r in reservoirs), 0),
        "total_flood_margin_10k_m3": round(sum(r["flood_margin_10k_m3"] for r in reservoirs), 0),
        "telemetry_stations": len(levels),
        "telemetry_slice": "2026-07-31 (单日切片，测站编码未关联水库名)",
        "reservoirs": reservoirs,
        "provenance": (
            "observed-derived(水位/雨量真实台账) + published(库容参数来自维基/公报, approximate, 可配置覆盖)"
        ),
        "limitations": [
            "库容参数为公开资料整理（部分为近似），非设计文件",
            "蓄水率在无水位遥测时按 70% 假设，实时水位测站未与水库名关联",
            "库容曲线为线性近似，未计入死库容以下与坝顶以上",
        ],
    }


def pre_release(rainfall_mm_h: Optional[List[float]] = None) -> Dict[str, Any]:
    """Pre-release plan per reservoir from the 48 h rainfall forecast."""
    if rainfall_mm_h is None:
        rainfall_mm_h = _forecast_rain_mm_h()
    rain = [float(x) for x in rainfall_mm_h[:48]] or [0.0] * 48
    rain_48_mm = sum(rain)
    peak_mm_h = max(rain)
    releases = []
    total_release_m3_s = 0.0
    for res in _load_reservoirs():
        catchment = float(res.get("catchment_km2", 0.0))
        if catchment <= 0:
            continue
        total_10k = float(res.get("total_capacity_10k_m3", 0.0))
        margin_10k = total_10k * (1.0 - STORAGE_RATIO)
        # inflow volume over 48h: rain(mm) * catchment(km2) * runoff / 1000 -> 万m³
        inflow_10k = rain_48_mm / 1000.0 * catchment * 1e6 * RUNOFF_COEFF / 1e4
        ratio = inflow_10k / margin_10k if margin_10k > 0 else 9.9
        if inflow_10k <= TRIGGER_YELLOW * margin_10k:
            action, level, q = "无需预泄", "green", 0.0
        elif inflow_10k <= margin_10k:
            q = (inflow_10k - TRIGGER_YELLOW * margin_10k) * 1e4 / (PRE_RELEASE_WINDOW_H * 3600.0)
            action, level = f"建议预泄（{PRE_RELEASE_WINDOW_H:.0f}h 窗）", "yellow"
        else:
            q = (inflow_10k + SAFETY_MARGIN * margin_10k - margin_10k) * 1e4 / (RED_RELEASE_WINDOW_H * 3600.0)
            action, level = f"强制预泄（{RED_RELEASE_WINDOW_H:.0f}h 窗，下游联动）", "red"
        releases.append({
            "name": res["name"], "district": res.get("district", ""),
            "catchment_km2": catchment,
            "rain_48h_mm": round(rain_48_mm, 1),
            "inflow_48h_10k_m3": round(inflow_10k, 0),
            "flood_margin_10k_m3": round(margin_10k, 0),
            "inflow_margin_ratio": round(ratio, 2),
            "action": action, "level": level,
            "suggested_release_m3_s": round(q, 1),
            "suggest_start": "建议降雨前 6–12h 开始，控制出库流量不超下游河道安全泄量",
        })
        total_release_m3_s += q
    releases.sort(key=lambda r: -r["inflow_margin_ratio"])
    any_red = any(r["level"] == "red" for r in releases)
    any_yellow = any(r["level"] == "yellow" for r in releases)
    return {
        "forecast": {"rain_48h_mm": round(rain_48_mm, 1), "peak_mm_h": round(peak_mm_h, 1), "window_h": 48},
        "city_level": "red" if any_red else "yellow" if any_yellow else "green",
        "total_suggested_release_m3_s": round(total_release_m3_s, 1),
        "releases": releases,
        "rules": {
            "runoff_coefficient": RUNOFF_COEFF, "storage_ratio": STORAGE_RATIO,
            "trigger_yellow": TRIGGER_YELLOW, "safety_margin": SAFETY_MARGIN,
        },
        "provenance": "modeled(降雨预报×集雨面积→入库水量 vs 蓄洪余量; 简化工程估算)",
        "limitations": [
            "入库水量为线性集总估算（未考虑洪峰错峰、上游水库串并联、河道演进）",
            "预泄量建议为保守均值流量，实际需按调度规程与水情会商确定",
            "供水保障与生态基流约束未建模",
        ],
    }


def river_warning(rainfall_mm_h: Optional[List[float]] = None,
                  release_m3_s: float = 0.0) -> Dict[str, Any]:
    """Joint downstream-river + flash-gully warning."""
    if rainfall_mm_h is None:
        rainfall_mm_h = _forecast_rain_mm_h()
    rain = [float(x) for x in rainfall_mm_h[:48]] or [0.0] * 48
    max_rain_h = max(rain)
    rain_3h = sum(rain[:3])
    rain_24h = sum(rain[:24])

    # 1) river reaches via the conservative basin model (rain drives all reaches)
    rain_mat = np.column_stack([rain] * len(river.DEFAULT_MODEL.ids))
    sim = river.DEFAULT_MODEL.simulate(rain_mat)
    reaches = []
    for i, rid in enumerate(sim["reach_ids"]):
        q = float(sim["channel_flow_m3_s"][-1, i])
        overbank = float(sim["floodplain_storage_m3"][-1, i])
        topo = sim["topology"][i]
        bankfull = topo["bankfull_m3_s"]
        status = "超警溢流" if overbank > 0 else "接近警戒" if q > 0.8 * bankfull else "正常"
        reaches.append({
            "reach_id": rid, "bankfull_m3_s": bankfull,
            "flow_m3_s": round(q, 1), "flow_ratio": round(q / bankfull, 2) if bankfull else 0,
            "floodplain_storage_m3": round(overbank, 0), "status": status,
        })

    # 2) flash-flood gullies graded by rainfall intensity + slope
    gullies = []
    for g in GULLIES:
        slope_w = {"缓": 0.5, "中": 1.0, "陡": 1.5, "极陡": 2.0}.get(g["slope"], 1.0)
        intensity = max_rain_h * slope_w
        if intensity >= 40 or rain_24h >= 120:
            level, label = "red", "极高风险"
        elif intensity >= 25 or rain_24h >= 80 or rain_3h >= 50:
            level, label = "orange", "高风险"
        elif intensity >= 15 or rain_24h >= 50:
            level, label = "yellow", "关注"
        else:
            level, label = "green", "正常"
        gullies.append({
            "id": g["id"], "name": g["name"], "lat": g["lat"], "lon": g["lon"],
            "slope": g["slope"], "downstream": g["downstream"],
            "district": g["district"],
            "rain_peak_mm_h": round(max_rain_h, 1), "rain_24h_mm": round(rain_24h, 1),
            "level": level, "label": label,
        })

    # 3) joint: release + rain -> river status
    joint = {
        "release_m3_s": round(release_m3_s, 1),
        "river_alerts": [r for r in reaches if r["status"] != "正常"],
        "gully_alerts": [g for g in gullies if g["level"] in ("orange", "red")],
    }
    return {
        "rainfall": {"peak_mm_h": round(max_rain_h, 1), "3h_mm": round(rain_3h, 1),
                     "24h_mm": round(rain_24h, 1)},
        "reaches": reaches,
        "gullies": gullies,
        "joint": joint,
        "provenance": (
            "modeled(conservative river-basin model + intensity-slope gully grading; "
            "降雨为 Open-Meteo 预报)"
        ),
        "limitations": [
            "河道为集总参数模型，未含实测流量同化（EnSRF 接口可用）",
            "山洪分级为雨强+坡度经验法则，非水文模型",
            "水库泄洪入流按常数并入上游（未演进）",
        ],
    }


def summary() -> Dict[str, Any]:
    """One-call summary card for the command view."""
    inv = inventory()
    rel = pre_release()
    rw = river_warning()
    clim = climate_hazards.monitor()
    return {
        "reservoirs": {
            "count": inv["count"],
            "total_capacity_10k_m3": inv["total_capacity_10k_m3"],
            "total_flood_margin_10k_m3": inv["total_flood_margin_10k_m3"],
        },
        "pre_release": {"city_level": rel["city_level"],
                        "total_release_m3_s": rel["total_suggested_release_m3_s"],
                        "red_count": sum(1 for r in rel["releases"] if r["level"] == "red"),
                        "yellow_count": sum(1 for r in rel["releases"] if r["level"] == "yellow")},
        "river": {"alert_reaches": len(rw["joint"]["river_alerts"]),
                  "alert_gullies": len(rw["joint"]["gully_alerts"])},
        "climate": {"heat": clim.get("city_alert", {}).get("heatwave", {}).get("count", 0),
                    "fog": clim.get("city_alert", {}).get("dense_fog", {}).get("count", 0),
                    "storm": clim.get("city_alert", {}).get("thunderstorm", {}).get("count", 0)}
        if "error" not in clim else {},
        "provenance": "mixed(real telemetry + published params + Open-Meteo + simplified models)",
    }


def reset_cache() -> None:
    with _LOCK:
        _CACHE.clear()


__all__ = ["inventory", "pre_release", "river_warning", "summary", "reset_cache"]
