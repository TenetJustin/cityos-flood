# -*- coding: utf-8 -*-
"""Hazard Impact Adapters — per-hazard human impact mechanisms.

Every existing project hazard gets its OWN exposure→population-impact logic
(NOT one shared risk score):

    pluvial_flood : depth→trip impeded/stranded/underground service loss
    typhoon       : wind→stay-home/cancel + tree/power disruption
    earthquake    : MMI→evacuation + road/medical demand (intensity, not magnitude)
    heatwave      : apparent T→heat-health risk by cohort
    landslide     : 300 registered points → zone isolation / evacuation
    storm_surge   : coastal overbank → inundation + port disruption
    flash_flood   : gully levels + reach overbank → evacuation / reroute

Each adapter takes the shared population grid + a hazard state and returns a
uniform per-cell impact record (see SCHEMA).  Thresholds come from
``human_config`` only.  Provenance of every number is tagged.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from .human_config import (
    FOG_VIS_M,
    HEAT_MED_FACTOR,
    HEAT_RISK_T_APPARENT,
    HEAT_RISK_T_HARD,
    HEAT_SENSITIVITY,
    LAND_SLIDE_LEVEL_RED,
    MMI_LEVELS,
    SURGE_OVERBANK_M,
    WATER_DEPTH_M,
    WIND_M_S,
)

# ---------------------------------------------------------------------------
# Uniform impact record schema
# ---------------------------------------------------------------------------
SCHEMA = (
    "grid_id", "lat", "lon", "district_id", "district",
    "hazard", "intensity", "intensity_unit", "exposure",
    "current_population", "affected_population",
    "mobility_disrupted_population", "stranded_population",
    "critical_service_loss_population", "medical_risk_population",
    "evacuation_population", "shelter_demand",
    "average_travel_delay_min",
    "medical_accessibility", "shelter_accessibility",
    "transport_accessibility", "basic_service_accessibility",
    "isolated", "reasons",
)

_EMPTY_DISTRICT_MMI = None


def _hav(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _base_record(cell: Dict[str, Any], hazard: str, pop_at: float) -> Dict[str, Any]:
    return {
        "grid_id": cell["grid_id"],
        "lat": cell["lat"], "lon": cell["lon"],
        "district_id": cell["district_id"], "district": cell["district"],
        "hazard": hazard,
        "intensity": 0.0, "intensity_unit": "", "exposure": 0.0,
        "current_population": round(pop_at, 0),
        "affected_population": 0.0,
        "mobility_disrupted_population": 0.0,
        "stranded_population": 0.0,
        "critical_service_loss_population": 0.0,
        "medical_risk_population": 0.0,
        "evacuation_population": 0.0, "shelter_demand": 0.0,
        "average_travel_delay_min": 0.0,
        "medical_accessibility": 1.0, "shelter_accessibility": 1.0,
        "transport_accessibility": 1.0, "basic_service_accessibility": 1.0,
        "isolated": False, "reasons": [],
    }


def _cell_district_id(cell: Dict[str, Any]) -> str:
    return cell["district_id"]


# ---------------------------------------------------------------------------
# 1. Pluvial flood / urban waterlogging (暴雨内涝)
# ---------------------------------------------------------------------------
def pluvial_flood_adapter(cells: List[Dict[str, Any]], hour: int,
                          depth_by_district: Dict[str, float],
                          district_vuln_mean: Dict[str, float]) -> List[Dict[str, Any]]:
    """Depth-driven urban flooding impact.

    depth_by_district: representative water depth (m) per district at ``hour``
    (from the conservative state-model ensemble, p50).
    Cell depth is downscaled with the cell/district vulnerability ratio
    (derived — keeps intra-district ranking without running the full grid).
    """
    out = []
    for cell in cells:
        did = _cell_district_id(cell)
        base_depth = float(depth_by_district.get(did, 0.0))
        mu = district_vuln_mean.get(did, 1.0) or 1.0
        local = base_depth * (float(cell["vulnerability_score"]) / mu) if mu > 0 else base_depth
        local = max(0.0, local)
        pop = float(cell["night_population"])
        if hour % 24 in (9, 10, 11, 12, 13, 14, 15, 16):
            pop = float(cell["day_population"])
        elif hour % 24 in (6, 7, 8, 17, 18, 19):
            pop = 0.5 * (float(cell["night_population"]) + float(cell["day_population"]))
        r = _base_record(cell, "pluvial_flood", pop)
        r["intensity"] = round(local, 3)
        r["intensity_unit"] = "m (cell-downscaled district p50)"
        if local <= 0.03:
            out.append(r)
            continue
        # thresholds (human_config, assumed)
        d1, d2, d3 = (WATER_DEPTH_M["trip_impeded"], WATER_DEPTH_M["stranded"],
                      WATER_DEPTH_M["service_loss"])
        aff = pop * min(1.0, local / d1) if local < d1 else pop
        r["affected_population"] = round(aff, 0)
        if local >= d1:
            mob = pop * min(1.0, 0.35 + 0.65 * (local - d1) / (d2 - d1)) if local < d2 else pop
            r["mobility_disrupted_population"] = round(mob, 0)
            r["transport_accessibility"] = round(max(0.0, 1.0 - local / (d3 * 2.0)), 3)
            r["average_travel_delay_min"] = round(
                min(90.0, 15.0 + (local - d1) / (d2 - d1) * 55.0), 1
            ) if local >= d1 else 0.0
            r["reasons"].append(f"道路积水 {local:.2f}m ≥ {d1:.2f}m 出行受阻")
        if local >= d2:
            r["stranded_population"] = round(pop * min(1.0, (local - d2) / (d3 - d2) + 0.55), 0)
            r["medical_accessibility"] = round(max(0.0, 1.0 - (local - d2) / (d3 * 1.6)), 3)
            r["basic_service_accessibility"] = round(max(0.0, 1.0 - local / (d3 * 1.8)), 3)
            r["reasons"].append(f"水深 {local:.2f}m ≥ {d2:.2f}m 车辆被困/涉水危险")
        if local >= d3:
            r["critical_service_loss_population"] = round(pop, 0)
            r["basic_service_accessibility"] = 0.1
            r["reasons"].append(f"水深 {local:.2f}m ≥ {d3:.2f}m 地铁/地下设施停运")
        r["exposure"] = round(min(1.0, local / d3), 3)
        out.append(r)
    return out


# ---------------------------------------------------------------------------
# 2. Typhoon / strong wind (台风)
# ---------------------------------------------------------------------------
def typhoon_adapter(cells: List[Dict[str, Any]], hour: int,
                    wind_by_district: Dict[str, float]) -> List[Dict[str, Any]]:
    """Wind-driven impact: stay-home, trip cancel, tree/power disruption."""
    out = []
    for cell in cells:
        did = _cell_district_id(cell)
        wind = float(wind_by_district.get(did, 0.0))
        pop = float(cell["night_population"])
        r = _base_record(cell, "typhoon", pop)
        r["intensity"] = round(wind, 1)
        r["intensity_unit"] = "m/s (10m wind, Open-Meteo district)"
        if wind < WIND_M_S["trip_avoid"] * 0.7:
            out.append(r)
            continue
        expo = min(1.0, wind / 40.0)
        r["exposure"] = round(expo, 3)
        # outdoor exposure risk ↑ with wind; affected = those with outdoor trips
        aff = pop * (0.15 + 0.45 * expo)
        r["affected_population"] = round(aff, 0)
        r["reasons"].append(f"风力 {wind:.0f}m/s 户外活动风险升高")
        if wind >= WIND_M_S["trip_avoid"]:
            mob = min(aff, pop * (0.25 + 0.4 * expo))
            r["mobility_disrupted_population"] = round(mob, 0)
            r["average_travel_delay_min"] = round(20.0 * expo, 1)
            r["transport_accessibility"] = round(max(0.3, 1.0 - 0.6 * expo), 3)
            r["reasons"].append(f"≥{WIND_M_S['trip_avoid']:.0f}m/s 公交/地铁班次调整")
        if wind >= WIND_M_S["tree_debris"]:
            r["basic_service_accessibility"] = round(max(0.35, 1.0 - 0.5 * expo), 3)
            r["reasons"].append(f"≥{WIND_M_S['tree_debris']:.0f}m/s 树木/广告牌倒伏路障")
        if wind >= WIND_M_S["power_outage"]:
            r["critical_service_loss_population"] = round(pop * (0.3 + 0.4 * expo), 0)
            r["reasons"].append(f"≥{WIND_M_S['power_outage']:.0f}m/s 电力中断风险")
        out.append(r)
    return out


# ---------------------------------------------------------------------------
# 3. Earthquake (地震) — MMI-driven, NOT magnitude
# ---------------------------------------------------------------------------
def earthquake_adapter(cells: List[Dict[str, Any]], hour: int,
                       mmi_by_district: Dict[str, float]) -> List[Dict[str, Any]]:
    """Intensity-driven: evacuation, road damage, medical demand."""
    out = []
    for cell in cells:
        did = _cell_district_id(cell)
        mmi = float(mmi_by_district.get(did, 2.0))
        pop = float(cell["night_population"])
        r = _base_record(cell, "earthquake", pop)
        r["intensity"] = round(mmi, 2)
        r["intensity_unit"] = "MMI (GA attenuation, approximate)"
        if mmi < MMI_LEVELS["felt"]:
            out.append(r)
            continue
        expo = min(1.0, (mmi - 3.0) / 4.0)
        r["exposure"] = round(expo, 3)
        r["affected_population"] = round(pop * expo, 0)
        r["reasons"].append(f"烈度 {mmi:.1f} 级 全城有感")
        if mmi >= MMI_LEVELS["evacuate"]:
            ev = pop * min(1.0, 0.25 + 0.55 * expo)
            r["evacuation_population"] = round(ev, 0)
            r["shelter_demand"] = round(ev * 0.7, 0)
            r["shelter_accessibility"] = round(max(0.2, 1.0 - 0.6 * expo), 3)
            r["reasons"].append(f"烈度 ≥{MMI_LEVELS['evacuate']:.0f} 建筑受损疏散")
        if mmi >= MMI_LEVELS["road_damage"]:
            r["mobility_disrupted_population"] = round(pop * min(1.0, 0.3 + 0.6 * expo), 0)
            r["transport_accessibility"] = round(max(0.15, 1.0 - 0.8 * expo), 3)
            r["average_travel_delay_min"] = round(45.0 * expo, 1)
            r["isolated"] = mmi >= 7.2
            r["reasons"].append(f"烈度 ≥{MMI_LEVELS['road_damage']:.0f} 道路/桥梁受损封闭")
        if mmi >= MMI_LEVELS["medical_demand"]:
            # injury rate scales with intensity (assumed; triage model)
            inj = pop * expo * (0.02 + 0.05 * expo)
            r["medical_risk_population"] = round(inj, 0)
            r["medical_accessibility"] = round(max(0.15, 1.0 - 0.7 * expo), 3)
            r["critical_service_loss_population"] = round(pop * expo, 0)
            r["reasons"].append(f"烈度 ≥{MMI_LEVELS['medical_demand']:.0f} 伤患上升/医院压力")
        out.append(r)
    return out


# ---------------------------------------------------------------------------
# 4. Heatwave / high temperature (高温热浪)
# ---------------------------------------------------------------------------
def heatwave_adapter(cells: List[Dict[str, Any]], hour: int,
                     t_by_district: Dict[str, float],
                     apparent_by_district: Dict[str, float]) -> List[Dict[str, Any]]:
    """Heat: outdoor activity down, high-risk cohort health, power demand."""
    out = []
    for cell in cells:
        did = _cell_district_id(cell)
        t = float(t_by_district.get(did, 28.0))
        app = float(apparent_by_district.get(did, t))
        pop = float(cell["night_population"])
        r = _base_record(cell, "heatwave", pop)
        r["intensity"] = round(app, 1)
        r["intensity_unit"] = "°C apparent temperature"
        if app < HEAT_RISK_T_APPARENT:
            out.append(r)
            continue
        expo = min(1.0, (app - HEAT_RISK_T_APPARENT) / (HEAT_RISK_T_HARD - HEAT_RISK_T_APPARENT))
        r["exposure"] = round(expo, 3)
        r["affected_population"] = round(pop * expo, 0)
        r["reasons"].append(f"体感 {app:.0f}°C ≥ {HEAT_RISK_T_APPARENT:.0f}°C 高温")
        # vulnerable cohorts: elderly + outdoor workers + children
        eld = float(cell["cohort_night"]["elderly"])
        child = float(cell["cohort_night"]["student"]) * 0.5  # students include children
        outw = float(cell["cohort_night"]["public_service_worker"]) + float(cell["cohort_night"]["visitor"])
        risk_pop = (eld * HEAT_SENSITIVITY["elderly"] + child * HEAT_SENSITIVITY["student"]
                    + outw * HEAT_SENSITIVITY["public_service_worker"])
        r["medical_risk_population"] = round(min(pop, risk_pop * expo * HEAT_MED_FACTOR), 0)
        r["basic_service_accessibility"] = round(max(0.5, 1.0 - 0.3 * expo), 3)
        r["average_travel_delay_min"] = round(8.0 * expo, 1)
        r["reasons"].append(f"老年/儿童/户外工作者 {risk_pop:,.0f} 人高风险")
        if app >= HEAT_RISK_T_HARD:
            r["critical_service_loss_population"] = round(pop * 0.15 * expo, 0)
            r["reasons"].append(f"体感 ≥{HEAT_RISK_T_HARD:.0f}°C 电网/医疗压力")
        out.append(r)
    return out


# ---------------------------------------------------------------------------
# 5. Landslide / debris flow (滑坡)
# ---------------------------------------------------------------------------
def landslide_adapter(cells: List[Dict[str, Any]], hour: int,
                      hazard_points: List[Dict[str, Any]],
                      radius_km: float = 1.2) -> List[Dict[str, Any]]:
    """Zone intersection: risk points → nearby cells isolated / evacuation.

    hazard_points: from multihazard.landslide_summary() (real 300 points),
    fields lon/lat/risk_level.  radius assumed (human_config).
    """
    high = [p for p in hazard_points if int(p.get("risk_level", 0)) >= LAND_SLIDE_LEVEL_RED]
    out = []
    for cell in cells:
        pop = float(cell["night_population"])
        r = _base_record(cell, "landslide", pop)
        if not high:
            out.append(r)
            continue
        nearest = min((_hav(cell["lat"], cell["lon"], p["lat"], p["lon"]) for p in high),
                      default=1e9)
        if nearest > radius_km:
            out.append(r)
            continue
        expo = max(0.0, 1.0 - nearest / radius_km)
        r["intensity"] = round(nearest, 2)
        r["intensity_unit"] = f"km to nearest high-risk point (r≤{radius_km}km)"
        r["exposure"] = round(expo, 3)
        aff = pop * (0.3 + 0.6 * expo)
        r["affected_population"] = round(aff, 0)
        r["reasons"].append(f"距高风险隐患点 {nearest:.1f}km")
        if expo > 0.55:
            r["isolated"] = True
            r["stranded_population"] = round(pop * (0.25 + 0.45 * expo), 0)
            r["medical_accessibility"] = round(max(0.2, 1.0 - 0.7 * expo), 3)
            r["transport_accessibility"] = round(max(0.2, 1.0 - 0.75 * expo), 3)
            r["critical_service_loss_population"] = round(pop * 0.5 * expo, 0)
            r["reasons"].append("滑坡阻断道路 社区对外交通中断")
        if expo > 0.75:
            r["evacuation_population"] = round(pop * (0.3 + 0.4 * expo), 0)
            r["shelter_demand"] = round(r["evacuation_population"] * 0.8, 0)
            r["reasons"].append("滑坡高风险区 需避险转移")
        out.append(r)
    return out


# ---------------------------------------------------------------------------
# 6. Storm surge / coastal inundation (风暴潮)
# ---------------------------------------------------------------------------
def storm_surge_adapter(cells: List[Dict[str, Any]], hour: int,
                        surge_by_district: Dict[str, float],
                        coastal_only: bool = True) -> List[Dict[str, Any]]:
    """Coastal overbank: inundation of low coastal cells + port disruption."""
    out = []
    for cell in cells:
        did = _cell_district_id(cell)
        surge = float(surge_by_district.get(did, 0.0))
        pop = float(cell["night_population"])
        r = _base_record(cell, "storm_surge", pop)
        r["intensity"] = round(surge, 2)
        r["intensity_unit"] = "m surge elevation above normal"
        if surge < SURGE_OVERBANK_M:
            out.append(r)
            continue
        # only low coastal cells flood (district coastal flag + vulnerability proxy)
        d = None
        from . import shenzhen
        d = shenzhen.get_district(did)
        coastal = float(d.get("coastal", 0.0)) if d else 0.0
        if coastal_only and coastal < 0.5:
            out.append(r)
            continue
        expo = min(1.0, (surge - SURGE_OVERBANK_M) / 1.2)
        r["exposure"] = round(expo * (0.5 + 0.5 * coastal), 3)
        aff = pop * r["exposure"]
        r["affected_population"] = round(aff, 0)
        r["reasons"].append(f"风暴增水 {surge:.2f}m 沿海低地漫溢")
        if expo > 0.3:
            mob = min(aff, pop * (0.2 + 0.5 * expo))
            r["mobility_disrupted_population"] = round(mob, 0)
            r["transport_accessibility"] = round(max(0.3, 1.0 - 0.6 * expo), 3)
            r["average_travel_delay_min"] = round(30.0 * expo, 1)
            r["reasons"].append("港区/沿海道路淹没")
        if expo > 0.55:
            ev = min(aff, pop * (0.2 + 0.5 * expo))
            r["evacuation_population"] = round(ev, 0)
            r["shelter_demand"] = round(ev * 0.75, 0)
            r["stranded_population"] = round(pop * 0.15 * expo, 0)
            r["reasons"].append("沿海低地 需提前转移")
        if expo > 0.75:
            r["critical_service_loss_population"] = round(pop * 0.4 * expo, 0)
            r["reasons"].append("电力/通信基础设施受淹")
        out.append(r)
    return out


# ---------------------------------------------------------------------------
# 7. Flash flood / mountain torrent + river overbank (山洪沟道)
# ---------------------------------------------------------------------------
def flash_flood_adapter(cells: List[Dict[str, Any]], hour: int,
                        gully_alerts: List[Dict[str, Any]],
                        reach_alerts: List[Dict[str, Any]],
                        gully_radius_km: float = 1.5) -> List[Dict[str, Any]]:
    """Gully level → nearby evacuation; reach overbank → district mobility."""
    alert_districts = {a["district"] for a in gully_alerts if a.get("level") in ("orange", "red")}
    out = []
    gully_pts = [{"lat": g["lat"], "lon": g["lon"], "level": g["level"]} for g in gully_alerts]
    for cell in cells:
        pop = float(cell["night_population"])
        r = _base_record(cell, "flash_flood", pop)
        nearest = min((_hav(cell["lat"], cell["lon"], p["lat"], p["lon"]) for p in gully_pts),
                      default=1e9)
        if nearest > gully_radius_km and cell["district_id"] not in alert_districts:
            out.append(r)
            continue
        r["intensity"] = round(nearest, 2)
        r["intensity_unit"] = f"km to nearest gully (r≤{gully_radius_km}km)"
        expo = max(0.0, 1.0 - nearest / gully_radius_km) if nearest < gully_radius_km else 0.35
        r["exposure"] = round(expo, 3)
        aff = pop * (0.25 + 0.6 * expo)
        r["affected_population"] = round(aff, 0)
        r["reasons"].append(f"山洪沟道 {nearest:.1f}km 内")
        if expo > 0.5:
            r["evacuation_population"] = round(pop * (0.2 + 0.5 * expo), 0)
            r["shelter_demand"] = round(r["evacuation_population"] * 0.8, 0)
            r["medical_accessibility"] = round(max(0.25, 1.0 - 0.6 * expo), 3)
            r["reasons"].append("山洪沟道高水位 需避险转移")
        if reach_alerts:
            r["mobility_disrupted_population"] = round(pop * 0.2 * expo, 0)
            r["transport_accessibility"] = round(max(0.4, 1.0 - 0.4 * expo), 3)
            r["reasons"].append("下游河道超警 桥梁/临河路封闭")
        out.append(r)
    return out


ADAPTERS = {
    "pluvial_flood": pluvial_flood_adapter,
    "typhoon": typhoon_adapter,
    "earthquake": earthquake_adapter,
    "heatwave": heatwave_adapter,
    "landslide": landslide_adapter,
    "storm_surge": storm_surge_adapter,
    "flash_flood": flash_flood_adapter,
}

HAZARD_LABELS = {
    "pluvial_flood": "暴雨内涝",
    "typhoon": "台风强风",
    "earthquake": "地震",
    "heatwave": "高温热浪",
    "landslide": "滑坡",
    "storm_surge": "风暴潮",
    "flash_flood": "山洪/河流洪水",
}


def run_adapter(hazard: str, cells: List[Dict[str, Any]], hour: int,
                ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Dispatch to the right adapter with the engine-built hazard state."""
    if hazard not in ADAPTERS:
        raise ValueError(f"unknown hazard {hazard!r}; available: {sorted(ADAPTERS)}")
    fn = ADAPTERS[hazard]
    if hazard == "pluvial_flood":
        return fn(cells, hour, ctx["depth_by_district"], ctx.get("district_vuln_mean", {}))
    if hazard == "typhoon":
        return fn(cells, hour, ctx["wind_by_district"])
    if hazard == "earthquake":
        return fn(cells, hour, ctx["mmi_by_district"])
    if hazard == "heatwave":
        return fn(cells, hour, ctx.get("t_by_district", {}), ctx.get("apparent_by_district", {}))
    if hazard == "landslide":
        return fn(cells, hour, ctx.get("hazard_points", []))
    if hazard == "storm_surge":
        return fn(cells, hour, ctx.get("surge_by_district", {}))
    if hazard == "flash_flood":
        return fn(cells, hour, ctx.get("gully_alerts", []), ctx.get("reach_alerts", []))
    raise ValueError(hazard)


__all__ = ["run_adapter", "ADAPTERS", "HAZARD_LABELS", "SCHEMA"]
