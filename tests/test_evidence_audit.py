"""The evidence audit must distinguish a file from validated city evidence."""
import csv
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
