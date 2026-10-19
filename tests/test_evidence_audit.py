"""The evidence audit must distinguish a file from validated city evidence."""
import csv
import json
import tempfile
import unittest
from pathlib import Path

from backend.app.evidence_audit import audit_csv, audit_inventory


class EvidenceAuditTest(unittest.TestCase):
    def test_missing_assets_do_not_make_city_operational(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = audit_inventory(bundled_root=root, external_root=root)
            self.assertEqual(len(result["cities"]), 5)
            self.assertFalse(result["operational_warning_ready"])
            self.assertTrue(all(asset["audit"]["status"] == "missing"
                                for asset in result["assets"]))
            self.assertEqual(result["event_manifests"][0]["event_id"],
                             "2023-09-07-shenzhen-extreme-rain")
            self.assertEqual(result["event_manifests"][0]["audit"]["status"], "missing")
            self.assertEqual(result["manifest_coverage_by_city"]["shenzhen"],
                             {"listed": 1, "structural_checks_passed": 0})

    def test_manifest_audit_counts_evidence_and_missing_without_promoting_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "cities/ningbo/events/event-one/manifest.json"
            path.parent.mkdir(parents=True)
            shared = {
                "timezone": "Asia/Shanghai",
                "spatial": {
                    "geometry_or_area": "station A", "horizontal_crs": "EPSG:4326",
                    "spatial_resolution": "station",
                },
                "source": {
                    "publisher": "source agency", "source_name": "source archive",
                    "source_reference": "archive-1",
                    "retrieved_at": "2026-10-19T10:00:00+08:00",
                    "license_id": "terms-review-required",
                },
            }
            manifest = {
                "schema_version": "1.0", "event_id": "event-one", "city_id": "ningbo",
                "event_name": "Test event", "event_start": "2023-09-07T00:00:00+08:00",
                "event_end": "2023-09-08T00:00:00+08:00", "timezone": "Asia/Shanghai",
                "trigger_summary": "test only", "records": [
                    {**shared, "record_id": "r1", "phenomenon": "rainfall",
                     "evidence_class": "observation", "observed_at": "2023-09-07T10:00:00+08:00",
                     "available_at": "2023-09-07T10:05:00+08:00", "value": 10.0,
                     "unit": "mm", "quality_flags": ["quality_controlled"]},
                    {**shared, "record_id": "r2", "phenomenon": "flood_depth",
                     "evidence_class": "missing", "value": None, "unit": "unknown",
                     "quality_flags": ["unknown"], "missing_status": "not_acquired",
                     "missing_reason": "not in project archive"},
                ],
            }
            path.write_text(json.dumps(manifest), encoding="utf-8")
            result = audit_inventory(bundled_root=root, external_root=root)
            item = next(item for item in result["event_manifests"]
                        if item["city_id"] == "ningbo")
            self.assertEqual(item["audit"]["status"], "structural_checks_passed")
            self.assertEqual(item["audit"]["evidence_class_counts"]["observation"], 1)
            self.assertEqual(item["audit"]["missing_by_phenomenon"], {"flood_depth": 1})
            self.assertEqual(item["audit"]["quality_controlled_observation_count"], 1)
            self.assertEqual(item["audit"]["license_review_record_count"], 2)
            self.assertFalse(item["audit"]["ground_truth_ready"])
            self.assertEqual(result["manifest_coverage_by_city"]["ningbo"],
                             {"listed": 1, "structural_checks_passed": 1})

    def test_manifest_path_identity_mismatch_is_not_structural_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "cities/shanghai/events/wrong/manifest.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({
                "schema_version": "1.0", "event_id": "different",
                "city_id": "shanghai", "event_name": "Test event",
                "event_start": "2023-09-07T00:00:00+08:00",
                "event_end": "2023-09-08T00:00:00+08:00",
                "timezone": "Asia/Shanghai", "trigger_summary": "test only",
                "records": [],
            }), encoding="utf-8")
            result = audit_inventory(bundled_root=root, external_root=root)
            item = next(item for item in result["event_manifests"]
                        if item["city_id"] == "shanghai")
            self.assertEqual(item["audit"]["status"], "structural_issues")
            self.assertEqual(item["audit"]["issues"], ["path_identity_mismatch"])

    def test_duplicate_missing_value_and_naive_time_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "observations.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["station", "time", "value"])
                writer.writeheader()
                writer.writerows([
                    {"station": "A", "time": "2026-08-19T00:00:00", "value": "1"},
                    {"station": "A", "time": "2026-08-19T00:00:00", "value": ""},
                ])
            result = audit_csv(path, required=["station", "time", "value"],
                               key=["station", "time"], time_field="time")
            self.assertEqual(result["status"], "structural_issues")
            self.assertEqual(result["duplicate_keys"], 1)
            self.assertEqual(result["missing_required_values"]["value"], 1)
            self.assertEqual(result["timezone_missing"], 2)

    def test_response_release_before_event_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "responses.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["city_id", "observed_at",
                                                            "available_at"])
                writer.writeheader()
                writer.writerow({"city_id": "shenzhen",
                                 "observed_at": "2026-09-01T10:00:00+08:00",
                                 "available_at": "2026-09-01T09:00:00+08:00"})
            result = audit_csv(path, required=["city_id", "observed_at", "available_at"],
                               response_city="shenzhen")
            self.assertIn("available_before_observed", result["issues"])


if __name__ == "__main__":
    unittest.main()
