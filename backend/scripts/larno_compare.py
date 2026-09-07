#!/usr/bin/env python3
"""LarNO 逐格校验框架 (P1-A 目标(5)) — 离线可跑骨架。

地理锚定（NASADEM×LarNO dem 重叠窗）完成前，网格对齐参数由 CLI 传入；
锚定后（A2）该脚本即用于逐格/面积重合报告，无需改动。

用法（对齐参数为占位示例）:
  python larno_compare.py \
    --sim  /tmp/swe_final_30m.npy      # 本模拟 30m 水位场 (nrow,ncol) 或 .npz
    --larno-events data/larno/region1_20m --event-ids 1,2,3 \
    --grid 20 400 560 114.027 22.4712 0.0002778   # m, ncols, nrows, lon0, lat0, cell(deg)
    --out /tmp/larno_compare.json

LarNO 场格式: data/larno/region1_20m/event{h,rainfall}.npy (nrow=400, ncol=560,
5min/步, 水深 m; rainfall 为每小时mm/5min 强度)。本模拟 30m 水深场需先由
swe 输出栅格化（frontend 用 triangle→像素聚合；此处接受已栅格化 npy）。
"""
import argparse
import json
import os
from pathlib import Path

import numpy as np
import yaml

GEOREF_FN = 'georef.yaml'


def load_georef(larno_dir: str) -> dict:
    """读取 LarNO 数据目录旁的可替换 georef 配置；缺失/bbox 为 null 时返回空。"""
    p = Path(larno_dir) / GEOREF_FN
    if not p.exists():
        return {}
    cfg = yaml.safe_load(p.read_text())
    g = (cfg or {}).get('larno_region1', {})
    b = g.get('bbox')
    if not (isinstance(b, dict) and b.get('lon_min') is not None):
        return {'status': g.get('georef_status', 'unknown'), 'bbox': None}
    return {'status': g.get('georef_status'), 'bbox': b}


def load_sim(path: str) -> np.ndarray:
    """Return (nrow, ncol) water-depth field in metres (>= 0)."""
    if path.endswith('.npy'):
        arr = np.load(path)
    elif path.endswith('.npz'):
        z = np.load(path)
        arr = z['depth'] if 'depth' in z else z[list(z.keys())[0]]
    else:
        raise ValueError(f'unsupported sim file: {path}')
    arr = np.asarray(arr, dtype=np.float64)
    if arr.ndim == 3:
        arr = arr[-1]  # last time slice if time-major
    arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
    return np.maximum(arr, 0.0)


def depth_metrics(h: np.ndarray, cell_area_m2: float) -> dict:
    """域级稳健指标：>5cm/>15cm 面积、p90/p50、最大值、体积。"""
    hf = h[h > 0.0]
    n = hf.size
    out = {
        'wet_km2': round((hf.size * cell_area_m2) / 1e6, 3),
        'wet_gt5cm_km2': round(float(((h > 0.05).sum() * cell_area_m2) / 1e6), 3),
        'wet_gt15cm_km2': round(float(((h > 0.15).sum() * cell_area_m2) / 1e6), 3),
        'max_m': round(float(h.max()), 3),
        'p50_m': round(float(np.median(hf)), 4) if n else 0.0,
        'p90_m': round(float(np.quantile(hf, 0.9)), 4) if n else 0.0,
        'volume_m3': round(float(h.sum() * cell_area_m2), 0),
    }
    return out


def lats_lons_for(nrow, ncol, lat_top, lon_left, cell_lat_deg, cell_lon_deg, row0_is_north=True):
    """等经纬网格行/列中心坐标（row0 默认在北）。"""
    rows = np.arange(nrow)
    cols = np.arange(ncol)
    if row0_is_north:
        lat = lat_top - rows * cell_lat_deg - cell_lat_deg / 2
    else:
        lat = lat_top + rows * cell_lat_deg + cell_lat_deg / 2
    lon = lon_left + cols * cell_lon_deg + cell_lon_deg / 2
    return lat, lon


def project_to_larno(sim, sim_meta, nrow, ncol, lat_top, lon_left,
                     cell_lat_deg, cell_lon_deg, larno_row0_is_north=True):
    """把带地理元数据的 sim 水深场双线性投影到 LarNO 等经纬网格（面积加权近似）。

    sim_meta: dict(cell_deg, lon0, lat_top, row0_is_north)
    目标网格与 LarNO h 同构。地理坐标一律经纬度，米制经度格宽按中心纬度换算。
    """
    sc = sim_meta['cell_deg']
    slat_top = sim_meta.get('lat_top')
    slon_left = sim_meta.get('lon0')
    srow_north = sim_meta.get('row0_is_north', True)
    srow, scol = sim.shape
    slat, slon = lats_lons_for(srow, scol, slat_top, slon_left, sc, sc, srow_north)
    tlat, tlon = lats_lons_for(nrow, ncol, lat_top, lon_left, cell_lat_deg, cell_lon_deg,
                               larno_row0_is_north)
    # per-target-cell bilinear sample from sim grid
    out = np.zeros((nrow, ncol))
    for r in range(nrow):
        # find bracketing sim rows by lat
        if srow_north:
            i1 = int(np.searchsorted(-slat, -tlat[r])) if srow_north else 0
        else:
            i1 = int(np.searchsorted(slat, tlat[r]))
        i1 = min(max(i1, 1), srow - 1)
        i0 = i1 - 1
        la0, la1 = slat[i0], slat[i1]
        w_r = (tlat[r] - la0) / (la1 - la0) if la1 > la0 else 0.0
        for c in range(ncol):
            j1 = int(np.searchsorted(slon, tlon[c]))
            j1 = min(max(j1, 1), scol - 1)
            j0 = j1 - 1
            lo0, lo1 = slon[j0], slon[j1]
            w_c = (tlon[c] - lo0) / (lo1 - lo0) if lo1 > lo0 else 0.0
            a = sim[i0, j0] * (1 - w_c) + sim[i0, j1] * w_c
            b = sim[i1, j0] * (1 - w_c) + sim[i1, j1] * w_c
            out[r, c] = a * (1 - w_r) + b * w_r
    return out


def ts_report(swe_json: str, larno_json: str) -> dict:
    """无坐标时序对照：归一化体积曲线峰值时相、单位雨量产流系数。"""
    swe = json.load(open(swe_json))
    larno = json.load(open(larno_json))
    out = {'note': ('无地理需求对照：时相/形状可比；绝对量因雨型来源与排水配置差异不作严格归因。'
                    'LarNO 雨为观测驱动，本模拟为 CHIRPS 日雨 derived 设计雨型。')}
    vol_s = swe['vol_m3']; vol_l = larno['1']['vol_m3']
    out['swe_vol_peak_idx'] = int(vol_s.index(max(vol_s)))
    out['larno_event1_vol_peak_idx'] = int(vol_l.index(max(vol_l)))
    out['swe_maxH_peak_idx'] = int(swe['maxH_m'].index(max(swe['maxH_m'])))
    out['larno_event1_maxH_peak_idx'] = int(larno['1']['maxH_m'].index(max(larno['1']['maxH_m'])))
    # 归一化：体积曲线各自归一到峰值，比较形状（0-1 序列的均方误差）
    def norm(v):
        m = max(v); return [x / m for x in v] if m > 0 else v
    n_s, n_l = norm(vol_s), norm(vol_l['1']['vol_m3'] if False else larno['1']['vol_m3'])
    L = min(len(n_s), len(n_l))
    mse = sum((a - b) ** 2 for a, b in zip(n_s[:L], n_l[:L])) / L
    out['norm_vol_curve_mse'] = round(mse, 4)
    out['swe_rain_total_mm'] = round(sum(swe['rain_mm_per5']), 1)
    out['larno_events'] = {k: {'rain_total_mm': v['rain_total_mm'], 'peak_idx': v['peak_idx'],
                               'peakH_m': round(max(v['maxH_m']), 2)} for k, v in larno.items()}
    return out


def report(sim_metrics: dict, larno_metrics: dict, overlap: dict) -> dict:
    return {
        'sim_30m': sim_metrics,
        'larno_20m': larno_metrics,
        'overlap_on_larno_grid': overlap,
        'note': ('面积重合/逐格比较须在 A2 地理锚定后启用；当前域级指标仅作量级/形状对照。'
                 'LarNO 为 MIKE+ 填挖地形且含管网，本模拟 30m NASADEM 无溪线/蓄滞 → '
                 '面积偏大属保守上界。'),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description='LarNO 校验框架（A2 锚定前的域级对照）')
    ap.add_argument('--sim', default='')
    ap.add_argument('--larno-dir', default='data/larno/region1_20m')
    ap.add_argument('--event-ids', default='1', help='comma separated LarNO event ids')
    ap.add_argument('--sim-meta', default='',
                    help='sim 场地理元数据 JSON 或 key=val: cell_deg,lon0,lat_top,row0_is_north')
    ap.add_argument('--larno-grid', nargs=2, type=float, metavar=('LON_W', 'LAT_N'),
                    help='LarNO 网格西北角（假定/作者确认值）；nrow/ncol/分辨率取自 h 与 20m')
    ap.add_argument('--grid', nargs=5, type=float,
                    help='(旧) m ncols nrows lon0 lat0 cell_deg（占位，优先用 --sim-meta/--larno-grid）')
    ap.add_argument('--out', default='/tmp/larno_compare.json')
    ap.add_argument('--ts', nargs=2, metavar=('SWE_JSON', 'LARNO_JSON'),
                    help='无坐标时序对照模式（不读 --sim）')
    args = ap.parse_args()

    georef = load_georef(args.larno_dir) if not args.ts else {}
    if args.ts:
        if not args.ts[0] and not args.ts[1]: parser.error('--ts 需要两个 JSON 路径')
        res = ts_report(args.ts[0], args.ts[1])
        res['georef'] = georef
        json.dump(res, open(args.out, 'w'), ensure_ascii=False, indent=2)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        print(f'saved -> {args.out}')
        return

    if not args.sim:
        parser.error('需要 --sim 或 --ts')
    sim = load_sim(args.sim)
    sim_meta = None
    if args.sim_meta:
        if args.sim_meta.startswith('{'):
            sim_meta = json.loads(args.sim_meta)
        else:
            sim_meta = dict(kv.split('=') for kv in args.sim_meta.split(','))
            for k in ('cell_deg', 'lon0', 'lat_top'):
                sim_meta[k] = float(sim_meta[k])
            sim_meta['row0_is_north'] = sim_meta.get('row0_is_north', 'true').lower() == 'true'
    # cell area: 30 m 级默认
    cell_area_m2 = (0.0002777 * 111_320.0) ** 2
    sim_m = depth_metrics(sim, cell_area_m2)

    event_ids = [int(x) for x in args.event_ids.split(',')]
    results = {'georef': georef, 'events': {}}
    for eid in event_ids:
        p = os.path.join(args.larno_dir, f'event{eid}', 'h.npy')
        if not os.path.exists(p):
            print(f'[skip] {p} missing')
            continue
        h = np.load(p)  # (nstep, nrow, ncol) 5min 步长
        h_peak = np.max(h, axis=0) if h.ndim == 3 else h
        nrow, ncol = h_peak.shape
        cell_m2 = cell_area_m2
        if args.larno_grid:
            cell_m2 = (20.0) ** 2  # LarNO 20m 格
        lm = depth_metrics(np.maximum(h_peak, 0.0), cell_m2)
        if sim_meta and args.larno_grid:
            # 真实经纬双线性投影（LarNO 20m 等经纬假定：lat 格宽固定、lon 格宽按中心纬度）
            lon_w, lat_n = args.larno_grid
            lat_c = lat_n - nrow * 20.0 / 111320.0 / 2
            cell_lat = 20.0 / 111320.0
            cell_lon = 20.0 / (111320.0 * np.cos(np.deg2rad(lat_c)))
            sim_r = project_to_larno(sim, sim_meta, nrow, ncol, lat_n, lon_w,
                                     cell_lat, cell_lon, larno_row0_is_north=False)
            cell_m2 = (20.0) ** 2
            anchor_note = (f'sim→LarNO 真实经纬双线性投影（sim meta {sim_meta}；LarNO 网格角 '
                           f'lon {lon_w:.4f} lat {lat_n:.4f} 行南向 20m）——provisional：'
                           f'georef_status={georef.get("status")}，bbox 未确认前属假定对齐')
        else:
            # 占位：无元数据时按形状比例
            sim_r = sim
            anchor_note = ('无 sim 场/网格地理元数据 → 未投影（占位）。给 --sim-meta 与 --larno-grid '
                           '或待 georef.yaml bbox 确认后自动启用真实变换')
            if sim.shape != (nrow, ncol):
                anchor_note += f'（shape 不匹配 {sim.shape} vs {(nrow, ncol)}）'
        diff = sim_r - h_peak
        results['events'][str(eid)] = {
            'larno_metrics': lm,
            'sim_projected_metrics': depth_metrics(sim_r, cell_m2),
            'bias_mean_m': round(float(diff[sim_r > 0].mean()) if (sim_r > 0).any() else 0.0, 4),
            'bias_rmse_m': round(float(np.sqrt((diff ** 2).mean())), 4),
            'wet_overlap_km2': round(float(((sim_r > 0.15) & (h_peak > 0.15)).sum() * cell_m2 / 1e6), 3),
            'anchor_note': anchor_note,
        }
    results['sim_30m_metrics'] = sim_m
    with open(args.out, 'w') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(json.dumps(results, ensure_ascii=False, indent=2))
    print(f'saved -> {args.out}')


if __name__ == '__main__':
    main()
