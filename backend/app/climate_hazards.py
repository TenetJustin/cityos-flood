# -*- coding: utf-8 -*-
"""Climate hazards: heatwave, dense fog, and thunderstorm monitoring.

Adds the three most frequent non-typhoon weather hazards in Shenzhen to the
real-time stack, using the same Open-Meteo feed as ``live_ops`` (free,
hourly, 10 district centres, 48 h):

- Heatwave: daily Tmax ≥ 35 °C (yellow) / 37 °C (orange) / 40 °C (red);
  a heatwave is 3+ consecutive days ≥ 35 °C; apparent temperature ≥ 38 °C
  flagged as high-risk for outdoor work.
- Dense fog: visibility < 500 m (yellow) / < 200 m (orange); < 1 km flagged.
- Thunderstorm: WMO weather code 95 (thunderstorm) / 96–99 (with hail);
  count of storm hours in the 48 h window drives the warning level.

Warning colour levels follow the Shenzhen Meteorological Bureau conventions
(approximate mapping).  No official live feed is available without a paid
contract, so thresholds are applied to Open-Meteo forecast fields.
"""
from __future__ import annotations

import gzip
import json
import threading
import urllib.request
from typing import Any, Dict, List, Optional

from . import shenzhen

_CACHE = {"ts": 0, "data": None, "ttl": 600}
_LOCK = threading.RLock()
_OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler())

HEAT_THRESHOLDS = {"yellow": 35.0, "orange": 37.0, "red": 40.0}
FOG_THRESHOLDS = {"yellow": 500.0, "orange": 200.0}
HEATWAVE_DAYS = 3
HEAT_APPARENT_RISK = 38.0

WMO_NAMES = {
    0: "晴", 1: "基本晴", 2: "多云", 3: "阴", 45: "雾", 48: "雾凇雾",
    51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
    71: "小雪", 73: "中雪", 75: "大雪", 80: "阵雨", 81: "阵雨", 82: "强阵雨",
    95: "雷暴", 96: "雷暴+冰雹", 99: "强雷暴+冰雹",
}


def _fetch():
    lats = ",".join(f"{d['center'][0]:.3f}" for d in shenzhen.DISTRICTS)
    lons = ",".join(f"{d['center'][1]:.3f}" for d in shenzhen.DISTRICTS)
    url = (f"https://api.open-meteo.com/v1/forecast"
           f"?latitude={lats}&longitude={lons}"
           f"&hourly=temperature_2m,apparent_temperature,visibility,weather_code,precipitation"
           f"&current=temperature_2m,apparent_temperature,visibility,weather_code,precipitation"
           f"&forecast_days=3&timezone=Asia%2FShanghai")
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"})
            with _OPENER.open(req, timeout=25) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                d = json.loads(raw.decode())
            return d if isinstance(d, list) else [d]
        except Exception:
            if attempt == 2:
                return None
            import time
            time.sleep(2)
    return None


def _heat_level(daily_max: float, consecutive_days: int) -> Dict[str, Any]:
    if daily_max >= HEAT_THRESHOLDS["red"]:
        lvl = "red"
    elif daily_max >= HEAT_THRESHOLDS["orange"]:
        lvl = "orange"
    elif daily_max >= HEAT_THRESHOLDS["yellow"]:
        lvl = "yellow"
    else:
        lvl = "none"
    if lvl != "none" and consecutive_days >= HEATWAVE_DAYS:
        lvl = "heatwave"
    return {
        "level": lvl,
        "tmax_c": round(daily_max, 1),
        "consecutive_hot_days": consecutive_days,
        "label": {"none": "无高温", "yellow": "高温黄色", "orange": "高温橙色",
                  "red": "高温红色", "heatwave": f"热浪（连续{HEATWAVE_DAYS}天≥35°C）"}[lvl],
    }


def _fog_level(min_visibility_m: float) -> Dict[str, Any]:
    if min_visibility_m < FOG_THRESHOLDS["orange"]:
        lvl = "orange"
    elif min_visibility_m < FOG_THRESHOLDS["yellow"]:
        lvl = "yellow"
    elif min_visibility_m < 1000.0:
        lvl = "watch"
    else:
        lvl = "none"
    return {
        "level": lvl,
        "min_visibility_m": round(min_visibility_m, 0),
        "label": {"none": "无大雾", "watch": "轻雾/能见度偏低",
                  "yellow": "大雾黄色(<500m)", "orange": "大雾橙色(<200m)"}[lvl],
    }


def _storm_level(storm_hours_48h: int, hail: bool) -> Dict[str, Any]:
    if hail:
        lvl = "orange"
    elif storm_hours_48h >= 12:
        lvl = "orange"
    elif storm_hours_48h >= 4:
        lvl = "yellow"
    else:
        lvl = "none"
    return {
        "level": lvl,
        "storm_hours_48h": storm_hours_48h,
        "hail": hail,
        "label": {"none": "无雷暴", "yellow": "雷电黄色", "orange": "雷电橙色（强雷暴/冰雹）"}[lvl],
    }


def monitor(force: bool = False) -> Dict[str, Any]:
    """Realtime 10-district monitor for heat / fog / thunderstorm."""
    now = _CACHE.get("ts", 0)
    if _CACHE.get("data") is not None and not force and (now is None or now > 0):
        if __import__("time").time() - _CACHE["ts"] < _CACHE["ttl"]:
            return _CACHE["data"]

    feeds = _fetch()
    if not feeds:
        return {"error": "Open-Meteo 不可达", "available": False}

    districts = []
    for d, f in zip(shenzhen.DISTRICTS, feeds):
        h = f.get("hourly", {})
        cur = f.get("current", {})
        times = h.get("time", [])
        temps = h.get("temperature_2m", [])
        appt = h.get("apparent_temperature", [])
        vis = h.get("visibility", [])
        codes = h.get("weather_code", [])

        # next-48h slice
        tmax_48 = max((t for t in temps if t is not None), default=0.0)
        vis_48 = min((v for v in vis if v is not None), default=10000.0)
        storm_hours = sum(1 for c in codes if c is not None and c >= 95)
        hail = any(c is not None and c >= 96 for c in codes)

        # consecutive hot days (rough: scan 3 chunks of the 3-day window)
        days = []
        n_h = len(temps)
        for i in range(3):
            chunk = temps[i * 24:(i + 1) * 24] if n_h >= 72 else temps
            days.append(max((t for t in chunk if t is not None), default=0.0))
        hot_run = 0
        for day_tmax in days:
            if day_tmax >= HEAT_THRESHOLDS["yellow"]:
                hot_run += 1
            else:
                break

        heat = _heat_level(tmax_48, hot_run)
        fog = _fog_level(vis_48)
        storm = _storm_level(storm_hours, hail)
        districts.append({
            "district_id": d["id"],
            "district_name": d["name"],
            "current": {
                "temperature_c": cur.get("temperature_2m"),
                "apparent_temperature_c": cur.get("apparent_temperature"),
                "visibility_m": cur.get("visibility"),
                "weather_code": cur.get("weather_code"),
                "weather_text": WMO_NAMES.get(cur.get("weather_code"), "—"),
                "precipitation_mm_h": cur.get("precipitation"),
            },
            "heat": heat,
            "fog": fog,
            "storm": storm,
            "apparent_risk": bool(appt and appt[-1] and appt[-1] >= HEAT_APPARENT_RISK),
        })

    active_heat = [d for d in districts if d["heat"]["level"] not in ("none",)]
    active_fog = [d for d in districts if d["fog"]["level"] not in ("none",)]
    active_storm = [d for d in districts if d["storm"]["level"] not in ("none",)]

    result = {
        "available": True,
        "generated_at": feeds[0].get("current", {}).get("time"),
        "districts": districts,
        "city_alert": {
            "heatwave": {"count": len(active_heat), "districts": [d["district_name"] for d in active_heat[:8]],
                          "top": max((d["heat"] for d in districts), key=lambda x: x["tmax_c"]) if districts else None},
            "dense_fog": {"count": len(active_fog), "districts": [d["district_name"] for d in active_fog[:8]]},
            "thunderstorm": {"count": len(active_storm), "districts": [d["district_name"] for d in active_storm[:8]]},
        },
        "thresholds": {
            "heat": HEAT_THRESHOLDS, "heatwave_days": HEATWAVE_DAYS,
            "fog_m": FOG_THRESHOLDS, "apparent_risk_c": HEAT_APPARENT_RISK,
        },
        "source": "Open-Meteo hourly forecast (free tier), thresholds per Shenzhen Met Bureau conventions (approximate)",
        "provenance": "observed-derived(Open-Meteo 逐时预报 + 阈值分级)",
        "limitations": [
            "非官方气象预警信号，阈值为参照深圳气象台约定的近似映射",
            "雷电仅依据天气代码（95–99），非闪电定位网数据",
            "热浪连续天数为 3 天窗内近似",
        ],
    }
    _CACHE["data"] = result
    _CACHE["ts"] = __import__("time").time()
    return result


def reset_cache() -> None:
    with _LOCK:
        _CACHE.clear()


__all__ = ["monitor", "reset_cache"]
