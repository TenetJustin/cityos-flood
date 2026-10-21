"""Reproduce SWMM -> GIS -> capacity suggestions, with hard numerical gates.

Run as a module from the repository root. Outputs stay isolated from real data.
The synthetic event is an engineering acceptance fixture, never ground truth.
"""
import argparse
import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import Point, mapping

from backend.app.hydraulic_demo import MODEL_VERSION, SOURCE_COMMIT, SwmmEngine, allocate_resources, make_inp

ROOT = Path(__file__).resolve().parents[2]


def run(source, output, library):
    raw = source.read_bytes()
    dataset = json.loads(raw)
    output.mkdir(parents=True, exist_ok=True)
    engine = SwmmEngine(library)
    results, allocations, features, checks = {}, {}, [], {}
    for city in dataset["cities"]:
        cid = city["city_id"]
        inp, points = make_inp(dataset, cid)
        result = engine.run(inp, points, output / cid)
        results[cid] = result
        allocations[cid] = [dict(hour=h, **allocate_resources(points, {p["id"]: result["depth_cm_by_point"][p["id"]][h] for p in points})) for h in range(73)]
        zero, _ = make_inp(dataset, cid, rain_scale=0, dry_boundary=True)
        dry = engine.run(zero, points, output / "checks" / cid / "dry")
        improved, _ = make_inp(dataset, cid, pipe_scale=1.4)
        drain = engine.run(improved, points, output / "checks" / cid / "drainage")
        repeated = engine.run(inp, points, output / "checks" / cid / "repeat")
        peak = max(max(v) for v in result["depth_cm_by_point"].values())
        dry_max = max(max(v) for v in dry["depth_cm_by_point"].values())
        improved_peak = max(max(v) for v in drain["depth_cm_by_point"].values())
        checks[cid] = {"dry_peak_cm": dry_max, "baseline_peak_cm": peak,
                       "larger_pipe_peak_cm": improved_peak,
                       "repeat_equal": repeated["depth_cm_by_point"] == result["depth_cm_by_point"],
                       "continuity": result["continuity"]}
        if dry_max > .01 or improved_peak > peak + .05 or not checks[cid]["repeat_equal"]:
            raise RuntimeError(f"hydraulic acceptance gate failed: {cid}: {checks[cid]}")
        elevations = np.array([p["relative_elevation_m"] for p in points], dtype="float32").reshape(5, 5)[::-1]
        # Pixel centers match synthetic microzones. This raster is NOT observed DEM.
        dx = points[1]["coordinates"][0] - points[0]["coordinates"][0]
        dy = points[5]["coordinates"][1] - points[0]["coordinates"][1]
        transform = from_origin(points[0]["coordinates"][0]-dx/2, points[20]["coordinates"][1]+dy/2, dx, dy)
        path = output / cid / "synthetic-relative-elevation.tif"
        with rasterio.open(path, "w", driver="GTiff", width=5, height=5, count=1, dtype="float32",
                           crs="EPSG:4326", transform=transform, nodata=-9999) as raster:
            raster.write(elevations, 1)
            raster.update_tags(evidence_type="simulated_scenario", vertical_datum="synthetic_local_relative_m", units="m")
        with rasterio.open(path) as raster:
            sampled = [float(v[0]) for v in raster.sample([p["coordinates"] for p in points])]
            if not all(abs(a-p["relative_elevation_m"]) < 1e-5 for a, p in zip(sampled, points)):
                raise RuntimeError("GIS raster/point alignment mismatch")
        for p in points:
            geometry = Point(*p["coordinates"])
            if not geometry.is_valid:
                raise RuntimeError("invalid GIS point")
            values = result["depth_cm_by_point"][p["id"]]
            features.append({"type": "Feature", "geometry": mapping(geometry), "properties": {
                "point_id": p["id"], "city_id": cid, "peak_depth_cm": max(values), "peak_hour": values.index(max(values)),
                "ground_elevation_m": p["relative_elevation_m"], "vertical_datum": "synthetic_local_relative_m",
                "model_version": MODEL_VERSION, "evidence_type": "simulated_scenario", "result_type": "node_ponding_not_2d_extent"}})
    payload = {"schema_version": 1, "model_version": MODEL_VERSION, "engine": "EPA SWMM", "engine_version": "5.2.4",
               "engine_source_commit": SOURCE_COMMIT, "input_sha256": hashlib.sha256(raw).hexdigest(),
               "generated_at": datetime.now(timezone.utc).isoformat(), "time_basis": "relative_scenario_hours",
               "evidence_type": "simulated_scenario", "calibrated": False, "public_warning_ready": False,
               "automatic_dispatch_ready": False, "time_step_hours": 1, "cycle_hours": 6,
               "vertical_datum": "synthetic_local_relative_m", "depth_unit": "cm",
               "depth_definition": "max(node_head_m - synthetic_ground_elevation_m, 0) * 100",
               "surface_extent_available": False, "cities": results, "resource_plans": allocations,
               "acceptance": {"passed": True, "continuity_limit_pct": 1, "cities": checks},
               "software": {"rasterio": rasterio.__version__, "gdal": rasterio.__gdal_version__}}
    (output / "results.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    (output / "peak-points.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False) + "\n")
    # Arrival replay: each frame exposes only that hour's incoming drivers.
    # Future forcing exists in the synthetic scenario definition, not as future observations.
    frames = [{"sequence": h, "scenario_hour": h, "evidence_type": "simulated_scenario",
               "observed_at": None, "available_at": None, "cycle_due": h % 6 == 0,
               "inputs": [r for r in dataset["timeline"] if r["hour"] == h]} for h in range(73)]
    (output / "feed.ndjson").write_text("\n".join(json.dumps(f, ensure_ascii=False) for f in frames) + "\n")
    print(json.dumps({"status": "passed", "model_version": MODEL_VERSION, "cities": checks}, ensure_ascii=False, indent=2))
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "frontend/public/data/zhejiang-demo-snapshot.json")
    parser.add_argument("--output", type=Path, default=ROOT / ".tmp/hydraulic-demo")
    parser.add_argument("--library", type=Path, default=ROOT / ".tmp" / ("libcityos-swmm.dylib" if platform.system() == "Darwin" else "libcityos-swmm.so"))
    args = parser.parse_args()
    run(args.source, args.output, args.library)
