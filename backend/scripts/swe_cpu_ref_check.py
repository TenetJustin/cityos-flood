#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CPU reference kernel for the WebGPU SWE P0 solver (same discretisation as
frontend/src/swe/sweShaders.ts) to validate well-balancedness & mass
conservation independently of the browser.

Usage: swe_cpu_ref_check.py {lake|rain} [mesh.bin] [steps]
"""
import sys
from pathlib import Path

import numpy as np

G, H_DRY, DT = 9.81, 1e-4, 1.0
RAIN_MMH = 50.0


def load_mesh(path):
    with open(path, "rb") as f:
        nm = np.fromfile(f, dtype=np.uint32, count=2)
        N, M = int(nm[0]), int(nm[1])
        vertsX = np.fromfile(f, dtype=np.float32, count=N)
        vertsY = np.fromfile(f, dtype=np.float32, count=N)
        elems = np.fromfile(f, dtype=np.uint32, count=3 * M).astype(np.int64).reshape(M, 3)
        nb = np.fromfile(f, dtype=np.int32, count=3 * M).reshape(M, 3).T  # tri-major -> [side][tri]
        area = np.fromfile(f, dtype=np.float32, count=M)
        bed = np.fromfile(f, dtype=np.float32, count=M)
        rough = np.fromfile(f, dtype=np.float32, count=M)
        ll = np.fromfile(f, dtype=np.float32, count=2 * M)
        latC = ll[:M].copy()
        lonC = ll[M:].copy()
    # optional drainage capacity field (P1: LarNO-calibrated, derived asset)
    dpath = Path(path).with_name("drain_rate.bin")
    drain_k = np.fromfile(dpath, dtype=np.float32, count=M) if dpath.exists() else np.zeros(M, dtype=np.float32)
    if drain_k.size == 0:
        drain_k = np.zeros(M, dtype=np.float32)
    # per-tri side geometry (mirror of sweAssets.ts host preprocessing)
    vs = elems
    qx = np.stack([vertsX[vs[:, 1]] - vertsX[vs[:, 0]], vertsX[vs[:, 2]] - vertsX[vs[:, 1]], vertsX[vs[:, 0]] - vertsX[vs[:, 2]]])  # 3xM
    qy = np.stack([vertsY[vs[:, 1]] - vertsY[vs[:, 0]], vertsY[vs[:, 2]] - vertsY[vs[:, 1]], vertsY[vs[:, 0]] - vertsY[vs[:, 2]]])
    L = np.hypot(qx, qy)
    # signed area per triangle from its own vertex winding
    sA = 0.5 * ((vertsX[vs[:, 1]] - vertsX[vs[:, 0]]) * (vertsY[vs[:, 2]] - vertsY[vs[:, 0]])
                - (vertsY[vs[:, 1]] - vertsY[vs[:, 0]]) * (vertsX[vs[:, 2]] - vertsX[vs[:, 0]]))
    sgn = np.where(sA >= 0, 1.0, -1.0)
    nx = sgn[None, :] * qy / L
    ny = sgn[None, :] * (-qx) / L
    # pit field: valley-floor cells (bed at least 2 m below all neighbours,
    # bed > 8 m => mountain headwater) drain like stream channels (tau=900 s)
    bedA = np.maximum(bed[None, :], bed[nb])
    pitK = np.zeros(M, dtype=np.float32)
    pit = (bed < bedA.min(axis=0) - 0.5) & (bed > 8.0)
    pitK[pit] = 1.0 / 900.0
    return dict(M=M, elems=elems, nb=nb, area=area, bed=bed, rough=rough,
                nx=nx, ny=ny, L=L, invA=1.0 / np.maximum(np.abs(area), 1e-9),
                drain_k=drain_k, pit_k=pitK, latC=latC, lonC=lonC)


def regularized(h, q):
    h4 = h * h * h * h
    # SWEpy-style: denom floor ~1e-3 -> velocity compresses toward dry edges
    return np.sqrt(2.0) * h * q / np.sqrt(h4 + np.maximum(h4, 1e-6))


def step(mesh, state, rain_ms, drain_on=False):
    """one forward-Euler sub-step, vectorised over all triangles."""
    E, HU, HV = state
    M = mesh["M"]
    nb = mesh["nb"].reshape(3, M)          # neighbour per side (-1 wall)
    nx, ny, L, invA = mesh["nx"], mesh["ny"], mesh["L"], mesh["invA"]
    bed = mesh["bed"]

    # neighbour gather (wall -> mirror self)
    ok = nb >= 0
    nbS = np.where(ok, nb, np.arange(M)[None, :])
    ER = E[nbS]; HUR = HU[nbS]; HVR = HV[nbS]; BR = bed[nbS]
    # wall mirror: reflect momentum across edge normal
    un = HU[None, :] * nx + HV[None, :] * ny
    HUR = np.where(ok, HUR, HU[None, :] - 2.0 * un * nx)
    HVR = np.where(ok, HVR, HV[None, :] - 2.0 * un * ny)
    ER = np.where(ok, ER, E[None, :])
    BR = np.where(ok, BR, bed[None, :])

    Bm = np.maximum(bed[None, :], BR)                 # edge midpoint bed (max rule)
    # edge-midpoint water level: dry side sits on the bed (W_edge = max(eta, Bm))
    wmL = np.maximum(E[None, :], Bm)
    wmR = np.maximum(ER, Bm)
    HmL = wmL - Bm
    HmR = wmR - Bm
    both_dry = (HmL <= 0.0) & (HmR <= 0.0)
    HmL = np.maximum(HmL, 0.0); HmR = np.maximum(HmR, 0.0)
    uL = regularized(HmL, HU[None, :]); vL = regularized(HmL, HV[None, :])
    uR = regularized(HmR, HUR); vR = regularized(HmR, HVR)
    unL = uL * nx + vL * ny
    unR = uR * nx + vR * ny
    cL = np.sqrt(G * HmL); cR = np.sqrt(G * HmR)
    aOut = np.maximum(np.maximum(unL + cL, unR + cR), 0.0)
    aIn = -np.minimum(np.minimum(unL - cL, unR - cR), 0.0)
    d = aIn + aOut
    dead = both_dry | (d < 1e-12)
    aIn = np.where(dead, 0.0, aIn); aOut = np.where(dead, 0.0, aOut)
    d = np.where(dead, 1.0, d)
    coeffE = L * aIn * aOut / d

    dE = (coeffE * (wmR - wmL)).sum(axis=0)
    qLx = HU[None, :] * uL + 0.5 * G * HmL * HmL
    qRx = HUR * uR + 0.5 * G * HmR * HmR
    qLy = HV[None, :] * uL
    qRy = HVR * uR
    dHU = (coeffE * (HUR - HU[None, :])).sum(axis=0) \
        - (L * nx / d * (aOut * qLx + aIn * qRx)).sum(axis=0) \
        - (L * ny / d * (aOut * qLy + aIn * qRy)).sum(axis=0) \
        + (0.5 * G * L * HmL * HmL * nx).sum(axis=0)
    wLy = HV[None, :] * vL + 0.5 * G * HmL * HmL
    wRy = HVR * vR + 0.5 * G * HmR * HmR
    wLx = HU[None, :] * vL
    wRx = HUR * vR
    dHV = (coeffE * (HVR - HV[None, :])).sum(axis=0) \
        - (L * ny / d * (aOut * wLy + aIn * wRy)).sum(axis=0) \
        - (L * nx / d * (aOut * wLx + aIn * wRx)).sum(axis=0) \
        + (0.5 * G * L * HmL * HmL * ny).sum(axis=0)

    eN = E + DT * invA * dE + rain_ms * DT
    if drain_on:
        # (a) sea/river outlet: low boundary triangles (Shenzhen Bay / river
        # mouth, bed < 2 m) relax toward sea level 0 (exponential, tau=600 s).
        wall = (nb < 0).any(axis=0)
        pondS = np.maximum(eN - 0.0, 0.0)
        eN = np.where(wall & (bed < 2.0), eN - pondS * (DT / 600.0), eN)
        # (b) drainage network + mountain stream pits: dQ = -k*h*dt with
        # k = LarNO-calibrated capacity * built-up proxy  +  1/900 on valley floors
        pond = np.maximum(eN - bed, 0.0)
        eN = eN - pond * ((mesh["drain_k"] + mesh["pit_k"]) * DT)
    huN = HU + DT * invA * dHU
    hvN = HV + DT * invA * dHV
    hN = eN - bed
    dryc = (hN < H_DRY)
    wet = ~dryc
    huN = np.where(wet, huN, 0.0)
    hvN = np.where(wet, hvN, 0.0)
    # Manning semi-implicit on wet cells
    nMan = mesh["rough"]
    speed = np.hypot(huN, hvN)
    fr = G * nMan * nMan * speed / np.power(np.maximum(hN, H_DRY), 7.0 / 3.0)
    damp = 1.0 / (1.0 + DT * fr)
    huN = huN * damp; hvN = hvN * damp
    return eN, huN, hvN


def run(mode, path, steps, drain=0.0):
    mesh = load_mesh(path)
    M, bed, area = mesh["M"], mesh["bed"], mesh["area"]
    if mode == "lake":
        ETA0 = 3.0  # constant water-surface elevation over real terrain -> at rest
        E = np.full(M, ETA0)
        HU = np.zeros(M); HV = np.zeros(M)
        for i in range(steps):
            E, HU, HV = step(mesh, (E, HU, HV), 0.0)
            if i % 50 == 0:
                drift = np.abs(E - ETA0).max()
                sp = np.hypot(HU, HV) / np.maximum(E - bed, 1e-6)
                print(f"  step {i:5d}  maxEtaDrift {drift:.3e} m  maxSpeed {sp.max():.3e} m/s")
        drift = np.abs(E - ETA0).max()
        sp = np.hypot(HU, HV) / np.maximum(E - bed, 1e-6)
        wet = E > bed
        tot = ((E - bed) * area * wet).sum()
        exp = ((ETA0 - bed) * area * (ETA0 > bed)).sum()
        print(f"RESULT lake: maxDrift {drift:.3e} m | maxSpeed {sp.max():.3e} m/s | water {tot:.1f} vs {exp:.1f} m3 | pass={drift < 1e-2 and sp.max() < 0.02}")
    else:  # rain conservation
        rain_ms = RAIN_MMH / 3.6e6
        E = bed.copy(); HU = np.zeros(M); HV = np.zeros(M)
        vol_exp = rain_ms * DT * steps * area.sum()
        for i in range(steps):
            E, HU, HV = step(mesh, (E, HU, HV), rain_ms, drain_on=drain > 0)
            if i % 100 == 0:
                h = np.maximum(E - bed, 0.0)
                print(f"  step {i:5d}  water {(h * area).sum()/1e6:.1f} Mm3  maxH {h.max():.2f} m")
        h = np.maximum(E - bed, 0.0)
        vol = (h * area).sum()
        print(f"RESULT rain({RAIN_MMH}mm/h x {steps}s): vol {vol/1e6:.1f} Mm3 vs expected {vol_exp/1e6:.1f} Mm3 | err {(vol-vol_exp)/max(vol_exp,1):.2e} | maxH {h.max():.2f} m")
        hgt = (h > 0.02)
        print(f"  wet>2cm area {(area[hgt]).sum()/1e6:.1f} km2 / {area.sum()/1e6:.1f} km2")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "lake"
    default_mesh = Path(__file__).resolve().parents[2] / "frontend/public/swe/futian/mesh.bin"
    path = sys.argv[2] if len(sys.argv) > 2 else str(default_mesh)
    steps = int(sys.argv[3]) if len(sys.argv) > 3 else (200 if mode == "lake" else 600)
    drain = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    print(f"swe_cpu_ref mode={mode} mesh={path} steps={steps} drain={drain}")
    if mode == "recede":
        mesh = load_mesh(path)
        M, bed, area = mesh["M"], mesh["bed"], mesh["area"]
        E = np.minimum(bed + 0.2, np.full(M, 3.0))  # 0.2 m layer over low cells
        HU = np.zeros(M); HV = np.zeros(M)
        v0 = (np.maximum(E - bed, 0.0) * area).sum()
        print(f"  initial water {v0/1e6:.3f} Mm3")
        for i in range(steps):
            E, HU, HV = step(mesh, (E, HU, HV), 0.0, drain_on=drain > 0)
            if (i + 1) % 300 == 0:
                h = np.maximum(E - bed, 0.0)
                v = (h * area).sum()
                print(f"  t={(i+1)//60}min water {v/1e6:.3f} Mm3 rel {(v/v0-1)*100:.2f}%")
        h = np.maximum(E - bed, 0.0)
        v = (h * area).sum()
        print(f"RESULT recede t={steps}s: water {v/1e6:.4f} Mm3, rel {(v/v0-1)*100:.2f}% (LarNO median: -1.47%/5min)")
        sys.exit(0)
    run(mode, path, steps, drain)
