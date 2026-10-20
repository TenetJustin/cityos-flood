"""Weather forecast adapter contract tests without a network or GRIB dependency."""

import copy
import importlib.util
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "frontend/scripts/fetch_zhejiang_forecast.py"
SPEC = importlib.util.spec_from_file_location("fetch_zhejiang_forecast", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def synthetic_messages():
    run = datetime(2026, 10, 19, 6, tzinfo=timezone.utc)
    rows = []
    for step in MODULE.STEPS:
        cities = {city: {"grid_lat": round(centre[0] * 4) / 4, "grid_lon": round(centre[1] * 4) / 4, "value_m": step / 100000} for city, centre in MODULE.CITY_CENTERS.items()}
        rows.append({"model_run_at": MODULE.iso(run), "step_hours": step, "valid_at": MODULE.iso(run + timedelta(hours=step)), "cities": cities})
    return rows


class ForecastTests(unittest.TestCase):
    def test_full_forecast_keeps_model_and_legal_boundaries(self):
        result = MODULE.build_snapshot(synthetic_messages(), "a" * 64, "2026-10-19T19:00:00Z")
        self.assertEqual(result["evidence_type"], "model_inference")
        self.assertEqual(result["forecast_kind"], "weather_only")
        self.assertEqual(result["available_at"], result["retrieved_at"])
        self.assertIsNone(result["issued_at"])
        self.assertEqual(result["source"]["display_unit"], "mm")
        self.assertEqual(len(result["cities"]), 4)
        self.assertEqual(result["cities"][0]["values"][-1]["cumulative_precip_mm"], 0.72)

    def test_incomplete_or_mixed_run_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "lead time"):
            MODULE.build_snapshot(synthetic_messages()[:-1], "a" * 64, "2026-10-19T19:00:00Z")
        mixed = synthetic_messages()
        mixed[1]["model_run_at"] = "2026-10-19T12:00:00Z"
        with self.assertRaisesRegex(ValueError, "mixed model runs"):
            MODULE.build_snapshot(mixed, "a" * 64, "2026-10-19T19:00:00Z")

    def test_stale_invalid_and_distant_grid_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "stale"):
            MODULE.build_snapshot(synthetic_messages(), "a" * 64, "2026-10-21T19:00:00Z")
        changed = copy.deepcopy(synthetic_messages())
        changed[2]["cities"]["ningbo"]["grid_lat"] = 0
        with self.assertRaisesRegex(ValueError, "grid cell mismatch"):
            MODULE.build_snapshot(changed, "a" * 64, "2026-10-19T19:00:00Z")

    def test_checked_in_real_snapshot_is_weather_only(self):
        snapshot = json.loads((ROOT / "frontend/public/data/zhejiang-weather-forecast.json").read_text(encoding="utf-8"))
        self.assertEqual(snapshot["state"], "ok")
        self.assertEqual(snapshot["evidence_type"], "model_inference")
        self.assertEqual({city["city_id"] for city in snapshot["cities"]}, set(MODULE.CITY_CENTERS))
        self.assertTrue(all(len(city["values"]) == 5 for city in snapshot["cities"]))


if __name__ == "__main__":
    unittest.main()
