# -*- coding: utf-8 -*-
"""Human Impact Engine — population spatial base.

Builds the shared resident grid used by every hazard adapter:

- **night population** per grid cell: aggregated from the GHS-POP E2020
  R2023A 100 m raster (observed open data, ~16.97 M people in the
  Shenzhen window 22.4–22.9°N / 113.7–114.6°E).
- **day population**: cohorts re-distributed to their daytime anchors
  (office/commercial/school cells) using OSM building-type counts.
- **cohorts**: office_worker / student / elderly / resident / visitor /
  public_service_worker with district-level share adjustments.
- **vulnerability**: built on the project's existing district_vulnerability
  base plus elderly share / isolation / low-elevation corrections.
- **facility base**: real OSM hospital & school building points; shelter /
  transport hubs are derived from schools + district centres (assumed
  components labelled in provenance).

Grid convention reuses ``gridrisk`` (0.018° cells over the same box), so the
population layer snaps onto the existing hazard grids without a new spatial
system.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from . import gisreal, gridrisk, risk, shenzhen
from .data_paths import EXTERNAL_DATA, require_external
from .human_config import (
    BUILDING_CLASSES,
    COHORTS,
    COHORT_SHARE_BASELINE,
    DAY_SEGMENTS,
    DISTRICT_COHORT_ADJ,
    GRID_RES,
    VULN_WEIGHTS,
)

_SZ_FLOOD_DATA = EXTERNAL_DATA
POP_CSV = _SZ_FLOOD_DATA / "unified" / "population_grid_100m.csv"
BUILDING_CSV = _SZ_FLOOD_DATA / "unified" / "building_point.csv"

_LOCK = threading.RLock()
_CACHE: Dict[str, Any] = {}

# District elderly share (60+) — assumed until real per-district census rates
# are wired in (provenance: assumed).
DISTRICT_ELDERLY_RATIO = {   # assumed (approx shares)
    "futian": 0.07, "luohu": 0.09, "nanshan": 0.065, "baoan": 0.055,
    "longgang": 0.06, "yantian": 0.09, "longhua": 0.05, "pingshan": 0.05,
    "guangming": 0.045, "dapeng": 0.11,
}
DISTRICT_NAMES = {d["id"]: d["name"] for d in shenzhen.DISTRICTS}


def _grid_coords(res: float = GRID_RES):
    """Cell centres identical to gridrisk's grid."""
    lats = np.arange(gridrisk.LAT0, gridrisk.LAT1, res) + res / 2.0
    lons = np.arange(gridrisk.LON0, gridrisk.LON1, res) + res / 2.0
    return lats, lons


def _bin_population(res: float = GRID_RES) -> np.ndarray:
    """Aggregate GHS 100 m population into the grid; returns (n_rows, n_cols)."""
    key = f"popmat_{res}"
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
    df = pd.read_csv(require_external("unified", "population_grid_100m.csv"),
                     usecols=["lon", "lat", "population"])
    nlat = int(round((gridrisk.LAT1 - gridrisk.LAT0) / res))
    nlon = int(round((gridrisk.LON1 - gridrisk.LON0) / res))
    i = np.clip(((df["lat"].values - gridrisk.LAT0) / res).astype(int), 0, nlat - 1)
    j = np.clip(((df["lon"].values - gridrisk.LON0) / res).astype(int), 0, nlon - 1)
    mat = np.zeros((nlat, nlon), dtype=np.float64)
    np.add.at(mat, (i, j), df["population"].values)
    with _LOCK:
        _CACHE[key] = mat
    return mat


def _bin_buildings(res: float = GRID_RES) -> Dict[str, np.ndarray]:
    """Count building-type groups per cell."""
    key = f"bld_{res}"
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
    df = pd.read_csv(require_external("unified", "building_point.csv"),
                     usecols=["building_type", "lon", "lat"])
    df = df.dropna(subset=["lon", "lat"])
    nlat = int(round((gridrisk.LAT1 - gridrisk.LAT0) / res))
    nlon = int(round((gridrisk.LON1 - gridrisk.LON0) / res))
    i = np.clip(((df["lat"].values - gridrisk.LAT0) / res).astype(int), 0, nlat - 1)
    j = np.clip(((df["lon"].values - gridrisk.LON0) / res).astype(int), 0, nlon - 1)
    out: Dict[str, np.ndarray] = {}
    for group, types in BUILDING_CLASSES.items():
        mask = df["building_type"].isin(types).values
        if not mask.any():
            out[group] = np.zeros((nlat, nlon))
            continue
        m = np.zeros((nlat, nlon))
        np.add.at(m, (i[mask], j[mask]), 1.0)
        out[group] = m
    with _LOCK:
        _CACHE[key] = out
    return out


def _cohort_shares_per_district() -> Dict[str, Dict[str, float]]:
    shares = {}
    for d in shenzhen.DISTRICTS:
        did = d["id"]
        s = dict(COHORT_SHARE_BASELINE)
        adj = DISTRICT_COHORT_ADJ.get(did, {})
        for cohort, mult in adj.items():
            s[cohort] *= mult
        # elderly share from assumed ratio table
        s["elderly"] = DISTRICT_ELDERLY_RATIO.get(did, 0.06)
        tot = sum(s.values())
        for c in COHORTS:
            s[c] /= tot
        shares[did] = s
    return shares


def _daytime_anchor_weights(bld: Dict[str, np.ndarray], district_id: np.ndarray,
                            res: float) -> Dict[str, np.ndarray]:
    """Per cohort daytime cell weights (population re-distribution weights).

    Weights are soft-saturated (``w/(1+w/sat)``) so no single cell can
    concentrate an unrealistic daytime crowd; global mass stays conserved.
    """
    from .human_config import DAYTIME_SATURATION
    sat = DAYTIME_SATURATION["soft_saturation"]
    comm = bld["commercial"] + bld["office"] + 1e-6
    resi = bld["residential"] + bld["industrial"] * 0.3 + 1e-6  # industry holds day residents
    school = bld["school"] + bld["commercial"] * 0.05 + 1e-6
    service = bld["service"] + bld["commercial"] + 1e-6
    center_bias = np.exp(-0.35 * (district_id / 9.0))  # downtown-lighter, mild

    def saturate(w: np.ndarray) -> np.ndarray:
        return w / (1.0 + w / sat)

    return {
        "office_worker": saturate(comm),
        "student": saturate(school),
        "elderly": saturate(resi),
        "resident": saturate(resi + 0.25 * comm),
        "visitor": saturate(comm * (1.0 + center_bias)),
        "public_service_worker": saturate(service),
    }


def population_grid(res: float = GRID_RES, with_day: bool = True) -> Dict[str, Any]:
    """The shared resident grid (per-cell base populations + cohorts)."""
    cache_key = f"pgrid_{res}_{with_day}"
    with _LOCK:
        if cache_key in _CACHE:
            return _CACHE[cache_key]

    pop_mat = _bin_population(res)
    bld = _bin_buildings(res)
    lats, lons = _grid_coords(res)
    nlat, nlon = pop_mat.shape
    district_id = np.zeros((nlat, nlon), dtype=int)
    centroids = gisreal._district_centroids()
    did_of = [d["id"] for d in shenzhen.DISTRICTS]
    for ii in range(nlat):
        for jj in range(nlon):
            if pop_mat[ii, jj] > 0:
                district_id[ii, jj] = did_of.index(
                    gisreal._nearest_did(centroids, lats[ii], lons[jj])
                )

    shares = _cohort_shares_per_district()
    # night population split into cohorts per district
    night = pop_mat.copy()
    cohort_night = {c: np.zeros_like(pop_mat) for c in COHORTS}
    for did_idx, did in enumerate(did_of):
        mask = district_id == did_idx
        for c in COHORTS:
            cohort_night[c][mask] = night[mask] * shares[did][c]
    night_total = {c: float(cohort_night[c].sum()) for c in COHORTS}

    # day population: redistribute cohorts to anchors (mass conserving).
    # Cells with NO building-type coverage (OSM gaps / rural edge) keep their
    # night population in place; only anchored cells participate in the
    # daytime re-distribution — total population still conserved.
    anchors = _daytime_anchor_weights(bld, district_id, res)
    building_total = sum(bld[g] for g in bld)
    keep_mask = (pop_mat <= 0) | (building_total <= 0)
    day = np.zeros_like(pop_mat)
    cohort_day = {c: np.zeros_like(pop_mat) for c in COHORTS}
    for c in COHORTS:
        w = anchors[c].copy()
        w[keep_mask] = 0.0            # nobody redistributes into kept cells
        wsum = w.sum()
        mobile = night_total[c] - float(cohort_night[c][keep_mask].sum())
        if wsum > 0 and mobile > 0:
            cohort_day[c] = w / wsum * mobile
        # kept cells keep their night cohort in place
        cohort_day[c][keep_mask] = cohort_night[c][keep_mask]
        day += cohort_day[c]
    day_total = float(day.sum())

    # district vulnerability base per cell (derived from existing model)
    vuln_base = np.zeros((nlat, nlon))
    for did_idx, did in enumerate(did_of):
        mask = district_id == did_idx
        d = shenzhen.get_district(did)
        base, _ = risk.district_vulnerability(d)
        vuln_base[mask] = base

    # per-cell elderly share for vulnerability correction
    e = cohort_night["elderly"] / np.maximum(night, 1e-6)
    dens = night / (res * 111.0) ** 2  # pop per km2 (rough)
    max_dens = float(dens.max()) if dens.max() > 0 else 1.0
    # district mean elevation per cell (sigmoid low-elevation correction)
    elev_mean = np.zeros((nlat, nlon))
    for did_idx, did in enumerate(did_of):
        mask = district_id == did_idx
        elev_mean[mask] = shenzhen.get_district(did).get("elevation_mean", 30.0)

    cells = []
    for ii in range(nlat):
        for jj in range(nlon):
            if pop_mat[ii, jj] <= 0:
                continue
            did = did_of[district_id[ii, jj]]
            eld = float(e[ii, jj])
            # vulnerability: district base + elderly + isolation + low elevation
            low_elev = 1.0 / (1.0 + np.exp((elev_mean[ii, jj] - 40.0) / 25.0))
            vuln = (
                VULN_WEIGHTS["district_base"] * float(vuln_base[ii, jj])
                + VULN_WEIGHTS["elderly_share"] * min(1.0, eld * 6.0)
                + VULN_WEIGHTS["isolation"] * (1.0 - min(1.0, dens[ii, jj] / max_dens))
                + VULN_WEIGHTS["low_elevation"] * float(low_elev)
            )
            vuln = float(np.clip(vuln, 0.0, 1.0))
            coh_night = {c: round(float(cohort_night[c][ii, jj]), 0) for c in COHORTS}
            coh_day = {c: round(float(cohort_day[c][ii, jj]), 0) for c in COHORTS}
            cells.append({
                "grid_id": ii * nlon + jj,
                "lat": round(float(lats[ii]), 4),
                "lon": round(float(lons[jj]), 4),
                "row": ii, "col": jj,
                "district_id": did,
                "district": DISTRICT_NAMES.get(did, did),
                "night_population": round(float(night[ii, jj]), 0),
                "day_population": round(float(day[ii, jj]), 0),
                "population_density_km2": round(float(dens[ii, jj]), 0),
                "vulnerability_score": round(vuln, 3),
                "elderly_share": round(eld, 3),
                "cohort_night": coh_night,
                "cohort_day": coh_day,
                "building_counts": {
                    g: int(bld[g][ii, jj]) for g in bld
                },
                "landuse_dominant": max(
                    (g for g in bld), key=lambda g: bld[g][ii, jj],
                ) if max(bld[g][ii, jj] for g in bld) > 0 else "none",
            })
    cells.sort(key=lambda c: c["grid_id"])
    result = {
        "resolution_deg": res,
        "n_cells": len(cells),
        "n_rows": nlat, "n_cols": nlon,
        "night_total": round(float(night.sum()), 0),
        "day_total": round(day_total, 0),
        "cohort_day_total": {c: round(night_total[c], 0) for c in COHORTS},
        "cells": cells,
        "provenance": {
            "population": "observed-derived(GHS-POP E2020 R2023A 100m 栅格聚合至 "
                          f"{res}°网格; 窗口总人口≈{night.sum()/1e6:.2f}M)",
            "day_night": "derived(cohort 重分布; 全城质量守恒; 见 human_config.PROVENANCE)",
            "cohorts": "assumed(基线比例 + 区级相对调整)",
            "vulnerability": "derived(district_vulnerability 底座) + assumed(权重)",
            "district_assignment": "derived(最近区中心近似, 与 gridrisk 一致; "
                                   "区界 geojson 碎片不可用; 边缘区总量可能偏差)",
            "facility_base": "observed(OSM 医院/学校建筑) + assumed(避难/枢纽派生)",
        },
    }
    with _LOCK:
        _CACHE[cache_key] = result
    return result


# ============================================================================
# Facilities base (OSM hospitals & schools are real; shelter/hub are derived)
# ============================================================================
def _facility_points() -> Dict[str, List[Dict[str, float]]]:
    with _LOCK:
        if "facility_points" in _CACHE:
            return _CACHE["facility_points"]
    df = pd.read_csv(require_external("unified", "building_point.csv"),
                     usecols=["building_type", "lon", "lat"])
    df = df.dropna(subset=["lon", "lat"])
    out = {
        "hospital": [],
        "school": [],
        "office": [],
        "commercial": [],
        "residential": [],
    }
    for _, r in df.iterrows():
        bt = r["building_type"]
        pt = {"lon": float(r["lon"]), "lat": float(r["lat"])}
        if bt == "hospital":
            out["hospital"].append(pt)
        elif bt in BUILDING_CLASSES["school"]:
            out["school"].append(pt)
        elif bt in BUILDING_CLASSES["office"]:
            out["office"].append(pt)
        elif bt in BUILDING_CLASSES["commercial"]:
            out["commercial"].append(pt)
    with _LOCK:
        _CACHE["facility_points"] = out
    return out


def facilities(district_proxy: bool = True) -> Dict[str, Any]:
    """Facility base per district: real OSM counts + representative points.

    hospital/school: observed OSM building points.
    shelter: derived — school sites commonly double as emergency shelters;
             additionally a district-centre proxy per district (assumed).
    transport hub: assumed district centre (no metro dataset in project).
    """
    pts = _facility_points()
    centroids = gisreal._district_centroids()
    districts = []
    for d in shenzhen.DISTRICTS:
        did = d["id"]
        cx, cy = d["center"][1], d["center"][0]  # lon, lat
        hosp = [p for p in pts["hospital"] if gisreal._nearest_did(centroids, p["lat"], p["lon"]) == did]
        sch = [p for p in pts["school"] if gisreal._nearest_did(centroids, p["lat"], p["lon"]) == did]
        def nearest(points, n=1):
            if not points:
                return []
            points = sorted(points, key=lambda p: ((p["lat"] - d["center"][0]) ** 2
                                                   + (p["lon"] - d["center"][1]) ** 2))
            return points[:n]
        districts.append({
            "district_id": did,
            "district": d["name"],
            "hospital_count": len(hosp),
            "school_count": len(sch),
            "hospitals": nearest(hosp, 2),
            "schools": nearest(sch, 2),
            "shelter_points": nearest(sch, 2) + [{"lat": d["center"][0], "lon": d["center"][1]}],
            "transport_hub": {"lat": d["center"][0], "lon": d["center"][1]},
            "center": d["center"],
            "provenance": {
                "hospital": "observed(OSM building hospital)",
                "school": "observed(OSM building school/university/kindergarten)",
                "shelter": "derived-observed(学校点位复用) + assumed(区中心备用点)",
                "transport_hub": "assumed(区中心, 项目无地铁点位数据)",
            },
        })
    return {
        "count": len(districts),
        "districts": districts,
        "city": {
            "hospital_total": sum(d["hospital_count"] for d in districts),
            "school_total": sum(d["school_count"] for d in districts),
        },
        "provenance": "observed(OSM building_point.csv) + derived + assumed(见 human_config)",
    }


def day_segment(hour: int) -> str:
    """Map hour (0-23) to the population day segment."""
    if 6 <= hour < 9:
        return "morning_commute"
    if 9 <= hour < 17:
        return "daytime"
    if 17 <= hour < 20:
        return "evening_commute"
    return "nighttime"


def cell_population_at(cells: List[Dict[str, Any]], hour: int) -> Dict[int, float]:
    """Effective resident population per cell at hour, using day/night weights.

    Commute windows blend day & night (half in-transit reduction proxy).
    """
    seg = day_segment(hour)
    out = {}
    for cell in cells:
        n = cell["night_population"]
        d = cell["day_population"]
        if seg == "nighttime":
            v = n
        elif seg == "daytime":
            v = d
        else:  # commute windows: average of the two states
            v = 0.5 * (n + d)
        out[cell["grid_id"]] = v
    return out


def reset_cache() -> None:
    with _LOCK:
        _CACHE.clear()


__all__ = ["population_grid", "facilities", "day_segment", "cell_population_at",
           "reset_cache"]
