# -*- coding: utf-8 -*-
"""Water-network (river / drain) features for the flood model and map layer.

Reads the project-local OSM water network (``shenzhen_water.geojson``) and
derives, without any network access:

1. district-level water-network statistics (total river length, drain length,
   density per km²) used to enrich the district records consumed by the
   conservative state model;
2. an optional bounded water proximity factor for grid/street downscaling --
   cells near a river/drain share the drainage corridor, but river-adjacent
   lowlands can also receive overbank or backwater water, so the factor stays
   inside the same bounded envelope as the existing GIS factors;
3. a simplified GeoJSON layer for the frontend map (rivers, drains, and major
   water bodies), with coordinate decimation to keep payloads small.

Provenance: observed-derived (OSM water layer, ODbL).  The network is a
geometry layer, not a hydraulic model: no cross-sections, no bankfull
discharge, no pipe topology.  ``river.py`` remains the hydraulic module.
"""
from __future__ import annotations

import json
import math
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DATA_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "real_gis" / "shenzhen_water.geojson"
)

# Kinds that participate in proximity/density statistics.  Ponds and basins are
# storage, not conduits, so they are excluded from the corridor factor.
CONDUIT_KINDS = {"river", "stream", "drain", "canal"}
WATER_BODY_KINDS = {"pond", "lake", "reservoir", "basin", "water", "reflecting_pool"}

# Shenzhen administrative bbox; used to clip conduit lengths so cross-border
# rivers (e.g. Shima River mostly in Dongguan) do not inflate district totals.
SZ_LAT0, SZ_LAT1 = 22.44, 22.88
SZ_LON0, SZ_LON1 = 113.72, 114.66

# Bounded corridor influence: 0 at or beyond MAX_PROXIMITY_KM from a conduit,
# rising to at most PROXIMITY_GAIN of extra depth weighting at distance 0.
MAX_PROXIMITY_KM = 1.5
PROXIMITY_GAIN = 0.18

_LOCK = threading.RLock()
_CACHE: Dict[str, Any] = {}


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[1]), math.radians(a[0])
    lat2, lon2 = math.radians(b[1]), math.radians(b[0])
    q = (
        math.sin((lat2 - lat1) / 2.0) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2.0) ** 2
    )
    return 6371.0088 * 2.0 * math.asin(min(1.0, math.sqrt(q)))


def _inside_sz(coord: Tuple[float, float]) -> bool:
    return SZ_LAT0 <= coord[1] <= SZ_LAT1 and SZ_LON0 <= coord[0] <= SZ_LON1


def _clipped_length_km(coords: List[List[float]]) -> float:
    """Length of the way restricted to segments inside the Shenzhen bbox."""
    total = 0.0
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        if _inside_sz(a) and _inside_sz(b):
            total += _haversine_km(a, b)
    return total


def _load_features() -> List[Dict[str, Any]]:
    with _LOCK:
        cached = _CACHE.get("features")
        if cached is not None:
            return cached
    features: List[Dict[str, Any]] = []
    try:
        raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        for feature in raw.get("features", []):
            geometry = feature.get("geometry") or {}
            coords = geometry.get("coordinates") or []
            if geometry.get("type") != "LineString" or len(coords) < 2:
                continue
            props = feature.get("properties") or {}
            kind = str(props.get("kind") or "water")
            length_km = _clipped_length_km(coords)
            if length_km <= 0.0:
                continue
            features.append({
                "kind": kind,
                "name": str(props.get("name") or "").strip(),
                "length_km": length_km,
                "coords": coords,
            })
    except (OSError, ValueError):
        features = []
    with _LOCK:
        _CACHE["features"] = features
    return features


def _conduits() -> List[Dict[str, Any]]:
    return [f for f in _load_features() if f["kind"] in CONDUIT_KINDS]


def _district_areas_km2() -> Dict[str, float]:
    # Mirror state_model.DEFAULT_AREA_KM2 without importing the model layer.
    from .state_model import DEFAULT_AREA_KM2

    return dict(DEFAULT_AREA_KM2)


def district_water_stats() -> Dict[str, Dict[str, Any]]:
    """Per-district conduit length, density, and nearest conduit distance.

    District assignment uses the district centroid nearest to the conduit's
    midpoint -- the same centroid heuristic the existing GIS layer uses, and
    honest about that limitation in provenance.
    """
    with _LOCK:
        cached = _CACHE.get("district_stats")
        if cached is not None:
            return cached

    from . import shenzhen

    districts = {d["id"]: d for d in shenzhen.DISTRICTS}
    areas = _district_areas_km2()
    totals: Dict[str, Dict[str, float]] = {
        did: {"river_km": 0.0, "drain_km": 0.0, "stream_km": 0.0, "canal_km": 0.0}
        for did in districts
    }
    centers = [(did, (d["center"][1], d["center"][0])) for did, d in districts.items()]
    for feature in _conduits():
        coords = feature["coords"]
        mid = coords[len(coords) // 2]
        did, _ = min(
            centers,
            key=lambda item: (item[1][1] - mid[1]) ** 2 + (item[1][0] - mid[0]) ** 2,
        )
        key = f"{feature['kind']}_km"
        totals[did][key] += feature["length_km"]

    out: Dict[str, Dict[str, Any]] = {}
    for did, values in totals.items():
        total_km = sum(values.values())
        area = areas.get(did, 100.0)
        center = districts[did]["center"]  # [lat, lon]
        nearest = min(
            (
                _haversine_km((center[1], center[0]), coord)
                for f in _conduits()
                for coord in f["coords"][:200:20]
            ),
            default=0.0,
        )
        out[did] = {
            "district_id": did,
            "river_km": round(values["river_km"], 2),
            "drain_km": round(values["drain_km"], 2),
            "stream_km": round(values["stream_km"], 2),
            "canal_km": round(values["canal_km"], 2),
            "total_conduit_km": round(total_km, 2),
            "density_km_per_km2": round(total_km / area, 3),
            "centroid_nearest_conduit_km": round(nearest, 3),
            "provenance": (
                "observed-derived(OSM water layer; conduit length attributed to the "
                "district whose centroid is nearest the conduit midpoint -- length "
                "is the OSM way length inside the Shenzhen bbox, not a per-district "
                "clipping)"
            ),
        }
    return out
    with _LOCK:
        _CACHE["district_stats"] = out
    return out


def nearest_conduit_km(lat: float, lon: float) -> Optional[float]:
    """Distance in km from a point to the nearest river/stream/drain vertex."""
    conduits = _conduits()
    if not conduits:
        return None
    point = (lon, lat)
    best = math.inf
    for feature in conduits:
        coords = feature["coords"]
        step = max(1, len(coords) // 40)  # decimated for speed, ~sub-100m error
        for coord in coords[::step]:
            d = _haversine_km(point, coord)
            if d < best:
                best = d
    return 0.0 if not math.isfinite(best) else best


def corridor_factor(lat: float, lon: float) -> float:
    """Bounded 0..PROXIMITY_GAIN multiplier for water-corridor exposure.

    Used by the grid downscaling layer: near a drainage corridor the
    representative depth is nudged up by up to 18%, decaying to zero beyond
    1.5 km.  This is a proxy from geometry only -- it is not an overbank
    hydraulics calculation.
    """
    distance = nearest_conduit_km(lat, lon)
    if distance is None:
        return 0.0
    if distance >= MAX_PROXIMITY_KM:
        return 0.0
    t = 1.0 - distance / MAX_PROXIMITY_KM
    return round(PROXIMITY_GAIN * t * t, 4)


def _decimate(coords: List[List[float]], max_points: int = 40) -> List[List[float]]:
    if len(coords) <= max_points:
        return coords
    step = (len(coords) - 1) / (max_points - 1)
    return [coords[round(i * step)] for i in range(max_points)]


def map_layer(
    kinds: Optional[List[str]] = None,
    min_length_km: float = 0.0,
    max_features: int = 2500,
) -> Dict[str, Any]:
    """Simplified GeoJSON FeatureCollection for frontend rendering."""
    selected = set(kinds) if kinds else (CONDUIT_KINDS | WATER_BODY_KINDS)
    features = _load_features()
    lines = [
        f for f in features
        if f["kind"] in selected and f["length_km"] >= min_length_km
    ]
    lines.sort(key=lambda f: -f["length_km"])
    kept = lines[:max_features]
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "kind": f["kind"],
                    "name": f["name"],
                    "length_km": round(f["length_km"], 2),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": _decimate(f["coords"]),
                },
            }
            for f in kept
        ],
        "meta": {
            "total_source_features": len(features),
            "returned_features": len(kept),
            "kinds": sorted(selected),
            "min_length_km": min_length_km,
            "provenance": "observed-derived(OSM water layer, ODbL; geometry decimated)",
        },
    }


def reset_cache() -> None:
    with _LOCK:
        _CACHE.clear()


__all__ = [
    "CONDUIT_KINDS",
    "WATER_BODY_KINDS",
    "MAX_PROXIMITY_KM",
    "PROXIMITY_GAIN",
    "district_water_stats",
    "nearest_conduit_km",
    "corridor_factor",
    "map_layer",
    "reset_cache",
]
