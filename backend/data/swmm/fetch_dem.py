#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Robustly fetch NASADEM for a bbox and stage it where swmmanywhere expects it.

The Planetary Computer COG range reads are flaky from this network; this script
downloads the full signed GeoTIFF(s) with curl retries, then merges/clips and
reprojects to the target UTM CRS, writing to <project>/bbox_1/download/elevation.tif
so prepare_elevation() skips its own (flaky) download.

Usage: python fetch_dem.py <project_dir> <west> <south> <east> <north> <target_epsg>
"""
import subprocess
import sys
from pathlib import Path

import planetary_computer
import pystac_client
import rioxarray
import rioxarray.merge as rxr_merge

CATALOG = "https://planetarycomputer.microsoft.com/api/stac/v1"


def main() -> int:
    project, west, south, east, north, epsg = sys.argv[1:7]
    bbox = (float(west), float(south), float(east), float(north))
    project_dir = Path(project)
    out = project_dir / "bbox_1" / "download" / "elevation.tif"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.stat().st_size > 1000:
        print(f"[dem] already staged: {out}", flush=True)
        return 0

    catalog = pystac_client.Client.open(CATALOG, modifier=planetary_computer.sign_inplace)
    search = catalog.search(collections=["nasadem"], bbox=bbox)
    items = list(search.item_collection().items)
    print(f"[dem] tiles: {[i.id for i in items]}", flush=True)

    locals_tif = []
    for item in items:
        href = planetary_computer.sign(item.assets["elevation"]).href
        local = out.parent / f"{item.id}.tif"
        for attempt in range(6):
            r = subprocess.run(
                ["curl", "-sS", "-L", "--retry", "5", "--retry-all-errors",
                 "--max-time", "1800", "-o", str(local), href],
                capture_output=True, text=True,
            )
            if r.returncode == 0 and local.exists() and local.stat().st_size > 10000:
                print(f"[dem] downloaded {item.id}: {local.stat().st_size/1e6:.1f}MB", flush=True)
                break
            print(f"[dem] attempt {attempt} failed rc={r.returncode} size={local.stat().st_size if local.exists() else 0}", flush=True)
        else:
            print(f"[dem] giving up on {item.id}", flush=True)
            return 1
        locals_tif.append(local)

    # merge + clip + reproject (read from local files only)
    das = [rioxarray.open_rasterio(str(p)).squeeze(drop=True) for p in locals_tif]
    dem = rxr_merge.merge_arrays(das)
    dem = dem.rio.clip_box(*bbox)
    dem = dem.rio.reproject(f"EPSG:{epsg}")
    dem.rio.to_raster(out)
    print(f"[dem] staged {out} ({out.stat().st_size/1e6:.1f}MB)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
