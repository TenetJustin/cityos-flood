#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Debug: replicate swmmanywhere flow with per-stage graph dumps."""
import os
import sys
import types
from pathlib import Path

_stub = types.ModuleType("pyswmm")
for _attr in ("Simulation", "Nodes", "Links", "Subcatchments",
              "Node", "Link", "Subcatchment", "Output"):
    setattr(_stub, _attr, lambda *a, **k: (_ for _ in ()).throw(RuntimeError("stub")))
_stub.__version__ = "stub"
sys.modules["pyswmm"] = _stub

os.environ.setdefault("SWMMANYWHERE_VERBOSE", "true")

from swmmanywhere import filepaths, parameters, preprocessing, swmmanywhere as swm
from swmmanywhere.graph_utilities import graphfcns
from swmmanywhere.utilities import save_graph

config = swm.load_config(Path(sys.argv[1]))
config["run_model"] = False
config.setdefault("graphfcn_list", [
    "assign_id", "fix_geometries", "remove_non_pipe_allowable_links",
    "calculate_streetcover", "remove_parallel_edges", "to_undirected",
    "split_long_edges", "merge_street_nodes", "assign_id",
    "clip_to_catchments", "calculate_contributing_area", "set_elevation",
    "double_directed", "fix_geometries", "set_surface_slope",
    "set_chahinian_slope", "set_chahinian_angle", "calculate_weights",
    "identify_outfalls", "derive_topology", "pipe_by_pipe",
    "fix_geometries", "assign_id",
])
addresses = filepaths.FilePaths(
    config["base_dir"], config["project"], config["bbox"],
    **config.get("address_overrides", {}),
)
params = parameters.get_full_parameters()
preprocessing.run_downloads(config["bbox"], addresses,
                            network_types=params["topology_derivation"].allowable_networks)
G = preprocessing.create_starting_graph(addresses)
print("starting graph nodes:", G.number_of_nodes(), "edges:", G.number_of_edges(), flush=True)

fcns = graphfcns
for i, fn in enumerate(config["graphfcn_list"]):
    G = fcns[fn](G, addresses=addresses, **params)
    save_graph(G, Path(f"/tmp/dbg_{fn}.json"))
    print(f"[{i}] {fn} done — nodes={G.number_of_nodes()} edges={G.number_of_edges()}", flush=True)
    if fn == "identify_outfalls":
        # inspect id types
        ids = [n for n in G.nodes]
        types_ = {type(n).__name__ for n in ids[:2000]}
        print("   node id types:", types_, "| sample:", ids[:6], flush=True)
        of = [u for u, v, d in G.edges(data=True) if d.get("edge_type") == "outfall"]
        print("   outfall node count:", len(of), "| types:", {type(x).__name__ for x in of},
              "| in graph:", sum(1 for x in of if x in G), "/", len(of), flush=True)
        miss = [x for x in of if x not in G][:10]
        print("   missing outfall sample:", miss, "| str nodes present:", [str(m) in G for m in miss[:3]], flush=True)
print("ALL STAGES OK", flush=True)
