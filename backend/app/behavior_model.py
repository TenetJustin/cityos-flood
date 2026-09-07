# -*- coding: utf-8 -*-
"""Human Behavior Response — rule-based + probabilistic action selection.

Deterministic, explainable and driven ONLY by ``human_config`` probabilities:

    stay / stay_home / normal_trip / cancel_trip / reroute / switch_transport
    / evacuate / seek_shelter / seek_medical_help / wait / return_home

Decision inputs per cell: hazard, severity/exposure, cohort mix, time of day,
transport accessibility.  Different hazards shift the action distribution
differently (config.BEHAVIOR_SHIFTS) — typhoon pushes stay_home, flood pushes
reroute/switch, earthquake pushes evacuate, etc.  No LLM agents in this layer.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .human_config import BEHAVIOR_ACTIONS, BEHAVIOR_BASE, BEHAVIOR_SHIFTS, COHORTS

# severity bands shared by all adapters (derived from impact record)
_SEV_BANDS = ("none", "low", "medium", "high", "critical")


def _severity(rec: Dict[str, Any]) -> str:
    exposure = float(rec.get("exposure") or 0.0)
    affected = float(rec.get("affected_population") or 0.0)
    if affected <= 0 or exposure <= 0.03:
        return "none"
    if exposure >= 0.75 or rec.get("isolated"):
        return "critical"
    if exposure >= 0.5:
        return "high"
    if exposure >= 0.3:
        return "medium"
    return "low"


def _cohort_mix(cell: Dict[str, Any], hour: int) -> Dict[str, float]:
    """Effective cohort fractions at the given hour (day/night mix)."""
    n = cell.get("cohort_night") or {}
    d = cell.get("cohort_day") or {}
    h = hour % 24
    if 9 <= h < 17:
        mix = d
    elif 6 <= h < 9 or 17 <= h < 20:
        mix = {c: 0.5 * (n.get(c, 0) + d.get(c, 0)) for c in COHORTS}
    else:
        mix = n
    tot = sum(mix.values()) or 1.0
    return {c: max(0.0, mix.get(c, 0.0)) / tot for c in COHORTS}


def _shifted_probs(hazard: str, severity: str, cohort: str,
                   base: Dict[str, float]) -> Dict[str, float]:
    """Base action probabilities modified by hazard shift weights.

    Positive shifts ADD probability mass (so actions absent from the base,
    e.g. evacuate, can be boosted); negative shifts dampen proportionally.
    Then renormalised so probabilities stay a distribution.
    """
    shifts = BEHAVIOR_SHIFTS.get(hazard, {})
    sev_mult = {"none": 0.0, "low": 0.35, "medium": 0.65, "high": 0.9, "critical": 1.0}[severity]
    p = {a: base.get(a, 0.0) for a in BEHAVIOR_ACTIONS}
    for action, s in shifts.items():
        if s > 0:
            p[action] = p.get(action, 0.0) + s * sev_mult
        elif s < 0:
            p[action] = p.get(action, 0.0) * (1.0 - (-s) * sev_mult * 0.7)
    # vulnerability/cohort tweak: elderly & students more likely to wait/stay home
    if cohort in ("elderly", "student"):
        p["stay_home"] = p.get("stay_home", 0.0) * 1.35
        p["wait"] = p.get("wait", 0.0) * 1.15
    tot = sum(max(0.0, v) for v in p.values())
    if tot <= 0:
        return {"stay": 1.0}
    return {a: max(0.0, v) / tot for a, v in p.items()}


def _expected_action(probs: Dict[str, float]) -> str:
    """Deterministic expected action (max-prob) — keeps output reproducible."""
    return max(probs.items(), key=lambda kv: kv[1])[0]


def behavior_for_cell(rec: Dict[str, Any], cell: Dict[str, Any],
                      hour: int) -> Dict[str, Any]:
    """Action distribution + expected action for one cell."""
    hazard = rec["hazard"]
    sev = _severity(rec)
    mix = _cohort_mix(cell, hour)
    agg: Dict[str, float] = {}
    for cohort, frac in mix.items():
        probs = _shifted_probs(hazard, sev, cohort, BEHAVIOR_BASE)
        for a, p in probs.items():
            agg[a] = agg.get(a, 0.0) + p * frac
    expected = _expected_action(agg)
    # freeze to percentages
    total = sum(agg.values()) or 1.0
    distribution = {a: round(p / total * 100.0, 1) for a, p in agg.items()}
    distribution = dict(sorted(distribution.items(), key=lambda kv: -kv[1]))
    return {
        "severity": sev,
        "expected_action": expected,
        "distribution": distribution,
        "basis": "rule+probabilistic (human_config.BEHAVIOR_SHIFTS), deterministic argmax expected action",
    }


def expected_behavior(records: List[Dict[str, Any]], cells_by_id: Dict[int, Dict[str, Any]],
                      hour: int) -> Dict[str, Any]:
    """City-level behavior census: count people per action."""
    action_pop: Dict[str, float] = {}
    for rec in records:
        cell = cells_by_id.get(rec["grid_id"], {})
        bh = behavior_for_cell(rec, cell, hour)
        exp = bh["expected_action"]
        # expected action carries the cell's affected population share
        action_pop[exp] = action_pop.get(exp, 0.0) + float(rec.get("current_population") or 0.0)
    total = sum(action_pop.values()) or 1.0
    return {
        "hour": hour,
        "by_action": {a: round(v, 0) for a, v in sorted(action_pop.items(), key=lambda kv: -kv[1])},
        "by_action_pct": {a: round(v / total * 100.0, 1) for a, v in action_pop.items()},
        "dominant": max(action_pop.items(), key=lambda kv: kv[1])[0] if action_pop else "stay",
    }


__all__ = ["behavior_for_cell", "expected_behavior"]
