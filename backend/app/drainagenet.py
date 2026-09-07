# -*- coding: utf-8 -*-
"""Synthesised underground drainage network (SWMManywhere) + real drainage data.

Two complementary sources are combined here:

1. ``swmm_core_*`` — a drainage network *synthesised* with SWMManywhere 0.2.2
   (Imperial College London) for the Shenzhen core districts (福田 + 罗湖 +
   南山, three bboxes merged, ~70 921 nodes, ~68 357 conduits, diameter
   0.15–3.0 m, outfalls 2 564), driven by OSM streets, NASADEM 30 m elevation
   and OSM building footprints.  The per-bbox SWMM models are kept as
   ``*.inp`` files; the merged GeoJSON exports power the map layer.

   Provenance: ``synthetic`` — geometry/topology from OSM (ODbL), elevations
   from NASADEM (NASA), building density from OSM.  This is a *schematic*
   network: pipes follow streets, invert depths are derived from the DEM, not
   from as-built surveys.

2. ``*_preview.json`` / ``*.csv`` — *observed* Shenzhen open-data records:
   排涝泵站 (200), 盐田区污水井盖 (500 preview of 13 239), 罗湖区泵站
   technical register (100), 全市积水内涝点 (15), 排水管网运行管理单位 (11),
   宝安区雨水井盖 (10 000 rows).  The open platform strips coordinates, so
   these are mapped to district centroids (or reported as counts/text) rather
   than exact locations; the only real points with geometry are the 520 OSM
   manholes (`man_made=manhole`).

Provenance for the map layer is therefore a mix of ``synthetic`` (SWMM model)
and ``observed-derived`` (OSM manholes / open-data registers).
"""
from __future__ import annotations

import csv
import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "real_drainage"

NETWORK_FILE = DATA_DIR / "swmm_core_edges.geojson"
NODES_FILE = DATA_DIR / "swmm_core_nodes.geojson"
SUBS_FILE = DATA_DIR / "swmm_core_subcatchments.geojson"
MODEL_INP = DATA_DIR / "swmm_futian_model.inp"
OSM_MANHOLES_FILE = DATA_DIR / "osm_shenzhen_manholes.geojson"
PUMP_STATIONS_FILE = DATA_DIR / "pump_stations_sz.json"
WATERLOGGING_FILE = DATA_DIR / "sz_waterlogging_points_preview.json"
OPERATORS_FILE = DATA_DIR / "drainage_operators_preview.json"
LUOHU_PUMPS_FILE = DATA_DIR / "luohu_pump_stations_preview.json"
YANTIAN_MANHOLES_FILE = DATA_DIR / "yantian_sewage_manholes_preview.json"
BAOAN_MANHOLES_FILE = DATA_DIR / "baoan_rain_manholes.csv"

# Combined model extent (福田 + 罗湖 + 南山 = 关内核心区):
# [lon_min, lat_min, lon_max, lat_max]
MODEL_BBOX = [113.88, 22.47, 114.18, 22.57]

# District centroids, aligned with shenzhen.DISTRICTS (for attribute-only data).
DISTRICT_CENTERS: Dict[str, Tuple[float, float]] = {
    "福田区": (22.538, 114.058),
    "罗湖区": (22.555, 114.135),
    "南山区": (22.530, 113.930),
    "宝安区": (22.555, 113.880),
    "龙岗区": (22.720, 114.210),
    "盐田区": (22.560, 114.230),
    "龙华区": (22.680, 114.040),
    "坪山区": (22.690, 114.330),
    "光明区": (22.750, 113.950),
    "大鹏新区": (22.610, 114.500),
}

_LOCK = threading.RLock()
_CACHE: Dict[str, Any] = {}


def _load(fname: Path) -> Any:
    """Thread-safe JSON cache."""
    with _LOCK:
        if fname not in _CACHE:
            _CACHE[fname] = json.loads(fname.read_text(encoding="utf-8"))
        return _CACHE[fname]


def _district_center(district_name: Optional[str]) -> Optional[List[float]]:
    """Map an open-data district label (可能缺「区」字) to a centroid [lon, lat]."""
    if not district_name:
        return None
    name = str(district_name).strip()
    for full, center in DISTRICT_CENTERS.items():
        short = full.replace("区", "").replace("新区", "")
        if name == full or name == short or name in full:
            return [center[1], center[0]]
    return None


def _thin(features: List[Dict[str, Any]], max_features: int) -> List[Dict[str, Any]]:
    if len(features) <= max_features:
        return features
    step = len(features) / max_features
    return [features[int(i * step)] for i in range(max_features)]


def _decimate_line(coords: List[List[float]], max_points: int = 24) -> List[List[float]]:
    """Keep at most max_points vertices per polyline (visual simplification)."""
    if len(coords) <= max_points:
        return coords
    step = (len(coords) - 1) / (max_points - 1)
    return [coords[int(i * step)] for i in range(max_points)]


# --------------------------------------------------------------------------
# Map layers
# --------------------------------------------------------------------------

def map_network(max_features: int = 2000, min_diameter_m: float = 0.0) -> Dict[str, Any]:
    """SWMM-synthesised conduits as a GeoJSON layer.

    ``min_diameter_m > 0`` filters to trunk/larger pipes (e.g. >= 0.3 m for the
    "干管" view); otherwise the full network is thinned uniformly to
    ``max_features`` for payload size.
    """
    fc = _load(NETWORK_FILE)
    feats = [
        f
        for f in fc["features"]
        if f["properties"]["diameter_m"] >= min_diameter_m
    ]
    feats = _thin(feats, max_features)
    for f in feats:
        f["geometry"]["coordinates"] = _decimate_line(f["geometry"]["coordinates"])
    return {
        "type": "FeatureCollection",
        "features": feats,
        "metadata": {
            "model": "swmmanywhere 0.2.2 (synthetic)",
            "bbox": MODEL_BBOX,
            "total_pipes": len(_load(NETWORK_FILE)["features"]),
            "shown": len(feats),
            "filter_min_diameter_m": min_diameter_m,
        },
    }


def map_nodes(max_features: int = 3000, outfalls_only: bool = False) -> Dict[str, Any]:
    """Junction/storage + outfall nodes as a GeoJSON layer."""
    fc = _load(NODES_FILE)
    feats = fc["features"]
    if outfalls_only:
        feats = [f for f in feats if f["properties"]["outfall"]]
    return {
        "type": "FeatureCollection",
        "features": _thin(feats, max_features),
        "metadata": {
            "model": "swmmanywhere 0.2.2 (synthetic)",
            "bbox": MODEL_BBOX,
            "total_nodes": len(fc["features"]),
            "shown": len(feats) if not outfalls_only else min(len(feats), max_features),
            "outfalls_only": outfalls_only,
        },
    }


def map_subcatchments(max_features: int = 1200) -> Dict[str, Any]:
    """Top-N subcatchment polygons (by area) as a GeoJSON layer."""
    fc = _load(SUBS_FILE)
    feats = fc["features"]
    return {
        "type": "FeatureCollection",
        "features": _thin(feats, max_features),
        "metadata": {
            "model": "swmmanywhere 0.2.2 (synthetic)",
            "bbox": MODEL_BBOX,
            "total_subcatchments": len(feats),
            "shown": min(len(feats), max_features),
        },
    }


def map_points() -> Dict[str, Any]:
    """Observed drainage points: OSM manholes (geometry) + district-level registers.

    Open-platform registers expose no coordinates; district-level records are
    placed at district centroids and flagged ``approximate: true``.
    """
    points: List[Dict[str, Any]] = []

    # 1) OSM manholes — real geometry
    manholes = _load(OSM_MANHOLES_FILE)["features"]
    for f in manholes:
        p = f["properties"]
        points.append(
            {
                "type": "Feature",
                "properties": {
                    "source": "osm",
                    "category": "check_well",
                    "name": "检查井",
                    "detail": p.get("tags", {}).get("manhole", "manhole"),
                    "approximate": False,
                },
                "geometry": f["geometry"],
            }
        )

    # 2) 排涝泵站 (200, district-level)
    for rec in _load(PUMP_STATIONS_FILE):
        center = _district_center(rec.get("SZXZQ"))
        if not center:
            continue
        points.append(
            {
                "type": "Feature",
                "properties": {
                    "source": "opendata.sz.gov.cn",
                    "category": "pump_station",
                    "name": rec.get("PLBZMC") or "排涝泵站",
                    "district": rec.get("SZXZQ"),
                    "approximate": True,
                },
                "geometry": {"type": "Point", "coordinates": center},
            }
        )

    # 3) 积水内涝点 (15, district-level)
    for rec in _load(WATERLOGGING_FILE):
        center = _district_center(rec.get("SZQ"))
        if not center:
            continue
        points.append(
            {
                "type": "Feature",
                "properties": {
                    "source": "opendata.sz.gov.cn",
                    "category": "waterlogging",
                    "name": rec.get("NLDMC") or rec.get("WZ") or "积水内涝点",
                    "district": rec.get("SZQ"),
                    "approximate": True,
                },
                "geometry": {"type": "Point", "coordinates": center},
            }
        )

    # 4) 排水管网运行管理单位 (11, region-level)
    for rec in _load(OPERATORS_FILE):
        center = _district_center(str(rec.get("XZQY") or "") + "区")
        if not center:
            center = _district_center(rec.get("XZQY"))
        if not center:
            continue
        points.append(
            {
                "type": "Feature",
                "properties": {
                    "source": "opendata.sz.gov.cn",
                    "category": "operator",
                    "name": rec.get("CSPSYXGLDW") or "排水运营单位",
                    "district": rec.get("XZQY"),
                    "phone": rec.get("BXBZDH"),
                    "approximate": True,
                },
                "geometry": {"type": "Point", "coordinates": center},
            }
        )

    return {
        "type": "FeatureCollection",
        "features": points,
        "metadata": {
            "note": "开放平台数据不含坐标，区级记录按区中心近似落点 (approximate)；OSM 检查井为真实坐标。",
            "counts": {
                "osm_manholes": len(manholes),
                "pump_stations": sum(
                    1 for f in points if f["properties"]["category"] == "pump_station"
                ),
                "waterlogging": sum(
                    1 for f in points if f["properties"]["category"] == "waterlogging"
                ),
                "operators": sum(
                    1 for f in points if f["properties"]["category"] == "operator"
                ),
            },
        },
    }


# --------------------------------------------------------------------------
# Statistics / registers
# --------------------------------------------------------------------------

def stats() -> Dict[str, Any]:
    """Model + real-data summary (no heavy payloads)."""
    edges = _load(NETWORK_FILE)["features"]
    nodes = _load(NODES_FILE)["features"]
    subs = _load(SUBS_FILE)["features"]

    lengths = [f["properties"]["length_m"] for f in edges]
    diams = [f["properties"]["diameter_m"] for f in edges]
    total_km = sum(lengths) / 1000.0
    diams_sorted = sorted(diams)
    median_d = diams_sorted[len(diams_sorted) // 2]

    # Real-data register counts
    yantian = _load(YANTIAN_MANHOLES_FILE)
    baoan_rows = _csv_row_count(BAOAN_MANHOLES_FILE)
    luohu = _load(LUOHU_PUMPS_FILE)
    operators = _load(OPERATORS_FILE)
    waterlogging = _load(WATERLOGGING_FILE)
    pumps = _load(PUMP_STATIONS_FILE)

    return {
        "synthetic_model": {
            "engine": "SWMManywhere 0.2.2 (Imperial College London)",
            "bbox": MODEL_BBOX,
            "bbox_label": "关内核心区（福田 + 罗湖 + 南山，3 个分块合成）",
            "pipes": len(edges),
            "nodes": len(nodes),
            "outfalls": sum(1 for f in nodes if f["properties"].get("outfall")),
            "subcatchments": 9383 + 15491 + 31079,  # 各分块模型真实子汇水区总数
            "total_length_km": round(total_km, 1),
            "diameter_m": {"min": min(diams), "median": round(median_d, 2), "max": max(diams)},
            "inputs": ["OSM 路网", "NASADEM 30m 高程", "OSM 建筑轮廓"],
            "run_model": False,
            "note": "示意性管网：沿道路布管、由 DEM 推断埋深，非竣工实测；管径 0.15–3.0 m。",
        },
        "real_data": {
            "pump_stations_total": len(pumps),
            "pump_stations_districts": sorted({p.get("SZXZQ") for p in pumps if p.get("SZXZQ")}),
            "yantian_sewage_manholes_total": 13239,
            "yantian_sewage_manholes_preview": len(yantian),
            "baoan_rain_manholes_rows": baoan_rows,
            "luohu_pump_register_rows": len(luohu),
            "drainage_operators": len(operators),
            "waterlogging_points": len(waterlogging),
            "osm_manholes_with_geometry": 520,
            "note": "开放平台(opendata.sz.gov.cn)数据不含坐标；井盖/泵站为属性台账。",
        },
    }


def registers() -> Dict[str, Any]:
    """Small attribute-only registers (bounded lengths) for the info panels."""
    return {
        "pump_stations": [
            {
                "name": p.get("PLBZMC"),
                "district": p.get("SZXZQ"),
                "sequence": p.get("XH"),
            }
            for p in _load(PUMP_STATIONS_FILE)[:100]
        ],
        "waterlogging_points": [
            {"name": p.get("NLDMC") or p.get("WZ"), "district": p.get("SZQ")}
            for p in _load(WATERLOGGING_FILE)
        ],
        "operators": [
            {
                "name": p.get("CSPSYXGLDW"),
                "region": p.get("XZQY"),
                "phone": p.get("BXBZDH"),
            }
            for p in _load(OPERATORS_FILE)
        ],
        "yantian_manhole_positions": [
            {"name": p.get("OBJNAME"), "position": p.get("OBJPOS"), "code": p.get("OBJCODE")}
            for p in _load(YANTIAN_MANHOLES_FILE)[:100]
        ],
    }


def _csv_row_count(path: Path) -> int:
    with _LOCK:
        if path not in _CACHE:
            with open(path, encoding="utf-8-sig", errors="replace") as f:
                reader = csv.reader(f)
                next(reader, None)
                _CACHE[path] = sum(1 for _ in reader)
        return _CACHE[path]
