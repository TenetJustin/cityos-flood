# -*- coding: utf-8 -*-
"""Recovery Model — per-system restoration after the hazard ends.

Systems restore at different speeds (``human_config.RECOVERY_HOURS``,
assumed): road < power < hospital < school < metro.  A cell's recovery is
bottlenecked by the slowest system that was affected, so "roads clear but
metro still closed" does NOT count as restored.

States: 0=normal 1=impacted 2=emergency 3=recovering 4=restored.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .human_config import RECOVERY_HOURS, RECOVERY_STATES

_SYSTEMS = ("road", "metro", "power", "hospital", "school", "shelter")


def _affected_systems(rec: Dict[str, Any]) -> List[str]:
    """Which city systems this cell's hazard disrupted (approx mapping)."""
    out = []
    if float(rec.get("mobility_disrupted_population") or 0) > 0 or float(rec.get("average_travel_delay_min") or 0) > 5:
        out.append("road")
        out.append("metro")
    if float(rec.get("critical_service_loss_population") or 0) > 0:
        out.append("power")
    if float(rec.get("medical_risk_population") or 0) > 0:
        out.append("hospital")
    if float(rec.get("evacuation_population") or 0) > 0:
        out.append("school")     # schools double as shelters
        out.append("shelter")
    if rec.get("isolated"):
        out.append("road")
    return sorted(set(out))


def recovery_state(rec: Dict[str, Any], hours_since_end: float) -> Dict[str, Any]:
    """Recovery state of one cell ``hours_since_end`` after hazard end."""
    affected = _affected_systems(rec)
    if not affected:
        return {"state": 0, "state_label": RECOVERY_STATES[0],
                "systems": {}, "bottleneck_h": 0.0, "bottleneck": None}
    systems = {}
    for sys_name in affected:
        dur = RECOVERY_HOURS.get(sys_name, 4.0)
        remaining = max(0.0, dur - hours_since_end)
        systems[sys_name] = {
            "restore_h": dur, "remaining_h": round(remaining, 1),
            "state": 0 if remaining > 0 else 4,
        }
    remaining_max = max(s["remaining_h"] for s in systems.values())
    bottleneck = max(systems.items(), key=lambda kv: kv[1]["remaining_h"])[0]
    if remaining_max > 0:
        state = 2 if hours_since_end == 0 else 3 if hours_since_end > 0 else 1
    else:
        state = 4
    return {
        "state": state,
        "state_label": RECOVERY_STATES[state],
        "systems": systems,
        "bottleneck_h": round(remaining_max, 1),
        "bottleneck": bottleneck,
        "affected_systems": affected,
    }


def estimate_recovery_time(records: List[Dict[str, Any]],
                           cells_by_id: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    """City-level recovery horizon: max system bottleneck among affected cells."""
    hours = []
    for rec in records:
        if float(rec.get("affected_population") or 0) <= 0:
            continue
        st = recovery_state(rec, 0.0)
        if st["state"] >= 1:
            hours.append((rec["grid_id"], st["bottleneck_h"], st["bottleneck"],
                          rec.get("affected_population", 0)))
    if not hours:
        return {"recovery_hours": 0.0, "affected_cells": 0, "systems": {}}
    worst = max(hours, key=lambda x: x[1])
    return {
        "recovery_hours": worst[1],
        "bottleneck": worst[2],
        "worst_cell": worst[0],
        "affected_cells": len(hours),
        "systems": {s: RECOVERY_HOURS[s] for s in _SYSTEMS},
        "provenance": "estimated(recovery durations assumed in human_config.RECOVERY_HOURS; "
                      "cell bottleneck = slowest affected system)",
    }


__all__ = ["recovery_state", "estimate_recovery_time"]
