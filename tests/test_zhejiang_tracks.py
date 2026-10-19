"""Checks for the historical track screening adapter."""

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "frontend/scripts/build_zhejiang_tracks.py"
SPEC = importlib.util.spec_from_file_location("build_zhejiang_tracks", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ZhejiangTrackTests(unittest.TestCase):
    def test_screening_keeps_nearby_tracks_without_claiming_flood(self):
        sample = (
            "SID,NAME,ISO_TIME,LAT,LON,BASIN,TRACK_TYPE\n"
            ",,UTC,degN,degE,,\n"
            "2024A,TEST,2024-08-01 00:00:00,29.0,121.0,WP,MAIN\n"
            "2024A,TEST,2024-08-01 06:00:00,29.5,121.5,WP,MAIN\n"
            "2024B,FAR,2024-08-01 00:00:00,10.0,140.0,WP,MAIN\n"
            "2024C,SPUR,2024-08-01 00:00:00,29.0,121.0,WP,spur\n"
        )
        tracks, quality = MODULE.normalize_rows(sample)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["sid"], "2024A")
        self.assertEqual(len(tracks[0]["points"]), 2)
        self.assertEqual(quality["invalid_wp_rows"], 0)
        snapshot = MODULE.build_snapshot(sample.encode(), "2026-10-20T00:00:00Z", None)
        self.assertEqual(snapshot["evidence_type"], "historical_record")
        self.assertIn("不证明台风影响", snapshot["screening"]["scope"])
        self.assertEqual(snapshot["source"]["crs"], "EPSG:4326")


    def test_missing_required_columns_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "Missing IBTrACS columns"):
            MODULE.normalize_rows("SID,NAME\n2024A,TEST\n")


if __name__ == "__main__":
    unittest.main()
