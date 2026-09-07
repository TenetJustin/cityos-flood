#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge per-bbox SWMM network exports into one app-facing core network.

Each bbox export is already the final model's stage GeoJSON (in the bbox's UTM
zone, EPSG:32649 or 32650).  Node ids may collide across bboxes, so ids are
namespaced by bbox label.  Outputs (in ../real_drainage/):
  swmm_core_edges.geojson / swmm_core_nodes.geojson / swmm_core_subcatchments.geojson
  swmm_core_meta.json  (per-bbox provenance + totals)
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "real_drainage"

# label -> (project_dir, bbox, note)
BOXES = [
    ("futian", "sz_futian_test", [114.03, 22.52, 114.09, 22.56], "福田区（测试）"),
    ("luohu", "sz_luohu_core", [114.09, 22.52, 114.18, 22.57], "罗湖区+福田东部"),
    ("nanshan", "sz_nanshan", [113.88, 22.47, 114.00, 22.56], "南山区"),
]


def find_model_dir(project: str) -> Path | None:
    """Latest model dir containing a model_*.inp."""
    bbox_dir = HERE / project / "bbox_1"
    candidates = []
    for d in bbox_dir.glob("model_*"):
        inp = list(d.glob("*.inp"))
        if inp:
            candidates.append((inp[0].stat().st_mtime, d, inp[0]))
    if not candidates:
        return None
    candidates.sort()
    return candidates[-1][1]


def load_features(model_dir: Path, name: str):
    p = model_dir / name
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))["features"]


def main() -> int:
    from pyproj import Transformer

    nodes_all, edges_all, subs_all = [], [], []
    meta_boxes = []
    for label, project, bbox, note in BOXES:
        model_dir = find_model_dir(project)
        if model_dir is None:
            print(f"[{label}] no model dir -> skipped", flush=True)
            continue
        nodes_gj = json.loads((model_dir / "pipe_by_pipe_nodes.geojson").read_text())
        crs_name = nodes_gj.get("crs", {}).get("properties", {}).get("name", "")
        src_epsg = int(crs_name.rsplit(":", 1)[-1]) if crs_name else 32650
        tr = Transformer.from_crs(src_epsg, 4326, always_xy=True)
        nodes = nodes_gj["features"]
        edges = load_features(model_dir, "pipe_by_pipe_edges.geojson")
        print(f"[{label}] crs=EPSG:{src_epsg} model={model_dir.name}", flush=True)

        prefix = f"{label}:"
        id_map = {}
        # outfall ids from the INP [OUTFALLS] section
        outfall_ids = set()
        inp_files = list(model_dir.glob("*.inp"))
        if inp_files:
            inp = inp_files[0].read_text(encoding="utf-8", errors="replace")
            m = json  # placeholder to keep import clean
            import re as _re
            m = _re.search(r"\[OUTFALLS\]\s*\n(.*?)(?=\n\[|\Z)", inp, _re.S)
            if m:
                for line in m.group(1).splitlines():
                    line = line.strip()
                    if line and not line.startswith(";;") and not line.startswith("Name"):
                        outfall_ids.add(line.split()[0].replace("_outfall", ""))
        nf = []
        for f in nodes:
            pid = f["properties"]["id"]
            new_id = f"{prefix}{pid}"
            id_map[str(pid)] = new_id
            x, y = f["geometry"]["coordinates"]
            lon, lat = tr.transform(x, y)
            p = f["properties"]
            nf.append({
                "type": "Feature",
                "properties": {
                    "id": new_id,
                    "bbox": label,
                    "elevation_m": round(p.get("surface_elevation") or 0, 2),
                    "invert_m": round(p.get("chamber_floor_elevation") or 0, 2),
                    "contributing_area_m2": round(p.get("contributing_area") or 0, 1),
                    "outfall": str(pid) in outfall_ids,
                    "drains_to_outfall": p.get("outfall"),
                },
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            })
        nodes_all.extend(nf)
        print(f"[{label}] outfalls={len(outfall_ids)}", flush=True)

        ef = []
        if edges:
            for f in edges:
                p = f["properties"]
                coords = f["geometry"]["coordinates"]
                if f["geometry"]["type"] == "MultiLineString":
                    coords = coords[0]
                wgs = [[round(a, 6), round(b, 6)] for a, b in (tr.transform(c[0], c[1]) for c in coords)]
                ef.append({
                    "type": "Feature",
                    "properties": {
                        "id": f"{prefix}{p['id']}",
                        "from": id_map.get(str(p["u"]), f"{prefix}{p['u']}"),
                        "to": id_map.get(str(p["v"]), f"{prefix}{p['v']}"),
                        "bbox": label,
                        "length_m": round(p.get("length") or 0, 2),
                        "diameter_m": round(p.get("diameter") or 0, 3),
                        "slope": round(p.get("chahinian_slope") or 0, 4),
                        "cost_usd": round(p.get("cost_usd") or 0, 2),
                    },
                    "geometry": {"type": "LineString", "coordinates": wgs},
                })
        edges_all.extend(ef)

        # subcatchments (geoparquet -> 4326)
        subs_file = model_dir / "subcatchments.geoparquet"
        subs = []
        if subs_file.exists():
            import geopandas as gpd
            gdf = gpd.read_parquet(subs_file).to_crs(4326)
            gdf = gdf.sort_values("area", ascending=False).head(2000)
            for _, r in gdf.iterrows():
                geoj = json.loads(gpd.GeoSeries([r.geometry]).to_json())
                subs.append({
                    "type": "Feature",
                    "properties": {
                        "id": f"{prefix}{r['id']}",
                        "bbox": label,
                        "area_m2": round(float(r["area"]), 1),
                        "impervious_area_m2": round(float(r["impervious_area"]), 1),
                        "rc_pct": round(float(r["rc"]), 2),
                    },
                    "geometry": geoj["features"][0]["geometry"],
                })
        subs_all.extend(subs)
        print(f"[{label}] nodes={len(nf)} edges={len(ef)} subs={len(subs)}", flush=True)
        meta_boxes.append({"label": label, "project": project, "model": model_dir.name,
                           "bbox": bbox, "note": note, "crs": f"EPSG:{src_epsg}",
                           "nodes": len(nf), "edges": len(ef)})

    json.dump({"type": "FeatureCollection", "features": edges_all},
              open(OUT / "swmm_core_edges.geojson", "w"))
    json.dump({"type": "FeatureCollection", "features": nodes_all},
              open(OUT / "swmm_core_nodes.geojson", "w"))
    json.dump({"type": "FeatureCollection", "features": subs_all},
              open(OUT / "swmm_core_subcatchments.geojson", "w"))
    json.dump({
        "engine": "SWMManywhere 0.2.2",
        "boxes": meta_boxes,
        "totals": {"nodes": len(nodes_all), "edges": len(edges_all), "subcatchments": len(subs_all)},
    }, open(OUT / "swmm_core_meta.json", "w"), ensure_ascii=False, indent=1)
    print(f"merged: nodes={len(nodes_all)} edges={len(edges_all)} subs={len(subs_all)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
