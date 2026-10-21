"""Actual EPA SWMM execution on explicitly synthetic Zhejiang microcatchments.

SWMM solves runoff, pipe routing and node ponding. Node ponding is NOT a 2D
inundation extent, surveyed city model, trained forecast, or observed response.
This module is separate from all real-observation stores and API capabilities.
"""
from __future__ import annotations

import ctypes as C
import hashlib
import json
import math
from datetime import datetime, timedelta
from pathlib import Path

MODEL_VERSION = "epa-swmm-5.2.4-synthetic-v1"
SOURCE_COMMIT = "7952ca837988b1c32f791812eccc9fd64547e093"
START = datetime(2000, 1, 1)  # Internal solver clock only; not an event date.


def make_inp(dataset, city_id, *, rain_scale=1.0, pipe_scale=1.0, dry_boundary=False):
    """25 independent drainage microcatchments; all dimensions are assumptions.

    Depth = max(node hydraulic head - synthetic ground elevation, 0).
    A 2 m deep junction with 10,000 m² ponding area drains a 4 ha catchment.
    Synthetic tide/river indices are converted to a *declared local boundary*,
    not passed off as physical observations. Every outfall has a flap gate.
    """
    if not 0 <= rain_scale <= 3 or not .25 <= pipe_scale <= 3:
        raise ValueError("scenario multipliers outside validated demonstration range")
    points = [p for p in dataset["points"] if p["city_id"] == city_id]
    rows = sorted([r for r in dataset["timeline"] if r["city_id"] == city_id], key=lambda r: r["hour"])
    if len(points) != 25 or [r["hour"] for r in rows] != list(range(73)):
        raise ValueError("complete 25-point/73-hour city input required")
    text = ["[TITLE]", "CityOS SYNTHETIC microcatchments; NOT a calibrated city network",
            "[OPTIONS]", "FLOW_UNITS CMS", "INFILTRATION HORTON", "FLOW_ROUTING DYNWAVE",
            "START_DATE 01/01/2000", "START_TIME 00:00:00", "END_DATE 01/04/2000", "END_TIME 01:00:00",
            "REPORT_START_DATE 01/01/2000", "REPORT_START_TIME 00:00:00", "REPORT_STEP 01:00:00",
            "WET_STEP 00:01:00", "DRY_STEP 00:05:00", "ROUTING_STEP 10", "ALLOW_PONDING YES",
            "VARIABLE_STEP 0.75", "MIN_SURFAREA 1.167", "[RAINGAGES]", "RG INTENSITY 1:00 1.0 TIMESERIES RAIN",
            "[SUBCATCHMENTS]"]
    for i, p in enumerate(points):
        text.append(f"S{i} RG J{i} 4 {p['imperviousness_index']*100:.3f} 180 0.5 0")
    text += ["[SUBAREAS]"] + [f"S{i} 0.015 0.15 1.5 4 25 OUTLET" for i in range(25)]
    text += ["[INFILTRATION]"] + [f"S{i} 60 5 4 7 0" for i in range(25)]
    text += ["[JUNCTIONS]"] + [f"J{i} {p['relative_elevation_m']-2:.3f} 2 0 0 10000" for i, p in enumerate(points)]
    text += ["[OUTFALLS]"] + [f"O{i} {p['relative_elevation_m']-2.4:.3f} TIMESERIES B{i} YES" for i, p in enumerate(points)]
    text += ["[CONDUITS]"] + [f"C{i} J{i} O{i} 180 0.016 0 0 0 0" for i in range(25)]
    text += ["[XSECTIONS]"] + [f"C{i} CIRCULAR {(0.25 + .35*p['drainage_capacity_index'])*pipe_scale:.4f} 0 0 0 1" for i, p in enumerate(points)]
    text += ["[TIMESERIES]"]
    for r in rows:
        at = START + timedelta(hours=r["hour"])
        text.append(f"RAIN {at:%m/%d/%Y %H:%M} {r['rainfall_rate_mm_h']*rain_scale:.6f}")
    for i, p in enumerate(points):
        for r in rows:
            at = START + timedelta(hours=r["hour"])
            stage = p['relative_elevation_m'] - 2.3 + .8*r['tide_index']*p['coastal_exposure_index'] + .6*r['river_level_index']*p['river_exposure_index']
            if dry_boundary:
                stage = p['relative_elevation_m'] - 2.4
            text.append(f"B{i} {at:%m/%d/%Y %H:%M} {stage:.6f}")
    text += ["[REPORT]", "INPUT NO", "CONTINUITY YES", "FLOWSTATS YES", "SUBCATCHMENTS ALL", "NODES ALL", "LINKS ALL"]
    return "\n".join(text) + "\n", points


class SwmmEngine:
    """Thin ABI binding to the unmodified official C API, not a substitute solver.

    SWMM is process-global. Call serially or isolate each worker in a process.
    """
    def __init__(self, library):
        self.lib = C.CDLL(str(Path(library).resolve()))
        self.lib.swmm_open.argtypes = [C.c_char_p] * 3
        self.lib.swmm_getIndex.argtypes = [C.c_int, C.c_char_p]
        self.lib.swmm_getValue.argtypes = [C.c_int, C.c_int]
        self.lib.swmm_getValue.restype = C.c_double
        self.lib.swmm_stride.argtypes = [C.c_int, C.POINTER(C.c_double)]
        self.lib.swmm_getMassBalErr.argtypes = [C.POINTER(C.c_float)] * 3
        self.version = self.lib.swmm_getVersion()
        if self.version != 52004:
            raise ValueError(f"expected EPA SWMM 5.2.4, got {self.version}")

    def run(self, inp, points, workdir):
        workdir = Path(workdir)
        workdir.mkdir(parents=True, exist_ok=True)
        paths = [workdir / f"model.{suffix}" for suffix in ("inp", "rpt", "out")]
        paths[0].write_text(inp)
        result = {p["id"]: [] for p in points}
        opened = False
        def check(code):
            if code:
                raise RuntimeError(f"SWMM error {code}; inspect {paths[1]}")
        try:
            opened = True
            check(self.lib.swmm_open(*[str(p).encode() for p in paths]))
            check(self.lib.swmm_start(1))
            indexes = [self.lib.swmm_getIndex(2, f"J{i}".encode()) for i in range(len(points))]
            if min(indexes) < 0:
                raise RuntimeError("SWMM node mapping failed")
            # Sample exact hour boundaries via stride, not nearest routing step.
            for hour in range(73):
                if hour:
                    elapsed = C.c_double()
                    check(self.lib.swmm_stride(3600, C.byref(elapsed)))
                    if abs(elapsed.value * 24 - hour) > 1e-5:
                        raise RuntimeError("SWMM elapsed clock disagrees with output hour")
                for p, index in zip(points, indexes):
                    head = self.lib.swmm_getValue(304, index)
                    depth = max(0, head - p["relative_elevation_m"])
                    if not math.isfinite(depth):
                        raise RuntimeError("nonfinite solver output")
                    result[p["id"]].append(round(depth * 100, 2))
            check(self.lib.swmm_end())
            runoff, routing, quality = C.c_float(), C.c_float(), C.c_float()
            check(self.lib.swmm_getMassBalErr(C.byref(runoff), C.byref(routing), C.byref(quality)))
            check(self.lib.swmm_report())
            balance = {"runoff_error_pct": round(runoff.value, 5), "routing_error_pct": round(routing.value, 5)}
            if max(abs(runoff.value), abs(routing.value)) > 1:
                raise RuntimeError(f"continuity exceeds 1% gate: {balance}")
            return {"depth_cm_by_point": result, "continuity": balance,
                    "input_sha256": hashlib.sha256(inp.encode()).hexdigest(),
                    "report_sha256": hashlib.sha256(paths[1].read_bytes()).hexdigest()}
        finally:
            if opened:
                self.lib.swmm_close()


def allocate_resources(points, depths, *, teams=8):
    """NetworkX max-flow/min-cost capacity assignment; not dispatch or routing.

    Two fictional depots can each send at most half the available teams. All
    microzones have hypothetical access. No safe road route is claimed. One
    team per wet point, at most two at >=60cm. Integer cost trades priority and
    planar distance, and any unmet demand stays explicit.
    """
    import networkx as nx
    if type(teams) is not int or teams < 0:
        raise ValueError("team capacity must be a nonnegative integer")
    graph = nx.DiGraph()
    graph.add_nodes_from(["source", "sink"])
    demand = {}
    for i, x in enumerate((-8, 8)):
        depot = f"depot-{i+1}"
        graph.add_edge("source", depot, capacity=teams//2 + (teams%2 if i == 0 else 0), weight=0)
        for p in points:
            depth = depths[p["id"]]
            need = 2 if depth >= 60 else 1 if depth >= 8 else 0
            demand[p["id"]] = need
            priority_cost = 0 if depth >= 60 else 10000 if depth >= 30 else 20000
            distance_cost = round(math.hypot(p["terrain_x"]-x, p["terrain_z"])*10)
            graph.add_edge(depot, p["id"], capacity=need, weight=priority_cost+distance_cost)
    for pid, need in demand.items():
        graph.add_edge(pid, "sink", capacity=need, weight=0)
    flow = nx.max_flow_min_cost(graph, "source", "sink")
    assignments = [{"depot_id": depot, "point_id": pid, "teams": n}
                   for depot in ("depot-1", "depot-2") for pid, n in flow[depot].items() if n]
    assigned = sum(a["teams"] for a in assignments)
    return {"algorithm": "networkx-max-flow-min-cost", "available_teams": teams,
            "required_teams": sum(demand.values()), "assigned_teams": assigned,
            "unmet_teams": sum(demand.values())-assigned, "assignments": assignments,
            "status": "pending-human-review", "access_assumption": "all_microzones_reachable_not_route_verified",
            "evidence_type": "simulated_scenario", "automatic_dispatch_ready": False}
