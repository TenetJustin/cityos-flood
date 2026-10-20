"""Build a small, source-attributed Zhejiang-nearby IBTrACS track index.

The output is historical best-track context, never an as-of forecast or flood event label.
Run manually when refreshing the checked-in historical snapshot.
"""

import argparse
import csv
import hashlib
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_URL = (
    "https://www.ncei.noaa.gov/data/"
    "international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.last3years.list.v04r01.csv"
)
SOURCE_PAGE = "https://www.ncei.noaa.gov/products/international-best-track-archive"
CITY_CENTERS = {
    "ningbo": (29.87, 121.55),
    "taizhou": (28.66, 121.42),
    "wenzhou": (27.99, 120.70),
    "hangzhou": (30.27, 120.15),
}
MAX_BYTES = 25_000_000
NEAR_KM = 500
DISPLAY_KM = 800


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    a1, a2 = math.radians(a_lat), math.radians(b_lat)
    dlat, dlon = a2 - a1, math.radians(b_lon - a_lon)
    value = math.sin(dlat / 2) ** 2 + math.cos(a1) * math.cos(a2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(value)))


def normalize_rows(csv_text):
    reader = csv.DictReader(io.StringIO(csv_text))
    required = {"SID", "NAME", "ISO_TIME", "LAT", "LON", "BASIN", "TRACK_TYPE"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError(f"Missing IBTrACS columns: {sorted(required - set(reader.fieldnames or []))}")
    storms = {}
    checked = 0
    invalid = 0
    for row in reader:
        if row.get("BASIN") != "WP" or row.get("TRACK_TYPE", "").upper() not in {"MAIN", "PROVISIONAL", "US-PROVISIONAL"}:
            continue
        checked += 1
        try:
            sid = row["SID"].strip()
            name = row["NAME"].strip() or "未命名"
            instant = datetime.strptime(row["ISO_TIME"].strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            lat, lon = float(row["LAT"]), float(row["LON"])
            if not sid or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError("invalid identity or coordinates")
        except (ValueError, TypeError, KeyError):
            invalid += 1
            continue
        distances = {city: round(haversine_km(lat, lon, *center), 1) for city, center in CITY_CENTERS.items()}
        point = {
            "time_utc": instant.isoformat().replace("+00:00", "Z"),
            "lat": round(lat, 3), "lon": round(lon, 3),
            "min_distance_km": min(distances.values()),
        }
        track_type = row["TRACK_TYPE"].upper()
        key = (sid, track_type)
        entry = storms.setdefault(key, {"sid": sid, "name": name, "track_type": track_type, "points": [], "city_min_km": {city: math.inf for city in CITY_CENTERS}})
        entry["points"].append(point)
        for city, distance in distances.items():
            entry["city_min_km"][city] = min(entry["city_min_km"][city], distance)

    candidates = []
    for entry in storms.values():
        if min(entry["city_min_km"].values()) > NEAR_KM:
            continue
        points_by_time = {point["time_utc"]: point for point in entry["points"] if point["min_distance_km"] <= DISPLAY_KM}
        points = sorted(points_by_time.values(), key=lambda point: point["time_utc"])
        if not points:
            continue
        candidates.append({
            "sid": entry["sid"], "name": entry["name"], "track_type": entry["track_type"],
            "first_nearby_at": points[0]["time_utc"], "last_nearby_at": points[-1]["time_utc"],
            "city_min_km": {city: round(distance, 1) for city, distance in entry["city_min_km"].items()},
            "points": points,
        })
    candidates.sort(key=lambda item: (item["first_nearby_at"], item["sid"], item["track_type"]), reverse=True)
    if checked and invalid / checked > 0.05:
        raise ValueError(f"Invalid position/time rate too high: {invalid}/{checked}")
    return candidates, {"wp_rows_checked": checked, "invalid_wp_rows": invalid, "nearby_tracks": len(candidates)}


def build_snapshot(raw, retrieved_at, last_modified):
    tracks, quality = normalize_rows(raw.decode("utf-8-sig"))
    return {
        "schema_version": 1, "evidence_type": "historical_record", "state": "ok",
        "retrieved_at": retrieved_at, "available_at": None, "source_last_modified": last_modified,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "source": {
            "publisher": "NOAA NCEI", "name": "IBTrACS v04r01 last3years",
            "url": SOURCE_URL, "documentation_url": SOURCE_PAGE,
            "usage": "Full and open access for tropical cyclone research; cite dataset and access date",
            "citation": "Gahtan et al. (2024), IBTrACS Project Version 4r01, NOAA NCEI, doi:10.25921/82ty-9e16",
            "timezone": "UTC", "crs": "EPSG:4326", "distance_unit": "km",
        },
        "screening": {"city_center_near_km": NEAR_KM, "display_points_within_km": DISPLAY_KM, "scope": "轨迹中心接近城市中心；不证明台风影响或城市内涝"},
        "quality": quality, "tracks": tracks,
        "limitations": ["每条路径最早公开可获得时间未核实，available_at 为 null", "事后最佳路径不能用作当时可获得的预报", "最近轨迹可能仍是临时记录并被后续修订", "轨迹接近不等于降雨、潮位或积水事件"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/data/zhejiang-track-candidates.json")
    args = parser.parse_args()
    request = Request(SOURCE_URL, headers={"User-Agent": "CityOS-Zhejiang-research/0.3 (https://github.com/TenetJustin/cityos-flood)"})
    with urlopen(request, timeout=60) as response:
        if response.headers.get("Content-Length") and int(response.headers["Content-Length"]) > MAX_BYTES:
            raise ValueError("IBTrACS source exceeds 25 MB safety limit")
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("IBTrACS source exceeds 25 MB safety limit")
        last_modified = response.headers.get("Last-Modified")
    snapshot = build_snapshot(raw, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), last_modified)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"IBTrACS nearby tracks: {snapshot['quality']['nearby_tracks']}; quality={snapshot['quality']}; output={args.output}")


if __name__ == "__main__":
    main()
