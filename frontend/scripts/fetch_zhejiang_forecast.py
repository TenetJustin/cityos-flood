"""Fetch ECMWF open IFS precipitation as weather-model evidence, not a flood forecast.

Requires ecmwf-opendata and eccodes. All five lead times must come from one run.
"""

import argparse
import hashlib
import json
import math
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

CITY_CENTERS = {
    "ningbo": (29.87, 121.55),
    "taizhou": (28.66, 121.42),
    "wenzhou": (27.99, 120.70),
    "hangzhou": (30.27, 120.15),
}
STEPS = (6, 12, 24, 48, 72)
SOURCE_URL = "https://www.ecmwf.int/en/forecasts/datasets/open-data"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "public/data/zhejiang-weather-forecast.json"


def utc_time(date, time):
    return datetime.strptime(f"{int(date):08d}{int(time):04d}", "%Y%m%d%H%M").replace(tzinfo=timezone.utc)


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    dlat, dlon = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    term = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(term)))


def source_metadata():
    return {
        "publisher": "ECMWF", "product": "IFS Open Data 0.25-degree total precipitation",
        "url": SOURCE_URL, "license": "CC BY 4.0 plus ECMWF Terms of Use",
        "attribution": "This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF).",
        "crs": "EPSG:4326", "timezone": "UTC", "native_unit": "m", "display_unit": "mm",
        "sampling": "nearest model grid cell to indicative city centre",
    }


def build_snapshot(messages, raw_sha256, retrieved_at):
    if len(messages) != len(STEPS) or {message["step_hours"] for message in messages} != set(STEPS):
        raise ValueError("missing or duplicate forecast lead time")
    runs = {message["model_run_at"] for message in messages}
    if len(runs) != 1:
        raise ValueError("mixed model runs")
    run_at = datetime.fromisoformat(next(iter(runs)).replace("Z", "+00:00"))
    seen_at = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    if run_at > seen_at or seen_at - run_at > timedelta(hours=24):
        raise ValueError("future or stale forecast run")
    ordered = sorted(messages, key=lambda item: item["step_hours"])
    by_city = []
    for city_id, centre in CITY_CENTERS.items():
        values = []
        previous = -0.001
        gridpoint = None
        for message in ordered:
            item = message["cities"].get(city_id)
            if not item:
                raise ValueError(f"missing {city_id} grid cell")
            mm = item["value_m"] * 1000
            if not math.isfinite(mm) or mm < -0.001 or mm + 0.02 < previous:
                raise ValueError(f"invalid accumulated precipitation for {city_id}")
            point = (item["grid_lat"], item["grid_lon"])
            distance = haversine_km(*centre, *point)
            if distance > 30 or (gridpoint is not None and point != gridpoint):
                raise ValueError(f"grid cell mismatch for {city_id}")
            gridpoint = point
            valid_at = iso(run_at + timedelta(hours=message["step_hours"]))
            if message["valid_at"] != valid_at:
                raise ValueError("validity time mismatch")
            values.append({"lead_hours": message["step_hours"], "valid_at": valid_at, "cumulative_precip_mm": round(max(0, mm), 3)})
            previous = mm
        by_city.append({"city_id": city_id, "city_center": list(centre), "grid_cell": list(gridpoint), "grid_distance_km": round(haversine_km(*centre, *gridpoint), 1), "values": values, "quality": "model_grid_sample"})
    return {
        "schema_version": 1, "state": "ok", "evidence_type": "model_inference", "forecast_kind": "weather_only",
        "model_run_at": iso(run_at), "issued_at": None, "available_at": retrieved_at, "retrieved_at": retrieved_at,
        "source_sha256": raw_sha256, "source": source_metadata(), "cities": by_city,
        "quality": {"lead_times_complete": True, "city_coverage": len(by_city), "maximum_run_age_hours": 24},
        "limitations": ["模式格点累计降雨，不是雨量站真实观测", "起报时间不是产品正式发布时间；available_at 仅为本次快照实际抓取时间，不能证明产品或跨构建首次可获得时间", "约 0.25 度格点不足以解析城区排水和积水；不可当作内涝概率或公众预警"],
    }


def extract_messages(raw_path):
    import eccodes

    messages = []
    with raw_path.open("rb") as stream:
        while handle := eccodes.codes_grib_new_from_file(stream):
            try:
                if eccodes.codes_get(handle, "shortName") != "tp" or eccodes.codes_get(handle, "units") != "m" or eccodes.codes_get(handle, "stepType") != "accum":
                    raise ValueError("unexpected GRIB parameter or unit")
                if eccodes.codes_get(handle, "gridType") != "regular_ll":
                    raise ValueError("unexpected GRIB grid")
                if abs(eccodes.codes_get(handle, "iDirectionIncrementInDegrees") - 0.25) > 0.001:
                    raise ValueError("unexpected GRIB resolution")
                if eccodes.codes_get(handle, "startStep") != 0:
                    raise ValueError("precipitation is not accumulated from run start")
                run_at = utc_time(eccodes.codes_get(handle, "dataDate"), eccodes.codes_get(handle, "dataTime"))
                step_hours = int(eccodes.codes_get(handle, "endStep"))
                valid_at = utc_time(eccodes.codes_get(handle, "validityDate"), eccodes.codes_get(handle, "validityTime"))
                cities = {}
                for city_id, centre in CITY_CENTERS.items():
                    nearest = eccodes.codes_grib_find_nearest(handle, *centre)[0]
                    cities[city_id] = {"grid_lat": float(nearest.lat), "grid_lon": float(nearest.lon), "value_m": float(nearest.value)}
                messages.append({"model_run_at": iso(run_at), "step_hours": step_hours, "valid_at": iso(valid_at), "cities": cities})
            finally:
                eccodes.codes_release(handle)
    return messages


def retrieve(target):
    from ecmwf.opendata import Client

    Client(source="ecmwf", model="ifs").retrieve(type="fc", step=list(STEPS), param="tp", target=str(target))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--input-grib", type=Path, help="Process an already retrieved GRIB without network access")
    parser.add_argument("--allow-unavailable", action="store_true", help="Publish an explicit missing-data state if the live source fails")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="cityos-ecmwf-") as temp_dir:
            target = args.input_grib or Path(temp_dir) / "tp.grib2"
            if not args.input_grib:
                retrieve(target)
            raw = target.read_bytes()
            if not raw or len(raw) > 20_000_000:
                raise ValueError("forecast file missing or too large")
            seen_at = iso(datetime.now(timezone.utc))
            snapshot = build_snapshot(extract_messages(target), hashlib.sha256(raw).hexdigest(), seen_at)
    except Exception as error:
        if not args.allow_unavailable:
            raise
        snapshot = {"schema_version": 1, "state": "unavailable", "evidence_type": "missing_data", "forecast_kind": "weather_only", "attempted_at": iso(datetime.now(timezone.utc)), "reason_code": type(error).__name__, "source": source_metadata(), "cities": []}
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if snapshot["state"] == "ok":
        print(f"ECMWF weather-model snapshot: {snapshot['model_run_at']}; {len(snapshot['cities'])} cities; {len(STEPS)} lead times")
    else:
        print(f"ECMWF weather-model snapshot unavailable: {snapshot['reason_code']}")


if __name__ == "__main__":
    main()
