import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from backend.app import data_paths
from backend.app.evidence_contract import (
    EVIDENCE_CLASSES,
    EventManifest,
    InvalidEventManifestError,
    load_manifest,
)


def _source():
    return {
        "publisher": "test publisher",
        "source_name": "test source",
        "source_reference": "https://example.invalid/source",
        "retrieved_at": "2026-10-19T10:00:00+08:00",
        "license_id": "terms-review-required",
        "redistribution_allowed": None,
    }


def _record(record_id="r1", **changes):
    record = {
        "record_id": record_id,
        "phenomenon": "rainfall",
        "evidence_class": "observation",
        "observed_at": "2023-09-07T20:00:00+08:00",
        "available_at": "2023-09-07T20:10:00+08:00",
        "timezone": "Asia/Shanghai",
        "spatial": {
            "geometry_or_area": "station-1", "horizontal_crs": "EPSG:4326",
            "vertical_datum": None, "spatial_resolution": "station",
        },
        "value": 12.5,
        "unit": "mm/h",
        "source": _source(),
        "quality_flags": ["provisional", "source_not_independently_verified"],
        "missing_status": "present",
    }
    record.update(changes)
    return record


def _manifest(records):
    return {
        "schema_version": "1.0",
        "event_id": "2023-09-07-shenzhen-extreme-rain",
        "city_id": "shenzhen",
        "event_name": "深圳 9·7 极端特大暴雨",
        "event_start": "2023-09-07T18:00:00+08:00",
        "event_end": "2023-09-08T18:00:00+08:00",
        "timezone": "Asia/Shanghai",
        "trigger_summary": "海葵残余环流、季风和弱冷空气共同影响",
        "status": "candidate",
        "records": records,
        "public_warning_ready": False,
        "automatic_dispatch_ready": False,
    }


class EvidenceContractTest(unittest.TestCase):
    def test_all_five_evidence_classes_are_explicit(self):
        records = []
        for index, kind in enumerate(EVIDENCE_CLASSES):
            changes = {"evidence_class": kind}
            if kind == "missing":
                changes.update(value=None, missing_status="not_acquired",
                               missing_reason="not in repository")
            records.append(_record(f"r{index}", **changes))
        parsed = EventManifest.model_validate(_manifest(records))
        self.assertEqual({r.evidence_class for r in parsed.records}, set(EVIDENCE_CLASSES))

    def test_missing_and_time_semantics_fail_closed(self):
        with self.assertRaises(ValidationError):
            EventManifest.model_validate(_manifest([_record(evidence_class="missing")]))
        with self.assertRaises(ValidationError):
            EventManifest.model_validate(_manifest([_record(
                available_at="2023-09-07T19:00:00+08:00")]))
        with self.assertRaises(ValidationError):
            EventManifest.model_validate(_manifest([_record(
                observed_at="2023-09-07T20:00:00+00:00",
                available_at="2023-09-07T20:10:00+00:00")]))
        with self.assertRaises(ValidationError):
            EventManifest.model_validate(_manifest([_record(available_at=None)]))

    def test_levels_require_vertical_datum(self):
        with self.assertRaises(ValidationError):
            EventManifest.model_validate(_manifest([_record(
                phenomenon="river_level", unit="m")]))

    def test_measurement_units_are_not_silently_mixed(self):
        with self.assertRaises(ValidationError):
            EventManifest.model_validate(_manifest([_record(unit="m")]))

    def test_loader_never_promotes_manifest_to_ground_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "cities/shenzhen/events/2023-09-07-shenzhen-extreme-rain/manifest.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(_manifest([_record()])), encoding="utf-8")
            with patch.object(data_paths, "EXTERNAL_DATA", root):
                result = load_manifest("shenzhen", "2023-09-07-shenzhen-extreme-rain")
            self.assertFalse(result["ground_truth_ready"])
            self.assertFalse(result["forecast_input_ready"])
            self.assertEqual(result["evidence_class_counts"]["observation"], 1)

    def test_loader_rejects_path_manifest_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "cities/shenzhen/events/wrong/manifest.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(_manifest([])), encoding="utf-8")
            with patch.object(data_paths, "EXTERNAL_DATA", root), self.assertRaises(
                InvalidEventManifestError
            ):
                load_manifest("shenzhen", "wrong")


if __name__ == "__main__":
    unittest.main()
