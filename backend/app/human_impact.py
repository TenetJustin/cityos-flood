# -*- coding: utf-8 -*-
"""Human Impact Engine — orchestrates the whole people layer.

Pipeline per hazard at a given hour:

    Hazard state (from existing project modules: live_ops / state_model /
    climate_hazards / earthquake / reservoir_ops / multihazard)
        → Hazard Adapter (per-hazard impact mechanism)
        → Behavior Model (rule+probabilistic action census)
        → Cascade (traffic / medical / shelter feedback)
        → Unified Human Impact Score (explainable 6-way breakdown)
        → Recovery (per-system restore, bottleneck = cell recovery)

Exposes the four core metrics for every hazard:
affected_population / mobility_disrupted_population /
critical_service_loss_population / estimated_recovery_time.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import (behavior_model, cascade_model, climate_hazards, earthquake as eq,
               hazard_adapters, live_ops, multihazard, population_base,
               recovery_model, reservoir_ops)
from .human_config import HAZARD_END_HOURS, SCORE_WEIGHTS

# Hazard durations (h after T0 when the hazard physically ends; assumed)
_HAZARD_END = dict(HAZARD_END_HOURS)

TIMELINE_HOURS = (0, 1, 3, 6, 12, 24)

_LOCK = threading.RLock()
_CACHE: Dict[str, Any] = {}
_TTL = 300.0

# ============================================================================
# Hazard state builders — read existing project modules (never fake data)
# ============================================================================
def _now_hour() -> int:
    return datetime.now(timezone.utc).astimezone().hour


def _hazard_state_pluvial(hour_offset: int, scenario: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Rain-driven depth.  Prefer the live conservative-model state; when the
    user supplies ``rain_48h_mm`` (synthetic scenario for drill/demo), build a
    triangular hydrograph (onset→peak→recede, estimated shape) scaled to the
    given 48 h rainfall — clearly labelled synthetic."""
    synthetic = scenario and scenario.get("rain_48h_mm") is not None
    if not synthetic:
        live = live_ops.build_live()
        depth_by_district: Dict[str, float] = {}
        src = "live_ops(state_model 守恒模型, mm→m)"
        if live.get("flood_by_district"):
            for did, series in live["flood_by_district"].items():
                idx = min(hour_offset, max(0, len(series) - 1))
                depth_by_district[did] = float(series[idx] or 0.0) / 1000.0
        if depth_by_district:
            return {"depth_by_district": depth_by_district, "source": src}
    # synthetic hydrograph or fall back to simulate
    if synthetic:
        rain = float(scenario["rain_48h_mm"])
        from . import shenzhen
        depth: Dict[str, float] = {}
        for d in shenzhen.DISTRICTS:
            # synthetic storm peak depth driven by 48 h total (mm) and local
            # low-lying share — approximate stand-in for short-duration
            # intensity (estimated, demo/drill only)
            peak = min(0.85, (rain / 200.0) ** 1.2 * (0.12 + 0.4 * float(d.get("low_lying_ratio", 0.3))))
            # triangular: rise to peak at ~6h, recede by ~18h
            if hour_offset <= 6:
                fac = 0.15 + 0.85 * (hour_offset / 6.0)
            elif hour_offset <= 18:
                fac = 1.0 - 0.7 * ((hour_offset - 6.0) / 12.0)
            else:
                fac = 0.3
            depth[d["id"]] = round(peak * max(0.0, fac), 3)
        return {"depth_by_district": depth,
                "source": f"synthetic(synthetic 48h rain {rain:.0f}mm hydrograph, estimated — demo/drill only)"}
    from . import simulate
    sim = simulate.simulate({"label": "human-impact", **(scenario or {})})
    times = sim["times"]
    idx = min(hour_offset, max(0, len(times) - 1))
    depth_by_district = {}
    for d in sim["districts"]:
        depth_by_district[d["id"]] = float(d["scenario_depth_p50_m"][idx])
    return {"depth_by_district": depth_by_district, "source": "simulate(scenario ensemble p50)"}


def _hazard_state_typhoon(hour_offset: int, params: Dict[str, Any]) -> Dict[str, Any]:
    wind: Dict[str, float] = {}
    if params.get("wind_ms") is not None:
        base = float(params["wind_ms"])
        source = "scenario(wind_ms parameter)"
    else:
        live = live_ops.build_live()
        # city_wind is one series for the city centre; scale by district coastal
        series = live.get("city_wind") or []
        idx = min(hour_offset, max(0, len(series) - 1))
        base = float(series[idx] or 0.0) if series else 0.0
        source = "live_ops(Open-Meteo wind_speed_10m)"
    from . import shenzhen
    for d in shenzhen.DISTRICTS:
        # coastal/port districts see higher sustained wind (derived, mild)
        wind[d["id"]] = round(base * (0.95 + 0.2 * float(d.get("coastal", 0.5))), 1)
    return {"wind_by_district": wind, "source": source}


def _hazard_state_earthquake(hour_offset: int, params: Dict[str, Any]) -> Dict[str, Any]:
    mag = float(params.get("mag", 6.0))
    lat = float(params.get("lat", 22.545))
    lon = float(params.get("lon", 114.06))
    depth = float(params.get("depth_km", 10.0))
    scen = eq.scenario(mag=mag, lat=lat, lon=lon, depth_km=depth, name="human-impact")
    mmi = {d["district_id"]: float(d["mmi"]) for d in scen["districts"]}
    return {"mmi_by_district": mmi,
            "source": f"earthquake.scenario(M{mag}, GA 衰减近似)"}


def _hazard_state_heatwave(hour_offset: int, params: Dict[str, Any]) -> Dict[str, Any]:
    live = climate_hazards.monitor()
    t_by: Dict[str, float] = {}
    app_by: Dict[str, float] = {}
    if "error" not in live:
        for d in live["districts"]:
            t_by[d["district_id"]] = float(d["current"]["temperature_c"] or 28.0)
            app_by[d["district_id"]] = float(d["current"]["apparent_temperature_c"]
                                             or d["current"]["temperature_c"] or 28.0)
    # diurnal shape (estimated): warmest ~15:00, coolest ~05:00
    if params.get("t_apparent_c") is not None:
        peak = float(params["t_apparent_c"])
        hr = (_now_hour() + hour_offset) % 24
        diurnal = math_cos_curve(hr)
        for did in t_by:
            app_by[did] = round(peak * (0.9 + 0.1 * diurnal), 1)
            t_by[did] = round(app_by[did] - 2.0, 1)
    return {"t_by_district": t_by, "apparent_by_district": app_by,
            "source": "climate_hazards(Open-Meteo) + diurnal shape estimated"}


def math_cos_curve(hour: int) -> float:
    """0.0 at night .. 1.0 at 15:00 — mild cosine diurnal shape (estimated)."""
    import math
    return 0.5 * (1.0 + math.cos((hour - 15.0) / 24.0 * 2.0 * math.pi))


def _hazard_state_landslide(hour_offset: int, params: Dict[str, Any]) -> Dict[str, Any]:
    s = multihazard.landslide_summary()
    pts = [p for p in s.get("points", []) if p.get("lon") is not None]
    return {"hazard_points": pts,
            "source": "multihazard.landslide_summary(300 隐患点, 真实)"}


def _hazard_state_surge(hour_offset: int, params: Dict[str, Any]) -> Dict[str, Any]:
    live = live_ops.build_live()
    surge_m = float(live.get("surge", {}).get("surge_estimate_m") or 0.0)
    if params.get("surge_peak_m") is not None:
        surge_m = float(params["surge_peak_m"])
    from . import shenzhen
    out = {}
    for d in shenzhen.DISTRICTS:
        out[d["id"]] = round(surge_m * (0.6 + 0.4 * float(d.get("coastal", 0.5))), 3)
    return {"surge_by_district": out, "source": "live_ops.surge(参数化增水) or param"}


def _hazard_state_flash(hour_offset: int, params: Dict[str, Any]) -> Dict[str, Any]:
    rw = reservoir_ops.river_warning()
    gullies = rw.get("gullies", [])
    reaches = rw.get("reaches", [])
    alerts = [g for g in gullies if g.get("level") in ("orange", "red")]
    reach_alerts = [r for r in reaches if r.get("status") != "正常"]
    return {"gully_alerts": gullies, "reach_alerts": reach_alerts,
            "alert_gullies": len(alerts), "alert_reaches": len(reach_alerts),
            "source": "reservoir_ops.river_warning(Open-Meteo 降雨 → 沟道分级)"}


_STATE_BUILDERS = {
    "pluvial_flood": _hazard_state_pluvial,
    "typhoon": _hazard_state_typhoon,
    "earthquake": _hazard_state_earthquake,
    "heatwave": _hazard_state_heatwave,
    "landslide": _hazard_state_landslide,
    "storm_surge": _hazard_state_surge,
    "flash_flood": _hazard_state_flash,
}

# ============================================================================
# Scoring
# ============================================================================
def _component_scores(rec: Dict[str, Any]) -> Dict[str, float]:
    """Explainable 0-100 components for one cell."""
    pop = float(rec["current_population"]) or 1.0
    aff = float(rec["affected_population"])
    mob = float(rec["mobility_disrupted_population"])
    svc = float(rec["critical_service_loss_population"])
    med = float(rec["medical_risk_population"])
    ev = float(rec["evacuation_population"]) + float(rec["shelter_demand"])
    exposure = float(rec["exposure"])
    exposure_score = 100.0 * min(1.0, exposure * (0.4 + 0.6 * aff / pop))
    mobility_loss = 100.0 * min(1.0, mob / pop)
    service_loss = 100.0 * min(1.0, svc / pop + (1.0 - float(rec["basic_service_accessibility"])) * 0.6)
    health_risk = 100.0 * min(1.0, med / pop * 6.0)
    evac_pressure = 100.0 * min(1.0, ev / pop * 2.5)
    return {
        "exposure_score": round(exposure_score, 1),
        "mobility_loss_score": round(mobility_loss, 1),
        "service_loss_score": round(service_loss, 1),
        "health_risk_score": round(health_risk, 1),
        "evacuation_pressure_score": round(evac_pressure, 1),
    }


def _human_impact_score(comps: Dict[str, float]) -> float:
    return round(sum(comps[k] * SCORE_WEIGHTS[k] for k in SCORE_WEIGHTS), 1)


# ============================================================================
# Main engine
# ============================================================================
def _cells() -> List[Dict[str, Any]]:
    return population_base.population_grid()["cells"]


def impact_at(hazard: str, hour_offset: int = 0,
              params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Full per-cell human impact at one hour offset (fresh compute)."""
    params = params or {}
    if hazard not in _STATE_BUILDERS:
        raise ValueError(f"unknown hazard {hazard!r}; available: {sorted(_STATE_BUILDERS)}")
    cells = _cells()
    ctx = _STATE_BUILDERS[hazard](hour_offset, params)
    clock_hour = (_now_hour() + hour_offset) % 24
    records = hazard_adapters.run_adapter(hazard, cells, clock_hour, ctx)
    cells_by_id = {c["grid_id"]: c for c in cells}
    behavior = behavior_model.expected_behavior(records, cells_by_id, clock_hour)
    cascades = cascade_model.run_cascades(records, cells, behavior)
    # per-cell score + recovery estimate
    for rec in records:
        comps = _component_scores(rec)
        rec["scores"] = comps
        rec["human_impact_score"] = _human_impact_score(comps)
    agg = aggregate(records, cells_by_id, hour_offset, hazard, behavior, cascades)
    return {"records": records, "behavior": behavior, "cascades": cascades,
            "aggregate": agg, "hazard": hazard, "hour_offset": hour_offset}


def aggregate(records: List[Dict[str, Any]],
              cells_by_id: Dict[int, Dict[str, Any]],
              hour_offset: int, hazard: str,
              behavior: Dict[str, Any], cascades: Dict[str, Any]) -> Dict[str, Any]:
    """District + city aggregation with the four core metrics."""
    from . import shenzhen
    districts = {}
    city = {
        "affected_population": 0.0, "mobility_disrupted_population": 0.0,
        "stranded_population": 0.0, "critical_service_loss_population": 0.0,
        "medical_risk_population": 0.0, "evacuation_population": 0.0,
        "shelter_demand": 0.0, "population_without_access_to_hospital": 0.0,
        "population_without_access_to_shelter": 0.0,
        "affected_cells": 0, "total_population": 0.0,
        "weighted_impact": 0.0, "score_components": None,
    }
    weighted_sum = 0.0
    pop_total = 0.0
    comp_sum = {k: 0.0 for k in SCORE_WEIGHTS}
    for rec in records:
        did = rec["district_id"]
        pop = float(rec["current_population"])
        pop_total += pop
        d = districts.setdefault(did, {
            "district_id": did, "district": rec["district"],
            "population": 0.0, "affected_population": 0.0,
            "mobility_disrupted_population": 0.0, "stranded_population": 0.0,
            "critical_service_loss_population": 0.0, "medical_risk_population": 0.0,
            "evacuation_population": 0.0, "shelter_demand": 0.0,
            "isolated_cells": 0, "affected_cells": 0,
        })
        d["population"] += pop
        if float(rec["affected_population"]) > 0:
            d["affected_cells"] += 1
            city["affected_cells"] += 1
        for k in ("affected_population", "mobility_disrupted_population",
                  "stranded_population", "critical_service_loss_population",
                  "medical_risk_population", "evacuation_population", "shelter_demand"):
            v = float(rec[k])
            d[k] += v
            city[k] += v
        if rec.get("isolated"):
            d["isolated_cells"] += 1
        ma = float(rec["medical_accessibility"])
        sa = float(rec["shelter_accessibility"])
        if ma < 0.5:
            city["population_without_access_to_hospital"] += pop
        if sa < 0.5:
            city["population_without_access_to_shelter"] += pop
        weighted_sum += float(rec["human_impact_score"]) * pop
        for k in SCORE_WEIGHTS:
            comp_sum[k] += rec["scores"][k] * pop
    city["total_population"] = round(pop_total, 0)
    city["affected_population"] = round(city["affected_population"], 0)
    city["mobility_disrupted_population"] = round(city["mobility_disrupted_population"], 0)
    city["stranded_population"] = round(city["stranded_population"], 0)
    city["critical_service_loss_population"] = round(city["critical_service_loss_population"], 0)
    city["medical_risk_population"] = round(city["medical_risk_population"], 0)
    city["evacuation_population"] = round(city["evacuation_population"], 0)
    city["shelter_demand"] = round(city["shelter_demand"], 0)
    city["population_without_access_to_hospital"] = round(city["population_without_access_to_hospital"], 0)
    city["population_without_access_to_shelter"] = round(city["population_without_access_to_shelter"], 0)
    if pop_total > 0:
        city["weighted_impact"] = round(weighted_sum / pop_total, 1)
        city["score_components"] = {k: round(v / pop_total, 1) for k, v in comp_sum.items()}
    # estimated recovery time (from records — worst affected systems)
    rec_est = recovery_model.estimate_recovery_time(records, cells_by_id)
    city["estimated_recovery_time_h"] = rec_est["recovery_hours"]
    city["recovery_bottleneck"] = rec_est.get("bottleneck")
    dist_list = list(districts.values())
    for d in dist_list:
        for k in ("affected_population", "mobility_disrupted_population",
                  "stranded_population", "critical_service_loss_population",
                  "medical_risk_population", "evacuation_population", "shelter_demand"):
            d[k] = round(float(d[k]), 0)
    dist_list.sort(key=lambda x: -x["affected_population"])
    return {
        "hour_offset": hour_offset,
        "hazard": hazard,
        "city": city,
        "districts": dist_list,
        "dominant_behavior": behavior.get("dominant"),
    }


# ============================================================================
# Timeline (T0 → T+24) with recovery
# ============================================================================
def timeline(hazard: str, params: Optional[Dict[str, Any]] = None,
             hours: tuple = TIMELINE_HOURS) -> Dict[str, Any]:
    """Hourly evolution T0/T+1/T+3/T+6/T+12/T+24 including recovery phase."""
    hazard_end = _HAZARD_END[hazard]
    frames = []
    for h in hours:
        fr = impact_at(hazard, hour_offset=int(h), params=params)
        agg = fr["aggregate"]
        city = agg["city"]
        # recovery framing: hours past hazard end
        since_end = max(0.0, float(h) - hazard_end)
        recovery = recovery_model.estimate_recovery_time(
            [r for r in fr["records"] if float(r.get("affected_population") or 0) > 0],
            {c["grid_id"]: c for c in _cells()},
        )
        r_est = recovery["recovery_hours"]
        # linear fade after hazard end along the slowest system bottleneck
        scale = 1.0 if since_end == 0 else max(0.0, 1.0 - since_end / max(r_est, 1.0))
        state = 4 if scale == 0 else 2 if h == 0 else 3 if since_end > 0 else 1
        def sc(v: float) -> float:
            return round(v * scale, 0)
        frame = {
            "t_h": h,
            "phase": ("restored" if scale == 0 else "emergency" if h == 0
                      else "disruption" if since_end == 0 else "recovering"),
            "affected_population": sc(city["affected_population"]),
            "mobility_disrupted_population": sc(city["mobility_disrupted_population"]),
            "critical_service_loss_population": sc(city["critical_service_loss_population"]),
            "medical_risk_population": sc(city["medical_risk_population"]),
            "evacuation_population": sc(city["evacuation_population"]),
            "stranded_population": sc(city["stranded_population"]),
            "weighted_impact": round(float(city["weighted_impact"]) * scale, 1),
            "recovery_state": state,
            "recovery_scale": round(scale, 3),
            "dominant_behavior": agg.get("dominant_behavior"),
            "estimated_recovery_time_h": r_est,
        }
        frames.append(frame)
    return {
        "hazard": hazard,
        "timeline_hours": list(hours),
        "hazard_end_h": hazard_end,
        "frames": frames,
        "provenance": "mixed(live_ops/state-model/climate/earthquake/reservoir real states; "
                      "behavior/cascade/recovery rules assumed — see human_config)",
    }


# ============================================================================
# API-facing helpers
# ============================================================================
def human_impact(hazard: str, hour_offset: int = 0,
                 params: Optional[Dict[str, Any]] = None,
                 use_cache: bool = True) -> Dict[str, Any]:
    """Cached full human-impact snapshot for one hazard/hour."""
    key = (hazard, hour_offset, None if not params else
           tuple(sorted((k, str(v)) for k, v in params.items())))
    with _LOCK:
        hit = _CACHE.get(key)
        if hit and use_cache and time.time() - hit["ts"] < _TTL:
            return hit["data"]
    data = impact_at(hazard, hour_offset, params)
    with _LOCK:
        _CACHE[key] = {"data": data, "ts": time.time()}
    return data


def hazard_list() -> List[str]:
    return sorted(_STATE_BUILDERS.keys())


def population_summary() -> Dict[str, Any]:
    """Population base summary (day/night, cohorts, districts)."""
    g = population_base.population_grid()
    cells = g["cells"]
    districts = {}
    for c in cells:
        d = districts.setdefault(c["district_id"], {
            "district": c["district"], "night_population": 0.0, "day_population": 0.0})
        d["night_population"] += c["night_population"]
        d["day_population"] += c["day_population"]
    for d in districts.values():
        d["night_population"] = round(d["night_population"], 0)
        d["day_population"] = round(d["day_population"], 0)
    return {
        "resolution_deg": g["resolution_deg"],
        "n_cells": g["n_cells"],
        "night_total": g["night_total"],
        "day_total": g["day_total"],
        "districts": sorted(districts.values(), key=lambda x: -x["night_population"]),
        "cells": cells,
        "provenance": g["provenance"],
        "cohort_baseline": {
            "office_worker": 0.20, "student": 0.13, "elderly": 0.06,
            "resident": 0.53, "visitor": 0.03, "public_service_worker": 0.05,
        },
    }


def reset_cache() -> None:
    with _LOCK:
        _CACHE.clear()


__all__ = ["human_impact", "timeline", "population_summary", "hazard_list",
           "impact_at", "reset_cache"]
