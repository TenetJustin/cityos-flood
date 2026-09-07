# -*- coding: utf-8 -*-
"""Drainage asset layer: pump stations and rain-asset density.

Serves two project-local, openly licensed datasets onto the map and into the
district feature records:

1. **Pump stations** (78 city-wide).  Names come from the Shenzhen Water
   Authority open-data statistics table (dataset 29200_01403213, unconditional);
   coordinates were geocoded once via the Tianditu API (key in ``.env``) and
   cached in ``data/pipes/processed/pump_stations_geo.json``.  The geocoding is
   approximate (pump stations are not POIs; scores vary) and is labelled as
   such in provenance.

2. **Bao'an rain-asset density** (manhole covers + gratings).  The raw open
   dataset (72,381 covers / 120k+ gratings) has no coordinates, only a 12-digit
   management grid code whose last 3 digits index a ~1km community grid.  We
   aggregate counts per grid code and report street-level and district-level
   densities as an *asset-density proxy*, not a hydraulic capacity.

No network access happens at import or request time.
"""
from __future__ import annotations

import csv
import json
import os
import re
import threading
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_BASE = Path(__file__).resolve().parent.parent / "data"
# 数据位置：优先环境变量 SZ_FLOOD_DATA_BASE，否则默认相对本仓库的
# shenzhen-flood/data/pipes/...（与代码内 /Users/imac 硬编码兼容）。
_SZ_FLOOD_DATA = Path(
    os.environ.get(
        "SZ_FLOOD_DATA_BASE",
        str(Path(__file__).resolve().parents[3] / "shenzhen-flood" / "data"),
    )
)
PUMP_GEO_FILE = Path(
    os.environ.get("PUMP_GEO_FILE", str(_SZ_FLOOD_DATA / "pipes/processed/pump_stations_geo.json"))
)
PUMP_NAMES_FILE = Path(
    os.environ.get("PUMP_NAMES_FILE", str(_SZ_FLOOD_DATA / "pipes/raw/sz_pump_stations.csv"))
)
BAOAN_MANHOLES_FILE = Path(
    os.environ.get("BAOAN_MANHOLES_FILE", str(_SZ_FLOOD_DATA / "pipes/raw/baoan_rain_manholes.csv"))
)
BAOAN_GRATINGS_FILE = Path(
    os.environ.get("BAOAN_GRATINGS_FILE", str(_SZ_FLOOD_DATA / "pipes/raw/baoan_rain_gratings.csv"))
)

DISTRICT_NAME_TO_ID = {
    "宝安区": "baoan", "光明区": "guangming", "龙岗区": "longgang",
    "罗湖区": "luohu", "南山区": "nanshan", "龙华区": "longhua",
    "坪山区": "pingshan", "盐田区": "yantian", "福田区": "futian",
    "大鹏新区": "dapeng", "宝安": "baoan", "光明": "guangming",
    "龙岗": "longgang", "罗湖": "luohu", "南山": "nanshan",
    "龙华": "longhua", "坪山": "pingshan", "盐田": "yantian",
    "福田": "futian", "大鹏": "dapeng",
}

_LOCK = threading.RLock()
_CACHE: Dict[str, Any] = {}


def _load_pump_stations() -> List[Dict[str, Any]]:
    with _LOCK:
        cached = _CACHE.get("pumps")
        if cached is not None:
            return cached
    stations: List[Dict[str, Any]] = []
    if PUMP_GEO_FILE.exists():
        try:
            raw = json.loads(PUMP_GEO_FILE.read_text(encoding="utf-8"))
            for item in raw:
                if item.get("lat") and item.get("lon"):
                    stations.append({
                        "name": str(item.get("name") or ""),
                        "district_id": DISTRICT_NAME_TO_ID.get(
                            str(item.get("district") or ""), ""
                        ),
                        "district_name": str(item.get("district") or ""),
                        "lat": float(item["lat"]),
                        "lon": float(item["lon"]),
                    })
        except (OSError, ValueError):
            stations = []
    with _LOCK:
        _CACHE["pumps"] = stations
    return stations


def _load_baoan_assets() -> Dict[str, Any]:
    with _LOCK:
        cached = _CACHE.get("baoan")
        if cached is not None:
            return cached

    street_counter: Counter = Counter()
    status_counter: Counter = Counter()
    grid_counter: Counter = Counter()
    total_rows = 0

    def ingest(path: Path, label: str) -> int:
        nonlocal total_rows
        if not path.exists():
            return 0
        count = 0
        with path.open(encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                total_rows += 1
                count += 1
                loc = row.get("位置描述", "") or ""
                m = re.search(r"宝安区(.+?街道)", loc)
                if m:
                    street_counter[m.group(1)] += 1
                status_counter[(label, row.get("状态", "") or "-")] += 1
                grid = (row.get("所在单元网格") or "").strip()
                if grid and grid != "-":
                    grid_counter[grid] += 1
        return count

    manholes = ingest(BAOAN_MANHOLES_FILE, "manhole")
    gratings = ingest(BAOAN_GRATINGS_FILE, "grating")

    result = {
        "sampled_manholes": manholes,
        "sampled_gratings": gratings,
        "total_sampled_rows": total_rows,
        "manhole_total_source": 72381,
        "street_counts": dict(street_counter.most_common()),
        "grid_counts": dict(grid_counter.most_common()),
        "status_counts": {
            f"{label}/{status}": count for (label, status), count in sorted(status_counter.items())
        },
        "note": (
            "开放平台单次下载上限 10 万行，当前为首批抽样；无经纬度，仅有单元网格编码"
        ),
    }
    with _LOCK:
        _CACHE["baoan"] = result
    return result


def pump_stations_layer(district_id: Optional[str] = None) -> Dict[str, Any]:
    stations = _load_pump_stations()
    if district_id:
        stations = [s for s in stations if s["district_id"] == district_id]
    by_district: Dict[str, int] = defaultdict(int)
    for station in stations:
        by_district[station["district_id"]] += 1
    return {
        "type": "pump_stations",
        "count": len(stations),
        "by_district": dict(sorted(by_district.items(), key=lambda kv: -kv[1])),
        "stations": stations,
        "provenance": (
            "observed-derived(深圳市水务局排涝泵站统计表 29200_01403213, 无条件开放; "
            "坐标为天地图地理编码近似值)"
        ),
    }


def baoan_asset_density() -> Dict[str, Any]:
    data = _load_baoan_assets()
    return {
        **data,
        "provenance": (
            "observed-derived(宝安区雨水井盖 29200_02803189 + 雨水箅子 29200_02803190, "
            "无条件开放; 首批抽样 2 万行, 无坐标仅单元网格编码)"
        ),
    }


def district_features(district_id: str) -> Dict[str, Any]:
    pumps = [s for s in _load_pump_stations() if s["district_id"] == district_id]
    return {
        "district_id": district_id,
        "pump_station_count": len(pumps),
        "pump_station_names": [s["name"] for s in pumps][:20],
        "provenance": (
            "observed-derived(pump statistics + tianditu geocode)"
            if pumps
            else "no pump station recorded in open dataset"
        ),
    }


def reset_cache() -> None:
    with _LOCK:
        _CACHE.clear()


__all__ = [
    "pump_stations_layer",
    "baoan_asset_density",
    "district_features",
    "reset_cache",
]
