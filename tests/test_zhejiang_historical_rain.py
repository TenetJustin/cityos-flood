"""Fail-closed checks for NOAA GHCN-Daily historical rain evidence."""

import gzip
import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "frontend/scripts/build_zhejiang_historical_rain.py"
SPEC = importlib.util.spec_from_file_location("build_zhejiang_historical_rain", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ZhejiangHistoricalRainTests(unittest.TestCase):
    def test_unit_flags_and_missing_days(self):
        sample = gzip.compress((
            "CHM00058457,20210724,PRCP,650,,,S,\n"
            "CHM00058457,20210725,PRCP,1186,,X,S,\n"
        ).encode())
        days = MODULE.parse_station(sample, "CHM00058457")
        self.assertEqual(len(days), 9)
        self.assertEqual(days[4]["precip_mm"], 65)
        self.assertEqual(days[5]["status"], "missing_data")
        self.assertIsNone(days[0]["precip_mm"])

    def test_station_mismatch_fails(self):
        sample = gzip.compress(b"CHM00058477,20210724,PRCP,650,,,S,\n")
        with self.assertRaisesRegex(ValueError, "identity"):
            MODULE.parse_station(sample, "CHM00058457")

    def test_duplicate_day_fails(self):
        row = b"CHM00058457,20210724,PRCP,650,,,S,\n"
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            MODULE.parse_station(gzip.compress(row + row), "CHM00058457")


if __name__ == "__main__":
    unittest.main()
