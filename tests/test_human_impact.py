# -*- coding: utf-8 -*-
"""Human Impact Engine validation — 7 required behavioural tests.

1. Higher hazard intensity → affected population never falls (monotone-ish).
2. Equal hazard, high-population area has higher ABSOLUTE affected population.
3. Key road flooded → transport accessibility ↓ / delay ↑ / mobility loss ↑.
4. Hospital unreachable → medical accessibility ↓ / critical service loss ↑.
5. Shelter at capacity → later evacuees re-assigned.
6. After hazard end + recovery → impact ↓ and recovery state → restored.
7. Different hazards produce DIFFERENT dominant behaviours (not one scalar
   times a coefficient): typhoon→stay_home, flood→reroute, earthquake→evacuate.

Runs against the real engine (population base is GHS; hazards use live or
synthetic scenario states as labelled).
"""
import os
import sys
import unittest
import warnings

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
warnings.filterwarnings("ignore")

from backend.app import cascade_model, hazard_adapters, human_impact  # noqa: E402
from backend.app import population_base  # noqa: E402


class HumanImpactValidation(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.cells = population_base.population_grid()["cells"]
        cls.cells_by_id = {c["grid_id"]: c for c in cls.cells}

    # ---- Test 1: intensity ↑ → affected_population not lower --------------
    def test_1_intensity_monotonic_affected(self):
        low = human_impact.human_impact("earthquake", 6, {"mag": 5.5}, use_cache=False)
        mid = human_impact.human_impact("earthquake", 6, {"mag": 6.5}, use_cache=False)
        high = human_impact.human_impact("earthquake", 6, {"mag": 7.5}, use_cache=False)
        a_low = low["aggregate"]["city"]["affected_population"]
        a_mid = mid["aggregate"]["city"]["affected_population"]
        a_high = high["aggregate"]["city"]["affected_population"]
        self.assertGreaterEqual(a_mid, a_low)
        self.assertGreaterEqual(a_high, a_mid)
        self.assertGreater(a_high, 0)

    # ---- Test 2: equal hazard, dense area has more absolute affected -------
    def test_2_dense_area_higher_absolute_affected(self):
        rain = {"rain_48h_mm": 260.0}
        cells = sorted(self.cells, key=lambda c: -c["night_population"])
        dense = cells[0]
        sparse = cells[-1]
        # force the same cell depth proxy by running adapter with same depth
        from backend.app.human_config import WATER_DEPTH_M
        depth = {"futian": 0.35, "luohu": 0.35, "nanshan": 0.35, "baoan": 0.35,
                 "longgang": 0.35, "yantian": 0.35, "longhua": 0.35,
                 "pingshan": 0.35, "guangming": 0.35, "dapeng": 0.35}
        records = hazard_adapters.pluvial_flood_adapter([dense, sparse], 14, depth, {})
        by_id = {r["grid_id"]: r for r in records}
        self.assertGreater(by_id[dense["grid_id"]]["affected_population"],
                           by_id[sparse["grid_id"]]["affected_population"])

    # ---- Test 3: road flooded → transport accessibility ↓ delay ↑ mobility ↑
    def test_3_road_flood_cascade(self):
        cell = next(c for c in self.cells if c["night_population"] > 50000)
        did = cell["district_id"]
        depth_low = dict.fromkeys(["futian", "luohu", "nanshan", "baoan", "longgang",
                                   "yantian", "longhua", "pingshan", "guangming", "dapeng"], 0.12)
        depth_high = dict.fromkeys(depth_low, 0.55)
        records_low = hazard_adapters.pluvial_flood_adapter([cell], 10, depth_low, {})
        records_high = hazard_adapters.pluvial_flood_adapter([cell], 10, depth_high, {})
        lo = records_low[0]
        hi = records_high[0]
        self.assertGreater(hi["average_travel_delay_min"], lo["average_travel_delay_min"])
        self.assertLess(hi["transport_accessibility"], lo["transport_accessibility"])
        self.assertGreater(hi["mobility_disrupted_population"],
                           lo["mobility_disrupted_population"])

    # ---- Test 4: hospital unreachable (MMI high) ---------------------------
    def test_4_medical_access_loss(self):
        cell = next(c for c in self.cells if c["night_population"] > 50000)
        mmi_low = dict.fromkeys(["futian", "luohu", "nanshan", "baoan", "longgang",
                                 "yantian", "longhua", "pingshan", "guangming", "dapeng"], 4.5)
        mmi_high = dict.fromkeys(mmi_low, 7.0)
        low_mmi = hazard_adapters.earthquake_adapter([cell], 12, mmi_low)
        high_mmi = hazard_adapters.earthquake_adapter([cell], 12, mmi_high)
        self.assertLess(high_mmi[0]["medical_accessibility"],
                        low_mmi[0]["medical_accessibility"])
        self.assertGreater(high_mmi[0]["critical_service_loss_population"], 0)
        self.assertGreater(high_mmi[0]["medical_risk_population"], 0)

    # ---- Test 5: shelter overflow re-assignment ----------------------------
    def test_5_shelter_overflow_reassigns(self):
        # two fake records with demands exceeding capacity
        recs = [
            {"district_id": "futian", "shelter_demand": 5_000_000.0,
             "shelter_accessibility": 1.0, "affected_population": 5_000_000,
             "evacuation_population": 5_000_000},
            {"district_id": "luohu", "shelter_demand": 0.0,
             "shelter_accessibility": 1.0, "affected_population": 0.0},
        ]
        fake_cells = [{"district_id": "futian", "night_population": 2_000_000.0},
                      {"district_id": "luohu", "night_population": 2_500_000.0}]
        result = cascade_model.shelter_cascade(recs, fake_cells)
        self.assertGreater(result["overflow_population"], 0)
        self.assertTrue(any(r["from"] == "futian" for r in result["reassignments"]))
        # accessibility of the overflowing district must degrade
        self.assertLess(recs[0]["shelter_accessibility"], 1.0)

    # ---- Test 6: recovery → impact ↓ / state restored ---------------------
    def test_6_recovery_restores(self):
        tl = human_impact.timeline("pluvial_flood",
                                   {"rain_48h_mm": 260.0})
        first = tl["frames"][0]
        last = tl["frames"][-1]
        self.assertGreater(first["affected_population"], 0)
        self.assertEqual(last["recovery_state"], 4)  # restored
        self.assertEqual(last["affected_population"], 0.0)
        self.assertEqual(last["recovery_scale"], 0.0)

    # ---- Test 7: different hazards → different dominant behaviours --------
    def test_7_hazard_specific_behaviour(self):
        typh = human_impact.human_impact("typhoon", 0, {"wind_ms": 34.0}, use_cache=False)
        quake = human_impact.human_impact("earthquake", 0, {"mag": 7.0}, use_cache=False)
        flood = human_impact.human_impact("pluvial_flood", 6, {"rain_48h_mm": 320.0},
                                          use_cache=False)
        # typhoon → stay home; earthquake → evacuate
        self.assertEqual(typh["aggregate"]["dominant_behavior"], "stay_home")
        self.assertEqual(quake["aggregate"]["dominant_behavior"], "evacuate")
        # flood must produce far more reroute/switch than typhoon or quake
        def share(d, action):
            total = sum(d["behavior"]["by_action"].values()) or 1.0
            return d["behavior"]["by_action"].get(action, 0.0) / total
        flood_reroute = share(flood, "reroute") + share(flood, "switch_transport")
        typh_reroute = share(typh, "reroute") + share(typh, "switch_transport")
        quake_reroute = share(quake, "reroute") + share(quake, "switch_transport")
        self.assertGreater(flood_reroute, typh_reroute)
        self.assertGreater(flood_reroute, quake_reroute)
        # quake drives evacuate; typhoon drives stay_home — different mixes
        quake_evac = share(quake, "evacuate") + share(quake, "seek_shelter")
        typh_home = share(typh, "stay_home")
        flood_home = share(flood, "stay_home")
        self.assertGreater(quake_evac, 0.1)
        self.assertGreater(typh_home, flood_home)


if __name__ == "__main__":
    unittest.main(verbosity=2)
