"""Five-city event intake never promotes CSV rows into validated ground truth."""
import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import data_paths, event_evidence, main
from backend.app.evidence_audit import audit_inventory


def _row(**changes):
    row = {
        "record_id": "record-1", "city_id": "shenzhen", "event_id": "test-event",
        "phenomenon": "rainfall", "site_id": "station-1", "area": "test-area",
        "observed_at": "2026-09-01T10:00:00+08:00",
        "available_at": "2026-09-01T10:10:00+08:00",
        "value": "12.5", "unit": "mm", "datum": "not_applicable",
        "spatial_resolution": "station", "temporal_resolution": "hourly",
        "source_name": "test-source", "source_reference": "test-document-id",
        "license": "test-only", "evidence_level": "observed", "quality_flags": "none",
    }
    row.update(changes)
    return row


def _write(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=event_evidence.CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


class EventEvidenceTest(unittest.TestCase):
    def test_missing_and_valid_file_keep_readiness_false(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(data_paths, "EXTERNAL_DATA", root):
                with self.assertRaises(data_paths.MissingResearchDataError):
                    event_evidence.observations("shenzhen")
                path = root / "cities" / "shenzhen" / "event_evidence.csv"
                _write(path, [_row()])
                result = main.api_region_evidence("shenzhen", "test-event", "rainfall")
                self.assertEqual(result["count"], 1)
                self.assertFalse(result["ground_truth_ready"])
                self.assertFalse(result["forecast_input_ready"])
                self.assertEqual(main.api_region_evidence("shenzhen", "other", None)["count"], 0)
                audit = audit_inventory(bundled_root=root, external_root=root)
                item = next(a for a in audit["assets"] if a["id"] == "shenzhen_event_evidence")
                self.assertEqual(item["audit"]["status"], "structural_checks_passed")

    def test_invalid_units_timing_and_duplicate_grain_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "cities" / "shenzhen" / "event_evidence.csv"
            with patch.object(data_paths, "EXTERNAL_DATA", root):
                for row in (
                    _row(unit="m"),
                    _row(available_at="2026-09-01T09:00:00+08:00"),
                    _row(observed_at="2026-09-01T10:00:00"),
                    _row(phenomenon="tide_level", value="-0.2", unit="m"),
                ):
                    with self.subTest(row=row), self.assertRaises(event_evidence.InvalidEventEvidenceError):
                        _write(path, [row])
                        event_evidence.observations("shenzhen")
                _write(path, [_row(), _row(record_id="record-2")])
                with self.assertRaises(event_evidence.InvalidEventEvidenceError):
                    event_evidence.observations("shenzhen")
                _write(path, [_row(unit="m")])
                audit = audit_inventory(bundled_root=root, external_root=root)
                item = next(a for a in audit["assets"] if a["id"] == "shenzhen_event_evidence")
                self.assertIn("invalid_domain_rows", item["audit"]["issues"])


if __name__ == "__main__":
    unittest.main()
