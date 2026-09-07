#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download OSM buildings for a bbox and run the SWMManywhere pipeline.

Usage: python run_bbox.py <project_name> <lon_min> <lat_min> <lon_max> <lat_max> <config_template>
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# 不要 .resolve()：venv python 是符号链接，执行时需保留 venv 前缀
PY = HERE.parent.parent / ".venv-swmm" / "bin" / "python"
RUNNER = HERE / "run_swmm.py"


def main() -> int:
    project, lon_min, lat_min, lon_max, lat_max = sys.argv[1:6]
    bbox = [float(lon_min), float(lat_min), float(lon_max), float(lat_max)]
    # swmmanywhere 用 bbox 西南角定 UTM 带（南山跨 114° 分界，属 49N）
    from swmmanywhere.geospatial_utilities import get_utm_epsg
    epsg = int(get_utm_epsg(bbox[0], bbox[1]).split(":")[-1])
    print(f"[{project}] target CRS EPSG:{epsg}", flush=True)
    inputs = HERE / "inputs"
    inputs.mkdir(exist_ok=True)
    buildings_file = inputs / f"{project}_buildings.geoparquet"

    # 1) Overpass buildings download — bbox order is (south, west, north, east)
    bbox_str = ",".join(f"{b:.5f}" for b in [float(lat_min), float(lon_min), float(lat_max), float(lon_max)])
    overpass = f'[out:json][timeout:120];way["building"]({bbox_str});out geom;'
    raw = inputs / f"{project}_buildings.json"
    print(f"[{project}] downloading OSM buildings for bbox {bbox_str} ...", flush=True)
    r = subprocess.run(
        ["curl", "-s", "--max-time", "900", "-X", "POST",
         "https://overpass-api.de/api/interpreter",
         "--data-urlencode", f"data={overpass}", "-o", str(raw)],
        check=False,
    )
    ok = False
    for _ in range(3):
        try:
            if raw.stat().st_size < 1000:
                raise ValueError("too small")
            with open(raw) as f:
                data = json.load(f)
            if data.get("elements"):
                ok = True
                break
        except Exception:
            pass
        time.sleep(8)
        subprocess.run(
            ["curl", "-s", "--max-time", "900", "-X", "POST",
             "https://overpass-api.de/api/interpreter",
             "--data-urlencode", f"data={overpass}", "-o", str(raw)],
            check=False,
        )
    if not ok:
        print(f"[{project}] Overpass buildings download failed", flush=True)
        return 1
    n_ways = 0
    elements = data.get("elements", [])
    ways = [e for e in elements if e.get("type") == "way" and e.get("geometry")]
    n_ways = len(ways)
    if not n_ways:
        print(f"[{project}] no building ways in bbox", flush=True)
        return 1

    # 2) Convert to geoparquet (EPSG:4326 then reproject to 32650)
    conv = f"""
import json
from pathlib import Path
import geopandas as gpd
from shapely.geometry import Polygon
raw = json.loads(Path({str(raw)!r}).read_text())
feats = []
for e in raw['elements']:
    if e.get('type') != 'way' or not e.get('geometry'):
        continue
    pts = e['geometry']
    poly = Polygon([(p['lon'], p['lat']) for p in pts])
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty:
        continue
    feats.append({{'id': e['id'], 'geometry': poly}})
g = gpd.GeoDataFrame(feats, crs='EPSG:4326')
g = g.to_crs('EPSG:{epsg}')
g.to_parquet({str(buildings_file)!r})
print('buildings saved:', len(g))
"""
    print(f"[{project}] converting buildings -> geoparquet ...", flush=True)
    r = subprocess.run([str(PY), "-c", conv], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"[{project}] conversion failed: {r.stderr[-500:]}", flush=True)
        return 1
    print(r.stdout.strip(), flush=True)

    # 3.5) DEM（稳健下载，避开 Planetary Computer COG 范围读的偶发失败）
    elevation_file = HERE / project / "bbox_1" / "download" / "elevation.tif"
    if not (elevation_file.exists() and elevation_file.stat().st_size > 1000):
        print(f"[{project}] fetching DEM (robust) ...", flush=True)
        r = subprocess.run(
            [str(PY), "-u", str(HERE / "fetch_dem.py"),
             str(HERE / project), lon_min, lat_min, lon_max, lat_max, str(epsg)],
            cwd=str(HERE),
        )
        if r.returncode != 0 or not elevation_file.exists():
            print(f"[{project}] DEM fetch failed", flush=True)
            return 1

    # 4) Config
    cfg = HERE / f"config_{project}.yml"
    cfg.write_text(f"""base_dir: {HERE}
project: {project}
bbox: [{lon_min}, {lat_min}, {lon_max}, {lat_max}]
run_model: false
address_overrides:
  building: {buildings_file}
""", encoding="utf-8")

    # 4) Run pipeline
    print(f"[{project}] running SWMManywhere ...", flush=True)
    env = dict(os.environ)
    env["MPLCONFIGDIR"] = "/tmp/mplconfig"
    env["SWMMANYWHERE_VERBOSE"] = "true"
    r = subprocess.run([str(PY), "-u", str(RUNNER), f"config_{project}.yml"],
                       cwd=str(HERE), env=env)
    if r.returncode != 0:
        print(f"[{project}] pipeline failed rc={r.returncode}", flush=True)
        return 1
    print(f"[{project}] DONE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
