"""Controlled RSI: evaluate proposals, never autonomously activate models.

Pure decision gate. A deployment service must independently authenticate the
human reviewer; a JSON field is NOT authentication. No activation API exists.
"""
import hashlib
import json
import math


def candidate_digest(candidate):
    return hashlib.sha256(json.dumps(candidate, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def review_candidate(candidate, validation, approval=None, *, authenticated_reviewer=None):
    blockers = []
    digest = candidate_digest(candidate)
    if not candidate.get("version") or not candidate.get("parent_version") or candidate.get("version") == candidate.get("parent_version"):
        blockers.append("distinct_parent_and_candidate_required")
    if validation.get("candidate_sha256") != digest:
        blockers.append("validation_not_bound_to_candidate")
    for name in ("frozen_backtest_passed", "leakage_checks_passed", "safety_checks_passed", "shadow_run_passed", "rollback_test_passed"):
        if validation.get(name) is not True:
            blockers.append(name)
    if candidate.get("scope") != "synthetic_demo":
        counts = [validation.get(key) for key in ("independent_observation_count", "event_holdout_count")]
        if any(type(count) is not int or count < 1 for count in counts):
            blockers.append("real_world_evidence_missing")
    error = validation.get("max_continuity_error_pct")
    if type(error) not in (int, float) or not math.isfinite(error) or abs(error) > 1:
        blockers.append("mass_balance_gate_failed")
    if not authenticated_reviewer or not approval or approval.get("reviewer") != authenticated_reviewer or approval.get("candidate_sha256") != digest or approval.get("decision") != "approve":
        blockers.append("authenticated_human_approval_required")
    return {"candidate_sha256": digest, "status": "eligible_for_manual_release" if not blockers else "blocked",
            "blockers": blockers, "automatic_activation": False, "public_warning_ready": False,
            "automatic_dispatch_ready": False}
