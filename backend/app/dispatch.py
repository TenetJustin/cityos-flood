# -*- coding: utf-8 -*-
"""Research scenario advisories with local-only history.

This module cannot deliver public warnings or instructions to real facilities.
"""
import os
import json
from collections import deque
import threading

from .risk import RISK_LEVELS

ALERT_LOG = "/tmp/cityos_research_advisories.log"
ALERT_LOG_MAX_BYTES = 5 * 1024 * 1024
_ALERT_LOG_LOCK = threading.Lock()

def recommend(district_id, peak_level, peak_prob, tide_high=False):
    lv = peak_level
    actions = []
    if lv >= 1:
        actions.append("核对泵站台账、实时状态和排涝能力，评估是否需要值守")
    if lv >= 2:
        actions.append("核对低洼点和移动泵车可用量，形成待人工审查的布设备选方案")
    if lv >= 3:
        actions.append("评估泵站运行和道路通行影响；任何实际操作须主管部门现场核验并批准")
    if lv >= 4:
        actions.append("评估跨区资源与避险需求；不得据此直接发布停课停工或撤离通知")
    if tide_high:
        actions.append("核验潮位与闸门运行约束后评估倒灌风险；不得自动操作闸门")
    return actions


def generate_alerts(district_results, times):
    """district_results: list of {id,name,peak_level,peak_prob,peak_index,tide_high}"""
    alerts = []
    for r in district_results:
        if r["peak_level"] >= 3:
            actions = recommend(r["id"], r["peak_level"], r["peak_prob"], r.get("tide_high"))
            alerts.append({
                "severity": r["peak_level"],
                "severity_label": RISK_LEVELS[r["peak_level"]],
                "district": r["name"],
                "district_id": r["id"],
                "time": times[r["peak_index"]] if 0 <= r["peak_index"] < len(times) else None,
                "prob": round(r["peak_prob"], 3),
                "channels": ["研究界面"],
                "external_delivery_ready": False,
                "action_status": "scenario_only",
                "actions": actions,
                "message": (
                    f"{r['name']} 研究情景峰值内涝风险【{RISK_LEVELS[r['peak_level']]}】"
                    f"（代表性水深≥0.15m 的集合概率 {r['peak_prob']*100:.0f}%"
                    + (f"，P50深度 {r['peak_depth_m']:.2f}m" if r.get("peak_depth_m") is not None else "")
                    + "）。以下仅为未核验的处置建议草案。"
                ),
            })
    alerts.sort(key=lambda a: a["severity"], reverse=True)
    return alerts


def record_research_advisory(alert):
    """Keep a local research record; never deliver to a public channel."""
    line = json.dumps(alert, ensure_ascii=False)
    encoded_size = len((line + "\n").encode("utf-8"))
    try:
        with _ALERT_LOG_LOCK:
            current_size = os.path.getsize(ALERT_LOG) if os.path.exists(ALERT_LOG) else 0
            if (
                current_size > 0
                and current_size + encoded_size > ALERT_LOG_MAX_BYTES
            ):
                os.replace(ALERT_LOG, f"{ALERT_LOG}.1")
            with open(ALERT_LOG, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except OSError:
        return "record_failed"
    return "recorded_research_only"


def get_research_advisories(limit=50):
    count = int(limit)
    if count < 1 or count > 200:
        raise ValueError("limit must be between 1 and 200")
    recent = deque(maxlen=count)
    try:
        with _ALERT_LOG_LOCK:
            for path in (f"{ALERT_LOG}.1", ALERT_LOG):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        for line in f:
                            if not line.strip():
                                continue
                            try:
                                recent.append(json.loads(line))
                            except (TypeError, ValueError):
                                continue
                except FileNotFoundError:
                    continue
        return list(recent)
    except OSError:
        return []
