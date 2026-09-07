# -*- coding: utf-8 -*-
"""Urban Cascade Model — human behavior feeds back into city systems.

Three coupled feedback loops (config-driven, assumed parameters):

1. **Traffic**: reroute/switch shares → congested links → longer travel time
   → more people affected on those links (delay multiplier).
2. **Medical**: injured/high-risk population → hospital demand vs capacity →
   waiting time ↑ → medical accessibility ↓ for that district.
3. **Shelter**: evacuation → shelter occupancy vs capacity → overflow
   re-assigned to the next district's shelters → evacuation distance ↑.

Records are updated in place (additive fields), and a city-level summary with
full provenance is returned.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .human_config import CASCADE


def _district_pop(cells: List[Dict[str, Any]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for c in cells:
        out[c["district_id"]] = out.get(c["district_id"], 0.0) + float(c.get("night_population") or 0)
    return out


def _district_records(records: List[Dict[str, Any]], did: str) -> List[Dict[str, Any]]:
    return [r for r in records if r["district_id"] == did]


def transport_cascade(records: List[Dict[str, Any]],
                      behavior: Dict[str, Any]) -> Dict[str, Any]:
    """Congestion feedback: reroute/switch → delay multiplier → accessibility ↓."""
    by_action = behavior.get("by_action", {})
    reroute_pop = float(by_action.get("reroute", 0.0)) + float(by_action.get("switch_transport", 0.0))
    total = sum(by_action.values()) or 1.0
    reroute_share = reroute_pop / total
    mult = 1.0 + CASCADE["traffic_recovery_congestion"] * reroute_share
    n_updated = 0
    for rec in records:
        if float(rec.get("affected_population") or 0) <= 0:
            continue
        base_delay = float(rec.get("average_travel_delay_min") or 0.0)
        rec["average_travel_delay_min"] = round(base_delay * mult, 1)
        ta = float(rec.get("transport_accessibility") or 1.0)
        rec["transport_accessibility"] = round(max(0.0, ta - 0.12 * reroute_share), 3)
        n_updated += 1
    return {
        "reroute_population": round(reroute_pop, 0),
        "reroute_share": round(reroute_share, 3),
        "delay_multiplier": round(mult, 3),
        "cells_updated": n_updated,
        "provenance": "derived(behavior census) × assumed(congestion multiplier)",
    }


def medical_cascade(records: List[Dict[str, Any]],
                    cells: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Hospital demand vs capacity → waiting time ↑ → accessibility ↓."""
    pop_by_district = _district_pop(cells)
    bed_ratio = CASCADE["hospital_bed_ratio"]
    occupancy = CASCADE["hospital_occupancy"]
    districts: Dict[str, Dict[str, Any]] = {}
    for rec in records:
        did = rec["district_id"]
        d = districts.setdefault(did, {"demand": 0.0, "population": pop_by_district.get(did, 0.0)})
        d["demand"] += float(rec.get("medical_risk_population") or 0.0)
        d["demand"] += float(rec.get("critical_service_loss_population") or 0.0) * 0.05
    for did, d in districts.items():
        beds = d["population"] * bed_ratio
        spare = beds * (1.0 - occupancy)
        demand = d["demand"]
        if spare <= 0:
            d["waiting_h"] = 24.0 if demand > 0 else 0.0
        else:
            d["waiting_h"] = round(min(24.0, demand / spare * CASCADE["ambulance_response_h"]), 2)
        d["overload"] = demand > spare
        # feedback: waiting time reduces medical accessibility of all cells here
        w = d["waiting_h"]
        penalty = min(0.7, w / 12.0 * 0.6)
        for rec in _district_records(records, did):
            ma = float(rec.get("medical_accessibility") or 1.0)
            rec["medical_accessibility"] = round(max(0.05, ma - penalty), 3)
    return {
        "districts": districts,
        "hospital_bed_ratio": bed_ratio,
        "provenance": "derived(demand from adapters) × assumed(beds/capita, occupancy, response time)",
    }


def shelter_cascade(records: List[Dict[str, Any]],
                    cells: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Shelter occupancy vs capacity; overflow re-assigned to next districts."""
    pop_by_district = _district_pop(cells)
    cap_ratio = CASCADE["shelter_capacity_ratio"]
    from . import shenzhen
    order = [d["id"] for d in shenzhen.DISTRICTS]
    demand_by: Dict[str, float] = {}
    for rec in records:
        demand_by[rec["district_id"]] = demand_by.get(rec["district_id"], 0.0) + float(rec.get("shelter_demand") or 0.0)
    overflow_total = 0.0
    reassigned: List[Dict[str, Any]] = []
    for i, did in enumerate(order):
        demand = demand_by.get(did, 0.0)
        cap = pop_by_district.get(did, 0.0) * cap_ratio
        overflow = max(0.0, demand - cap)
        overflow_total += overflow
        # find next-nearest districts with spare capacity (simple ring search)
        if overflow > 0:
            spare_targets = []
            for j in range(1, len(order)):
                alt = order[(i + j) % len(order)]
                alt_cap = pop_by_district.get(alt, 0.0) * cap_ratio
                alt_demand = demand_by.get(alt, 0.0)
                spare = max(0.0, alt_cap - alt_demand)
                if spare > 0:
                    spare_targets.append({"district": alt, "spare": spare})
                if len(spare_targets) >= 2:
                    break
            reassigned.append({"from": did, "overflow": round(overflow, 0),
                               "to": [t["district"] for t in spare_targets]})
        # feedback: shelter pressure lowers shelter accessibility
        pressure = min(1.0, demand / max(cap, 1.0))
        penalty = 0.55 * pressure if pressure > 1.0 else 0.25 * pressure
        for rec in _district_records(records, did):
            sa = float(rec.get("shelter_accessibility") or 1.0)
            rec["shelter_accessibility"] = round(max(0.05, sa - penalty), 3)
    return {
        "overflow_population": round(overflow_total, 0),
        "reassignments": reassigned,
        "shelter_capacity_ratio": cap_ratio,
        "provenance": "derived(evacuation demand from adapters) × assumed(shelter places per capita; "
                      "overflow re-assigned to nearest districts with spare capacity)",
    }


def run_cascades(records: List[Dict[str, Any]], cells: List[Dict[str, Any]],
                 behavior: Dict[str, Any]) -> Dict[str, Any]:
    """Run all three feedback loops in order; return cascade summary."""
    t = transport_cascade(records, behavior)
    m = medical_cascade(records, cells)
    s = shelter_cascade(records, cells)
    return {"transport": t, "medical": m, "shelter": s,
            "provenance": "feedback: behavior → urban system → human impact (see each loop)"}


__all__ = ["run_cascades"]
