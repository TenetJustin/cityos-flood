"""Research inputs must be declared before a capability can claim readiness."""
import tempfile
import unittest
import csv
from pathlib import Path
from unittest.mock import patch

from backend.app import data_paths, knowledge, region, realworld_response


class ResearchBoundaryTest(unittest.TestCase):
    def test_missing_input_is_reported_with_relative_name(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(data_paths, "EXTERNAL_DATA", Path(directory)):
                status = data_paths.research_data_status()
                self.assertFalse(status["required_inputs_present"]["human_impact"])
                self.assertFalse(status["required_inputs_present"]["tide_harmonics"])
                with self.assertRaises(data_paths.MissingResearchDataError) as raised:
                    data_paths.require_external("unified", "tide_timeseries.csv")
                self.assertEqual(raised.exception.dataset,
                                 "unified/tide_timeseries.csv")

    def test_city_catalog_does_not_claim_unbuilt_models(self):
        catalog = region.city_catalog()
        self.assertEqual([c["id"] for c in catalog["cities"]],
                         ["shanghai", "ningbo", "fuzhou", "shenzhen", "haikou"])
        self.assertTrue(all(not c["operational_warning_ready"]
                            for c in catalog["cities"]))
        self.assertEqual(sum(c["implementation_status"] == "research_prototype"
                             for c in catalog["cities"]), 1)

    def test_model_archive_identifies_historical_metrics(self):
        archive = knowledge.model_archive()
        self.assertEqual(len(archive["models"]), 3)
        self.assertTrue(all(model["metric_status"] ==
                            "archived_reported_not_currently_recomputed"
                            for model in archive["models"]))
        self.assertTrue(all(isinstance(model["artifact_available"], bool)
                            for model in archive["models"]))

    def test_response_intake_requires_source_and_aware_times(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(data_paths, "EXTERNAL_DATA", Path(directory)):
                with self.assertRaises(data_paths.MissingResearchDataError):
                    realworld_response.observations("shenzhen")
                path = Path(directory) / "cities" / "shenzhen" / "responses.csv"
                path.parent.mkdir(parents=True)
                row = {
                    "city_id": "shenzhen", "event_id": "test-event",
                    "actor_type": "emergency_department", "action_type": "road_closure",
                    "action_status": "reported", "observed_at": "2026-09-01T10:00:00+08:00",
                    "available_at": "2026-09-01T10:15:00+08:00", "area": "test-area",
                    "source_name": "test-source", "source_reference": "test-document-id",
                    "evidence_level": "official_record", "affected_count": "",
                }
                with path.open("w", encoding="utf-8", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=realworld_response.CSV_FIELDS)
                    writer.writeheader()
                    writer.writerow(row)
                result = realworld_response.observations("shenzhen", "test-event")
                self.assertEqual(result["count"], 1)
                self.assertFalse(result["model_feedback_ready"])
                row["observed_at"] = "2026-09-01T10:00:00"
                with path.open("w", encoding="utf-8", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=realworld_response.CSV_FIELDS)
                    writer.writeheader()
                    writer.writerow(row)
                with self.assertRaises(realworld_response.InvalidResponseDataError):
                    realworld_response.observations("shenzhen")


if __name__ == "__main__":
    unittest.main()
