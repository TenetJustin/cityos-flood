#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Run SWMManywhere synthesis without loading the native SWMM solver.

The machine's security environment SIGKILLs any process that imports
pyswmm -> swmm.toolkit._solver (native lib).  Network synthesis itself
never needs the solver -- only `run_model: true` and the metrics do.
So we stub pyswmm before importing swmmanywhere.swmmanywhere and force
run_model=False.
"""
import os
import sys
import types

# --- pyswmm stub -----------------------------------------------------------
_stub = types.ModuleType("pyswmm")


def _unavailable(name):
    def _raise(*a, **k):
        raise RuntimeError(
            f"pyswmm.{name} was called, but pyswmm is stubbed out "
            "(native SWMM solver cannot load in this environment). "
            "Only run_model=true needs the real pyswmm."
        )

    return _raise


for _attr in ("Simulation", "Nodes", "Links", "Subcatchments",
              "Node", "Link", "Subcatchment", "Output"):
    setattr(_stub, _attr, _unavailable(_attr))
_stub.__version__ = "stub"
sys.modules["pyswmm"] = _stub

# --- run -------------------------------------------------------------------
from swmmanywhere import swmmanywhere as swm  # noqa: E402

from pathlib import Path

config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("config_sz_futian_test.yml")
config = swm.load_config(config_path)
config["run_model"] = False

print(">>> config:", config.get("project"), config.get("bbox"), flush=True)
inp, metrics = swm.swmmanywhere(config)
print(">>> DONE inp:", inp, flush=True)
