"""Guard the NOAA GHCNh parser against identity, time and quality mistakes."""

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "frontend/scripts/build_zhejiang_synoptic_rain.py"
SPEC = importlib.util.spec_from_file_location("build_zhejiang_synoptic_rain", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

FIELDS = ["STATION", "Station_name", "DATE", "LATITUDE", "LONGITUDE", "precipitation_6_hour",
          "precipitation_6_hour_Quality_Code", "precipitation_6_hour_Measurement_Code",
          "precipitation_6_hour_Source_Code", "precipitation_6_hour_Report_Type"]


def raw(rows):
    return ("|".join(FIELDS) + "\n" + "\n".join("|".join(row) for row in rows) + "\n").encode()


def row(time="2021-07-20T00:00:00", value="7.2", quality="1", station="CHI0000ZSHC"):
    return [station, "XIAOSHAN", time, "30.2283", "120.4317", value, quality, "", "223", "FM12"]


class SynopticRainTests(unittest.TestCase):
    def parse(self, source):
        return MODULE.parse_station(source, "CHI0000ZSHC", "XIAOSHAN", 30.2283, 120.4317)

    def test_good_suspect_and_missing_remain_distinct(self):
        good = row()
        suspect = row(time="2021-07-20T03:00:00", value="18.1", quality="2")
        slots, source_rows = self.parse(raw([good, suspect]))
        self.assertEqual(source_rows, 2)
        self.assertEqual(len(slots), 72)
        self.assertEqual(slots[0]["precip_6h_mm"], 7.2)
        self.assertEqual(slots[0]["available_at"], None)
        self.assertEqual(slots[1]["status"], "missing_data")
        self.assertIsNone(slots[1]["precip_6h_mm"])
        self.assertEqual(slots[1]["quality_code"], "2")
        self.assertEqual(slots[2]["missing_reason"], "no_report")

    def test_duplicate_report_fails(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.parse(raw([row(), row()]))

    def test_wrong_station_or_coordinates_fails(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            self.parse(raw([row(station="CHI0000ZSNB")]))
        bad = row(); bad[3] = "0"
        with self.assertRaisesRegex(ValueError, "coordinates"):
            self.parse(raw([bad]))

    def test_off_grid_and_bad_source_fail(self):
        with self.assertRaisesRegex(ValueError, "off-grid"):
            self.parse(raw([row(time="2021-07-20T01:00:00")]))
        bad = row(); bad[8] = "999"
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.parse(raw([bad]))


if __name__ == "__main__":
    unittest.main()
