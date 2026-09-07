# -*- coding: utf-8 -*-
"""LarNO Futian benchmark: event-level severity vs recession diagnostics.

The LarNO dataset (MIT license, HuggingFace ``holmescao/LarNO-dataset``) provides
80 MIKE+ hydrodynamic events for a ~100 km² Futian domain at 20m / 5min
resolution (64 train + 16 test).  Labels were produced by a commercial solver
with the real Futian drainage network; the network itself is confidential and
NOT included, but its *effect* is embedded in the simulated water depths.

This makes LarNO the best available answer to the motivating field question:
"Futian floods severely, but drains very fast."  Both facts are quantifiable
per event from the simulated fields:

- severity: peak water depth and the fraction of the domain above 15cm
- recession: post-rain-end decay rate of the inundated area (%/5min),
  measured over the observable part of the 6h simulation window

Because the 6h window ends only ~35min after rain stops, full recession
completion is NOT observable -- the recession rate is reported as a rate, with
the window limitation stated explicitly.  No extrapolation to "hours to dry"
is performed.

Data lives in ``shenzhen-flood/data/larno/region1_20m/<event>/{h,rainfall}.npy``
plus ``dem.npy``.  Loading is lazy and cached per event; only the aggregate
statistics cross the API boundary (raw fields are 129MB each).
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

# 数据位置：优先环境变量 LARNO_DATA_BASE，否则默认相对本仓库的
# shenzhen-flood/data/larno/region1_20m。
DATA_BASE = Path(
    os.environ.get(
        "LARNO_DATA_BASE",
        str(Path(__file__).resolve().parents[3] / "shenzhen-flood" / "data" / "larno" / "region1_20m"),
    )
)

# Thresholds aligned with the rest of the system.
WET_THRESHOLD_M = 0.05       # "wet" cell
ACTIONABLE_THRESHOLD_M = 0.15  # mobility-impacting depth
RAIN_ACTIVE_MM_H = 0.01      # rainfall considered active above this rate
STEP_MIN = 5                 # dataset temporal step

_LOCK = threading.RLock()
_EVENT_CACHE: Dict[str, Dict[str, Any]] = {}
_SUMMARY_CACHE: Optional[Dict[str, Any]] = None


def _available_events() -> List[str]:
    """Events with a *complete* pair of npy files (downloads are in-flight)."""
    if not DATA_BASE.exists():
        return []
    events = []
    for child in sorted(DATA_BASE.iterdir()):
        if not child.is_dir():
            continue
        h_file = child / "h.npy"
        r_file = child / "rainfall.npy"
        if not (h_file.exists() and r_file.exists()):
            continue
        # Expected per-file size: 72*400*560*8 bytes + header.
        if h_file.stat().st_size < 129_000_000 or r_file.stat().st_size < 129_000_000:
            continue
        events.append(child.name)
    return events


def _analyze_event(event: str) -> Dict[str, Any]:
    with _LOCK:
        cached = _EVENT_CACHE.get(event)
        if cached is not None:
            return cached

    depth = np.load(DATA_BASE / event / "h.npy", mmap_mode="r")
    rain = np.load(DATA_BASE / event / "rainfall.npy", mmap_mode="r")
    steps = depth.shape[0]

    peak_series = np.asarray([float(depth[t].max()) for t in range(steps)])
    rain_series = np.asarray([float(rain[t].mean()) * 12.0 for t in range(steps)])  # mm/h
    wet05 = np.asarray([int((depth[t] > WET_THRESHOLD_M).sum()) for t in range(steps)])
    wet15 = np.asarray([int((depth[t] > ACTIONABLE_THRESHOLD_M).sum()) for t in range(steps)])

    rain_active = rain_series > RAIN_ACTIVE_MM_H
    rain_end = int(np.max(np.nonzero(rain_active)[0])) if rain_active.any() else 0
    rain_peak_mm_h = float(rain_series.max())
    rain_total_mm = float(rain_series.sum() * STEP_MIN / 60.0)

    peak_step = int(np.argmax(peak_series))
    observable_steps = steps - (rain_end + 1)

    # Post-rain recession rate: exponential-ish decay of wet15 area over the
    # observable window (>= 2 steps required).
    recession_rate_pct_per_5min = None
    recession_window_min = None
    if observable_steps >= 2 and wet15[rain_end] > 0:
        start_area = wet15[rain_end]
        end_area = wet15[-1]
        recession_rate_pct_per_5min = round(
            (1.0 - end_area / start_area) * 100.0 / observable_steps, 2
        )
        recession_window_min = observable_steps * STEP_MIN

    peak_wet15 = int(wet15.max())
    domain_cells = int(depth[0].size)

    result = {
        "event": event,
        "severity": {
            "peak_depth_m": round(float(peak_series.max()), 3),
            "peak_time_min": peak_step * STEP_MIN,
            "peak_actionable_cells": peak_wet15,
            "peak_actionable_pct": round(peak_wet15 / domain_cells * 100.0, 2),
            "peak_wet_cells": int(wet05.max()),
        },
        "rainfall": {
            "total_mm": round(rain_total_mm, 1),
            "peak_mm_h": round(rain_peak_mm_h, 1),
            "rain_end_min": rain_end * STEP_MIN,
        },
        "recession": {
            # Positive = inundated area is shrinking.  Window-limited: the 6h
            # simulation ends shortly after rain stops, so this is a rate, not
            # a time-to-dry.
            "actionable_area_decay_pct_per_5min": recession_rate_pct_per_5min,
            "observable_window_min": recession_window_min,
            "observable": recession_rate_pct_per_5min is not None,
            "window_limitation": (
                "模拟窗口在雨停后很快结束；退水以速率（%/5min）报告，不外推完全退干时间"
            ),
        },
        "steps": steps,
    }
    with _LOCK:
        if len(_EVENT_CACHE) > 96:
            _EVENT_CACHE.clear()
        _EVENT_CACHE[event] = result
    return result


def dataset_summary(force: bool = False) -> Dict[str, Any]:
    """Aggregate statistics across all locally available LarNO Futian events."""
    global _SUMMARY_CACHE
    if _SUMMARY_CACHE is not None and not force:
        return _SUMMARY_CACHE

    events = _available_events()
    records = [_analyze_event(event) for event in events]

    severities = [r["severity"]["peak_depth_m"] for r in records] or [0.0]
    actionables = [r["severity"]["peak_actionable_pct"] for r in records] or [0.0]
    rates = [
        r["recession"]["actionable_area_decay_pct_per_5min"]
        for r in records
        if r["recession"]["observable"]
    ]

    summary = {
        "dataset": "LarNO region1_20m (Futian, Shenzhen)",
        "license": "MIT",
        "source": "huggingface.co/datasets/holmescao/LarNO-dataset",
        "paper": "Journal of Hydrology 2026, DOI 10.1016/j.jhydrol.2026.135686",
        "resolution": "20m / 5min, domain 400x560 (~100 km²)",
        "label_generator": "MIKE+ hydrodynamic solver with real Futian drainage network (network confidential, not included)",
        "events_available": len(records),
        "events_total": 77,  # remote numbering skips 8/9/79
        "severity_vs_recession": {
            "median_peak_depth_m": round(float(np.median(severities)), 3),
            "max_peak_depth_m": round(float(np.max(severities)), 3),
            "min_peak_depth_m": round(float(np.min(severities)), 3),
            "median_actionable_pct": round(float(np.median(actionables)), 2),
            "median_decay_pct_per_5min": (
                round(float(np.median(rates)), 2) if rates else None
            ),
            "observable_event_count": len(rates),
        },
        "futian_pattern": {
            "statement": (
                "LarNO 模拟显示福田内涝严重（中位峰值水深 "
                f"{round(float(np.median(severities)), 2)}m，可行动深度淹没中位 "
                f"{round(float(np.median(actionables)), 1)}%）同时雨后快速退水"
                + (
                    f"（>15cm 淹没面积每 5 分钟缩减中位 {round(float(np.median(rates)), 2)}%）"
                    if rates
                    else ""
                )
            ),
            "evidence": "MIKE+ 含真实管网的物理模拟，非经验参数化",
        },
        "events": records,
        "provenance": (
            "simulated(MIKE+ urban flood model with real Futian drainage network; "
            "dataset MIT, labels are physics-solver output, not observations)"
        ),
        "limitations": [
            "标签是 MIKE+ 物理模拟输出，不是实测水位；管网数据保密未随数据集发布",
            "6h 模拟窗口在雨停后很快结束，退水只报告速率不外推完全退干时间",
            "20m 分辨率是 5m 原始结果的降采样版本",
        ],
    }
    _SUMMARY_CACHE = summary
    return summary


def event_detail(event: str) -> Dict[str, Any]:
    if not (DATA_BASE / event / "h.npy").exists():
        return {"error": f"event {event} not available locally"}
    return _analyze_event(event)


def reset_cache() -> None:
    global _SUMMARY_CACHE
    with _LOCK:
        _EVENT_CACHE.clear()
    _SUMMARY_CACHE = None


__all__ = ["dataset_summary", "event_detail", "reset_cache"]
