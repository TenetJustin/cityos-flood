"""Build a bounded GHCN-Daily historical precipitation slice.

The source's S flag is GSOD-derived synoptic precipitation, not a city gauge,
flood observation, or as-issued forecast. Missing days remain explicit.
"""

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE = "https://www.ncei.noaa.gov/pub/data/ghcn/daily"
START = date(2021, 7, 20)
END = date(2021, 7, 28)
STATIONS = (
    ("hangzhou", "CHM00058457", "HANGZHOU", 30.233, 120.167, 30.27, 120.15, "city_station"),
    ("ningbo", "CHM00058477", "DINGHAI", 30.033, 122.117, 29.87, 121.55, "regional_proxy"),
    ("taizhou", "CHM00058666", "DACHEN DAO", 28.450, 121.883, 28.66, 121.42, "regional_proxy"),
    ("wenzhou", "CHM00058659", "WENZHOU", 28.017, 120.667, 27.99, 120.70, "city_station"),
    ("wenzhou", "CHM00058752", "RUIAN", 27.783, 120.650, 27.99, 120.70, "regional_proxy"),
)
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "public/data/zhejiang-historical-rain-2021.json"


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def distance_km(lat1, lon1, lat2, lon2):
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return round(12742 * math.asin(min(1, math.sqrt(a))), 1)


def dates():
    day = START
    while day <= END:
        yield day.isoformat()
        day += timedelta(days=1)


def parse_station(raw, station_id):
    records = {}
    for row in csv.reader(io.StringIO(gzip.decompress(raw).decode("utf-8"))):
        if len(row) < 7:
            raise ValueError("GHCN station row is truncated")
        if row[0] != station_id:
            raise ValueError("GHCN station identity mismatch")
        if row[2] != "PRCP" or not (START.strftime("%Y%m%d") <= row[1] <= END.strftime("%Y%m%d")):
            continue
        if row[1] in records:
            raise ValueError("Duplicate station-day precipitation")
        day = date.fromisoformat(f"{row[1][:4]}-{row[1][4:6]}-{row[1][6:]}").isoformat()
        value = int(row[3])
        quality = row[5].strip()
        valid = value >= 0 and not quality
        records[row[1]] = {
            "date": day, "precip_mm": round(value / 10, 1) if valid else None,
            "quality_flag": quality or None, "measurement_flag": row[4].strip() or None,
            "source_flag": row[6].strip() or None,
            "status": "historical_record" if valid else "missing_data",
        }
    return [records.get(day.replace("-", ""), {
        "date": day, "precip_mm": None, "quality_flag": None,
        "measurement_flag": None, "source_flag": None, "status": "missing_data",
    }) for day in dates()]


def build_snapshot(raw_by_station, built_at):
    result = []
    for city_id, station_id, station_name, lat, lon, centre_lat, centre_lon, relation in STATIONS:
        raw = raw_by_station[station_id]
        daily = parse_station(raw, station_id)
        result.append({
            "city_id": city_id, "station_id": station_id, "station_name": station_name,
            "station_coordinates": [lat, lon], "city_centre": [centre_lat, centre_lon],
            "distance_to_city_centre_km": distance_km(lat, lon, centre_lat, centre_lon),
            "relation": relation, "source_url": f"{BASE}/by_station/{station_id}.csv.gz",
            "source_sha256": hashlib.sha256(raw).hexdigest(),
            "coverage_days": sum(item["precip_mm"] is not None for item in daily),
            "daily": daily,
        })
    return {
        "schema_version": 1, "state": "ok", "evidence_type": "historical_record",
        "slice": {"start_date": START.isoformat(), "end_date": END.isoformat(), "timezone": None,
                  "period_note": "GHCN-Daily day label; source S is derived from synoptic reports and its exact local accumulation window is not verified"},
        "available_at": None, "built_at": built_at, "crs": "EPSG:4326", "unit": "mm",
        "source": {"publisher": "NOAA NCEI", "product": "GHCN-Daily by-station precipitation",
                   "documentation_url": f"{BASE}/readme.txt", "citation_url": "https://doi.org/10.7289/V5D21VHZ",
                   "access": "public download; retain citation and source flags", "native_unit": "0.1 mm"},
        "stations": result,
        "limitations": ["S 来源标记表示由逐时天气报文汇总，降水量可能与真实逐日站点值显著不同",
                        "定海、大陈岛、瑞安是区域参照站，不是宁波、台州或温州城区雨量", "温州本地站该时段记录缺失；瑞安有区域参照日值",
                        "未有当时可获得时间、城区积水点或独立影响真值，不能用于 as-of 预测回测"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, help="Directory with already downloaded station CSV.GZ files")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    raw = {}
    for _, station_id, *_ in STATIONS:
        if args.input_dir:
            raw[station_id] = (args.input_dir / f"cityos-ghcnd-{station_id}.csv.gz").read_bytes()
        else:
            with urllib.request.urlopen(f"{BASE}/by_station/{station_id}.csv.gz", timeout=45) as response:
                raw[station_id] = response.read(5_000_001)
        if not raw[station_id] or len(raw[station_id]) > 5_000_000:
            raise ValueError(f"GHCN source file missing or too large: {station_id}")
    snapshot = build_snapshot(raw, iso(datetime.now(timezone.utc)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("GHCN historical precipitation:", [(item["city_id"], item["coverage_days"]) for item in snapshot["stations"]])


if __name__ == "__main__":
    main()
