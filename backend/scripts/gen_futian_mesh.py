#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0-1: Futian SWE triangular mesh asset generator.

Reads the real 30 m NASADEM Shenzhen window + the real ~500 m built-up
density field, crops the Futian demo bbox, samples at ``res_m``, triangulates
(scipy Delaunay) and exports static SoA binary + meta JSON consumed directly
by the browser WebGPU solver (no backend runtime dependency).

Provenance
  bed       : observed-derived (NASADEM 30 m, real_gis pipeline)
  rough     : derived from observed built-up% via assumed n(b) curve (assumed)
  district  : nearest administrative representative point (assumed approx,
              consistent with gridrisk convention)
  mesh      : generated off-line (Delaunay on planar local coordinates)

Usage:  python backend/scripts/gen_futian_mesh.py [--res 60] [--out ...]
"""
import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import Delaunay, cKDTree

DEM30 = Path(
    os.environ.get(
        "SZ_FLOOD_DATA_BASE",
        str(Path(__file__).resolve().parents[3] / "shenzhen-flood" / "data"),
    )
) / "processed"
BUILTUP = Path(__file__).resolve().parents[2] / "backend/data/real_gis/shenzhen_builtup_density.csv"
LAT0, LAT1, LON0, LON1 = 22.505, 22.585, 113.995, 114.115  # Futian demo bbox

DISTRICT_CENTERS = {  # administrative representative points (observed-derived, project convention)
    "futian": (22.541, 114.055), "luohu": (22.562, 114.131), "nanshan": (22.533, 113.930),
    "baoan": (22.555, 113.884), "longgang": (22.721, 114.248), "yantian": (22.558, 114.237),
    "longhua": (22.697, 114.036), "pingshan": (22.692, 114.346), "guangming": (22.777, 113.936),
    "dapeng": (22.597, 114.474),
}
EARTH_R = 111_320.0  # m per degree lon at equator approx; lat scaled by cos


def load_dem():
    meta = json.load(open(DEM30 / "shenzhen_dem30_meta.json"))
    dem = np.load(DEM30 / "shenzhen_dem30.npy", mmap_mode="r")
    return meta, np.asarray(dem, dtype=np.float64)


def crop(meta, dem):
    c = meta["cell_deg"]
    r0, r1 = int((meta["lat0"] - LAT1) / c), int((meta["lat0"] - LAT0) / c)
    c0, c1 = int((LON0 - meta["lon0"]) / c), int((LON1 - meta["lon0"]) / c)
    return dem[r0:r1, c0:c1]


def sample_points(dem, res_m, cell_m):
    """Uniform planar sampling over the bbox at ~res_m spacing (no duplicates)."""
    ny, nx = dem.shape
    dy = (LAT1 - LAT0) * EARTH_R
    dx = (LON1 - LON0) * EARTH_R * np.cos(np.radians(0.5 * (LAT0 + LAT1)))
    sx = max(1, int(round(res_m / cell_m)))
    sy = sx
    xidx = np.arange(0, nx, sx)
    yidx = np.arange(0, ny, sy)
    # planar local coordinates of each sampled cell centre (m, east/north)
    x = (xidx + 0.5) / nx * dx
    y = (yidx + 0.5) / ny * dy
    xx, yy = np.meshgrid(x, y)
    z = np.asarray(dem[yidx][:, xidx], dtype=np.float64).ravel()
    z = np.where(np.isfinite(z), z, 0.0)
    return xx.ravel(), yy.ravel(), z


def triangulate(x, y, z, res_m):
    xy = np.column_stack([x, y])
    tri = Delaunay(xy)
    m = len(tri.simplices)
    verts = tri.points                       # same order as x,y
    elems = tri.simplices.astype(np.int64)
    # areas & beds
    p = verts[elems]
    area = 0.5 * np.abs((p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1])
                        - (p[:, 1, 1] - p[:, 0, 1]) * (p[:, 2, 0] - p[:, 0, 0]))
    bed = z[elems].mean(axis=1)
    return verts, elems, area, bed


def neighbors(elems, m):
    """Per-triangle 3 neighbour ids (-1 = boundary), side i opposite vertex i."""
    n = len(elems)
    edge_map = {}  # undirected edge key -> [tri_a, side_a] or [tri_a, side_a, tri_b, side_b]
    nb = np.full((m, 3), -1, dtype=np.int32)
    for t in range(m):
        for s in range(3):
            a, b = elems[t, s], elems[t, (s + 1) % 3]
            if a > b:
                a, b = b, a
            key = (a, b)
            ent = edge_map.get(key)
            if ent is None:
                edge_map[key] = [t, s]
            elif len(ent) == 2:
                edge_map[key] = ent + [t, s]
            # >2 triangles sharing an edge would be non-manifold; ignore extras
    for ent in edge_map.values():
        if len(ent) == 4:
            t1, s1, t2, s2 = ent
            nb[t1, s1] = t2
            nb[t2, s2] = t1
    return nb


def roughness(centroids_deg, built):
    """n per triangle from built-up% (assumed mapping, real input)."""
    if built is None:
        return np.full(len(centroids_deg), 0.035, dtype=np.float32)
    lat, lon, b = built
    tree = cKDTree(np.column_stack([lat, lon]))
    _, idx = tree.query(centroids_deg, k=1)
    b = b[idx]
    n = 0.018 + (1.0 - b / 100.0) * 0.045   # urban low n .. vegetated high n
    return np.clip(n, 0.015, 0.09).astype(np.float32)


def district_index(centroids_deg):
    names = list(DISTRICT_CENTERS)
    ctr = np.array([[v[0], v[1]] for v in DISTRICT_CENTERS.values()])
    tree = cKDTree(ctr)
    _, idx = tree.query(centroids_deg, k=1)
    return np.array([names[i] for i in idx])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=float, default=60.0, help="target sample spacing m")
    ap.add_argument("--out", type=str, default="frontend/public/swe/futian")
    args = ap.parse_args()
    meta, dem = load_dem()
    dem = crop(meta, dem)
    x, y, z = sample_points(dem, args.res, meta['cell_deg'] * EARTH_R)
    verts, elems, area, bed = triangulate(x, y, z, args.res)
    m = len(elems)
    nb = neighbors(elems, m)

    # centroids (local m) -> degree for rough/district
    cx = verts[elems][:, :, 0].mean(axis=1)
    cy = verts[elems][:, :, 1].mean(axis=1)
    lat_c = LAT0 + cy / ((LAT1 - LAT0) * EARTH_R) * (LAT1 - LAT0)
    lon_c = LON0 + cx / ((LON1 - LON0) * EARTH_R * np.cos(np.radians(0.5 * (LAT0 + LAT1)))) * (LON1 - LON0)
    cents_deg = np.column_stack([lat_c, lon_c])

    built = None
    try:
        raw = np.loadtxt(BUILTUP, delimiter=",", skiprows=1, usecols=(0, 1, 2), encoding="utf-8-sig")
        built = raw[:, 0], raw[:, 1], raw[:, 2]
    except Exception as exc:
        print("builtup load failed, uniform roughness:", exc)
    rough = roughness(cents_deg, built)
    dnames = district_index(cents_deg)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    bin_path = out_dir / "mesh.bin"
    n = len(verts)
    with open(bin_path, "wb") as f:
        def w(arr, dt):
            f.write(np.ascontiguousarray(arr, dtype=dt).tobytes())
        w(np.array([n, m], dtype=np.uint32), np.uint32)  # header: N, M
        w(verts[:, 0], np.float32)      # [N] x (m)
        w(verts[:, 1], np.float32)      # [N] y (m)
        w(elems, np.uint32)             # [3M]
        w(nb, np.int32)                 # [3M] -1 boundary
        w(area, np.float32)             # [M]
        w(bed, np.float32)              # [M] m
        w(rough, np.float32)            # [M] Manning n
        w(lat_c, np.float32)            # [M]
        w(lon_c, np.float32)            # [M]
    names = list(DISTRICT_CENTERS)
    name_to_i = {nm: i for i, nm in enumerate(names)}
    dist_idx = np.array([name_to_i[d] for d in dnames], dtype=np.uint8)
    with open(out_dir / "dist_idx.bin", "wb") as f:
        f.write(dist_idx.tobytes())
    # degenerate-quality report
    med = float(np.median(area))
    bad = int((area < 0.35 * med).sum())
    meta_out = {
        "name": "futian-swe-p0",
        "bbox": {"south": LAT0, "north": LAT1, "west": LON0, "east": LON1},
        "res_m": args.res,
        "n_vertices": int(n), "n_triangles": int(m),
        "origin_deg": [LAT0, LON0],
        "area_km2": round(float(area.sum()) / 1e6, 2),
        "bed_range_m": [round(float(bed.min()), 2), round(float(bed.max()), 2)],
        "rough_range": [round(float(rough.min()), 4), round(float(rough.max()), 4)],
        "districts": list(DISTRICT_CENTERS),
        "bin_layout": ["N:u32", "M:u32", "verts_x:f32[N]", "verts_y:f32[N]", "elems:u32[3M]",
                       "neighbors:i32[3M](-1=boundary)", "area:f32[M]",
                       "bed:f32[M]", "rough:f32[M]", "lat_c:f32[M]", "lon_c:f32[M]"],
        "dist_idx": "uint8[M] (separate dist_idx.bin)",
        "provenance": {
            "bed": "observed-derived(NASADEM 30m)",
            "rough": "derived(built-up% observed) via assumed n(b) curve",
            "district": "assumed(nearest representative centre, gridrisk convention)",
            "mesh": "offline Delaunay planar local coordinates",
        },
        "generated": np.datetime64("now").astype(str),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {m:,} triangles, {n:,} verts, area {meta_out['area_km2']} km²")
    print(f"    bed {meta_out['bed_range_m']} m, n {meta_out['rough_range']}, thin(<0.35 median) {bad}")
    print(f"    -> {bin_path} ({bin_path.stat().st_size/1e6:.1f} MB) + meta.json")


if __name__ == "__main__":
    main()
