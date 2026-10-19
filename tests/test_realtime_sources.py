"""The source registry must expose candidates without promoting readiness."""
import unittest

from fastapi import HTTPException

from backend.app import main, realtime_sources


class RealtimeSourceRegistryTest(unittest.TestCase):
    def test_all_cities_are_covered_but_none_are_live_ready(self):
        result = realtime_sources.source_catalog()
        self.assertEqual(
            set(result["coverage"]),
            {"shanghai", "ningbo", "fuzhou", "shenzhen", "haikou"},
        )
        self.assertEqual(result["eligible_realtime_source_count"], 0)
        self.assertEqual(result["status"], "registry_only_no_live_five_city_feed")
        self.assertTrue(all(
            not city["realtime_analysis_ready"]
            for city in result["coverage"].values()
        ))
        for flag in (
            "forecast_input_ready", "model_assimilation_ready",
            "public_warning_ready", "automatic_dispatch_ready",
        ):
            self.assertFalse(result[flag])

    def test_shenzhen_candidates_preserve_known_blockers(self):
        result = realtime_sources.source_catalog(city_id="shenzhen")
        by_id = {item["source_id"]: item for item in result["sources"]}
        waterlevel = by_id["shenzhen-waterlogging-level"]
        self.assertEqual(waterlevel["access_state"], "access_confirmed")
        self.assertEqual(waterlevel["adapter_status"], "legacy_unreviewed")
        self.assertEqual(waterlevel["schema_mapping_status"], "blocked")
        self.assertIn(
            "raw_level_not_proven_equivalent_to_flood_depth",
            waterlevel["blockers"],
        )
        self.assertFalse(waterlevel["realtime_observation_eligible"])

    def test_filters_do_not_invent_coverage(self):
        rainfall = realtime_sources.source_catalog(phenomenon="rainfall")
        self.assertEqual(
            {item["source_id"] for item in rainfall["sources"]},
            {
                "shenzhen-ground-weather-observation",
                "shenzhen-reservoir-rainfall",
            },
        )
        self.assertEqual(rainfall["coverage"]["shanghai"]["registered_entries"], 0)
        self.assertEqual(rainfall["coverage"]["shenzhen"]["dataset_candidates"], 2)

    def test_api_rejects_unknown_city_or_phenomenon(self):
        self.assertIn("/api/realtime/sources", main.app.openapi()["paths"])
        for kwargs in (
            {"city_id": "guangzhou"},
            {"phenomenon": "pipe_level"},
        ):
            with self.assertRaises(HTTPException) as raised:
                main.api_realtime_sources(**kwargs)
            self.assertEqual(raised.exception.status_code, 422)

    def test_every_entry_has_provenance_and_no_operational_capability(self):
        result = main.api_realtime_sources()
        ids = [item["source_id"] for item in result["sources"]]
        self.assertEqual(len(ids), len(set(ids)))
        for item in result["sources"]:
            self.assertTrue(item["source_reference"].startswith("https://"))
            self.assertTrue(item["blockers"])
            self.assertFalse(item["realtime_observation_eligible"])
            self.assertFalse(item["forecast_input_ready"])
            self.assertFalse(item["model_assimilation_ready"])
            self.assertFalse(item["public_warning_ready"])
            self.assertFalse(item["automatic_dispatch_ready"])


if __name__ == "__main__":
    unittest.main()

