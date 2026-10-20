"""Build an auditable GHCNh 6-hour precipitation evidence slice, not hourly rain.

NOAA FM12 6-hour accumulations are reported every three hours in this slice.
Their windows overlap, so the values must never be summed as independent totals.
"""

import argparse
import csv
import hashlib
import io
import json
import math
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly"
YEAR = 2021
START = datetime(2021, 7, 20, tzinfo=timezone.utc)
END = datetime(2021, 7, 29, tzinfo=timezone.utc)
STATIONS = (
    ("hangzhou", "CHI0000ZSHC", "XIAOSHAN", 30.2283, 120.4317, 30.27, 120.15, "city_station"),
    ("ningbo", "CHI0000ZSNB", "LISHE", 29.8249, 121.4651, 29.87, 121.55, "city_station"),
    ("ningbo", "CHM00058477", "DINGHAI", 30.0333, 122.1167, 29.87, 121.55, "regional_proxy"),
    ("wenzhou", "CHM00058659", "WENZHOU", 28.0167, 120.6667, 27.99, 120.70, "city_station"),
    ("wenzhou", "CHM00058752", "RUIAN", 27.7833, 120.6500, 27.99, 120.70, "regional_proxy"),
)
OUTPUT = Path(__file__).resolve().parents[1] / "public/data/zhejiang-synoptic-rain-2021.json"


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def source_url(station_id):
    return f"{BASE}/access/by-year/{YEAR}/psv/GHCNh_{station_id}_{YEAR}.psv"


def distance_km(lat1, lon1, lat2, lon2):
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return round(12742 * math.asin(min(1, math.sqrt(a))), 1)


def grid():
    current = START
    while current < END:
        yield iso(current)
        current += timedelta(hours=3)


def parse_station(raw, station_id, station_name, lat, lon):
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter="|")
    required = {"STATION", "Station_name", "DATE", "LATITUDE", "LONGITUDE", "precipitation_6_hour",
                "precipitation_6_hour_Quality_Code", "precipitation_6_hour_Measurement_Code",
                "precipitation_6_hour_Source_Code", "precipitation_6_hour_Report_Type"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError("GHCNh fields missing")
    records = {}
    source_rows = 0
    for row in reader:
        if None in row or row["STATION"] != station_id:
            raise ValueError("GHCNh station identity or row shape mismatch")
        observed = datetime.fromisoformat(row["DATE"] + "+00:00")
        if not START <= observed < END:
            continue
        source_rows += 1
        if row["Station_name"] != station_name or abs(float(row["LATITUDE"]) - lat) > 0.001 or abs(float(row["LONGITUDE"]) - lon) > 0.001:
            raise ValueError("GHCNh station coordinates or name mismatch")
        value = row["precipitation_6_hour"].strip()
        if not value:
            continue
        timestamp = iso(observed)
        if timestamp in records or observed.minute != 0 or observed.hour % 3:
            raise ValueError("GHCNh duplicate or off-grid precipitation report")
        quality = row["precipitation_6_hour_Quality_Code"].strip()
        source = row["precipitation_6_hour_Source_Code"].strip()
        report = row["precipitation_6_hour_Report_Type"].strip()
        if source not in ("220", "223") or report != "FM12":
            raise ValueError("Unexpected GHCNh report provenance")
        amount = float(value)
        if not math.isfinite(amount) or amount < 0 or amount > 1000:
            raise ValueError("GHCNh precipitation out of bounds")
        measurement = row["precipitation_6_hour_Measurement_Code"].strip() or None
        usable = quality == "1" and measurement not in ("T",)
        records[timestamp] = {"observed_at": timestamp, "available_at": None,
                              "precip_6h_mm": amount if usable else None,
                              "status": "historical_record" if usable else "missing_data",
                              "quality_code": quality, "measurement_code": measurement,
                              "source_code": source, "report_type": report,
                              "missing_reason": None if usable else "quality_or_trace_not_numeric"}
    slots = [records.get(timestamp, {"observed_at": timestamp, "available_at": None,
                                    "precip_6h_mm": None, "status": "missing_data", "quality_code": None,
                                    "measurement_code": None, "source_code": None, "report_type": None,
                                    "missing_reason": "no_report"}) for timestamp in grid()]
    return slots, source_rows


def build_snapshot(raw_by_station, built_at, retrieved_at=None):
    stations = []
    for city_id, station_id, station_name, lat, lon, centre_lat, centre_lon, relation in STATIONS:
        raw = raw_by_station[station_id]
        slots, source_rows = parse_station(raw, station_id, station_name, lat, lon)
        stations.append({"city_id": city_id, "station_id": station_id, "station_name": station_name,
                         "relation": relation, "station_coordinates": [lat, lon],
                         "distance_to_city_centre_km": distance_km(lat, lon, centre_lat, centre_lon),
                         "source_url": source_url(station_id), "source_sha256": hashlib.sha256(raw).hexdigest(),
                         "source_rows_in_slice": source_rows,
                         "coverage_slots": sum(slot["status"] == "historical_record" for slot in slots),
                         "slots": slots})
    return {"schema_version": 1, "state": "ok", "evidence_type": "historical_record",
            "variable": "precipitation_6_hour", "unit": "mm", "timezone": "UTC", "crs": "EPSG:4326",
            "period_hours": 6, "report_grid_hours": 3, "available_at": None,
            "retrieved_at": retrieved_at, "built_at": built_at,
            "slice": {"start_inclusive": iso(START), "end_exclusive": iso(END)},
            "source": {"publisher": "NOAA NCEI", "product": "GHCNh 2021 by-year PSV",
                       "documentation_url": f"{BASE}/doc/ghcnh_DOCUMENTATION.pdf",
                       "citation_url": "https://doi.org/10.25921/jp3d-3v19",
                       "license": "CC0-1.0"},
            "stations": stations,
            "city_coverage": {city: sum(station["coverage_slots"] for station in stations if station["city_id"] == city)
                              for city in ("hangzhou", "ningbo", "taizhou", "wenzhou")},
            "limitations": ["Six-hour accumulation windows reported every three hours overlap; do not sum them.",
                            "Taizhou has no admitted GHCNh rain station in this slice; Ningbo and Wenzhou city stations have no usable reports.",
                            "Archive retrieval time is not the event-time available_at. This slice cannot support as-of backtesting.",
                            "Station rain is not urban flood depth, resident behavior, or emergency response truth."]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, help="Directory containing STATION.psv source files")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--retrieved-at", help="UTC source retrieval timestamp, required for a downloaded input directory")
    args = parser.parse_args()
    if args.input_dir and not args.retrieved_at:
        parser.error("--retrieved-at is required with --input-dir; file mtime is not trusted as download time")
    if args.retrieved_at:
        retrieved = datetime.fromisoformat(args.retrieved_at.replace("Z", "+00:00"))
        if retrieved.tzinfo is None or retrieved.utcoffset() != timedelta(0):
            parser.error("--retrieved-at must be a UTC timestamp")
        retrieved_at = iso(retrieved)
    else:
        retrieved_at = None
    raw_by_station = {}
    for _, station_id, *_ in STATIONS:
        if args.input_dir:
            raw = (args.input_dir / f"{station_id}.psv").read_bytes()
        else:
            with urllib.request.urlopen(source_url(station_id), timeout=45) as response:
                raw = response.read(15_000_001)
        if not raw or len(raw) > 15_000_000:
            raise ValueError(f"GHCNh source missing or oversized: {station_id}")
        raw_by_station[station_id] = raw
    snapshot = build_snapshot(raw_by_station, iso(datetime.now(timezone.utc)),
                              retrieved_at or iso(datetime.now(timezone.utc)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("GHCNh six-hour usable slots:", snapshot["city_coverage"])


if __name__ == "__main__":
    main()
