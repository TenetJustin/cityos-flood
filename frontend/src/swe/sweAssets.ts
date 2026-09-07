// P0-1 asset loader + host-side static preprocessing for the SWE solver.
// Reads backend/scripts/gen_futian_mesh.py output: frontend/public/swe/futian/{mesh.bin,meta.json}
export interface SweMesh {
  N: number
  M: number
  vertsX: Float32Array // [N] local x (m, east)
  vertsY: Float32Array // [N] local y (m, north)
  elems: Uint32Array   // [3M]
  nb: Int32Array       // [3M] -1 boundary
  area: Float32Array   // [M]
  bed: Float32Array    // [M] m
  rough: Float32Array  // [M] Manning n
  latC: Float32Array   // [M]
  lonC: Float32Array   // [M]
  drainK: Float32Array // [M] s^-1 drainage capacity (LarNO-calibrated, 0 if absent)
  // preprocessed per-triangle edges: side s = ordered edge (v_s -> v_{s+1})
  edgeGeo: Float32Array // [3M*4] (nx, ny, len, pad)
  invArea: Float32Array // [M]
}

export async function loadSweMesh(path = '/swe/futian/mesh.bin'): Promise<SweMesh> {
  const resp = await fetch(path)
  if (!resp.ok) throw new Error(`mesh fetch failed ${resp.status} ${path}`)
  const buf = await resp.arrayBuffer()
  const v = new DataView(buf)
  const N = v.getUint32(0, true)
  const M = v.getUint32(4, true)
  // byte offsets: header(8) + verts_x[N] + verts_y[N] + elems[3M] + nb[3M] + area[M] + bed[M] + rough[M] + latC[M] + lonC[M]
  const vertsX = new Float32Array(buf, 8, N)
  const vertsY = new Float32Array(buf, 8 + N * 4, N)
  const elems = new Uint32Array(buf, 8 + 2 * N * 4, 3 * M)
  const nb = new Int32Array(buf, 8 + 2 * N * 4 + 3 * M * 4, 3 * M)
  const area = new Float32Array(buf, 8 + 2 * N * 4 + 6 * M * 4, M)
  const bed = new Float32Array(buf, 8 + 2 * N * 4 + 7 * M * 4, M)
  const rough = new Float32Array(buf, 8 + 2 * N * 4 + 8 * M * 4, M)
  const latC = new Float32Array(buf, 8 + 2 * N * 4 + 9 * M * 4, M)
  const lonC = new Float32Array(buf, 8 + 2 * N * 4 + 10 * M * 4, M)
  // optional drainage capacity field (same dir, drain_rate.bin); absent -> 0
  let drainK: Float32Array
  try {
    const dr = await fetch(path.replace(/mesh\.bin$/, 'drain_rate.bin'))
    if (dr.ok) drainK = new Float32Array(await dr.arrayBuffer())
    else drainK = new Float32Array(M)
  } catch { drainK = new Float32Array(M) }

  // ---- host preprocessing: per-tri edges with outward normals ----
  const edgeGeo = new Float32Array(3 * M * 4)
  const invArea = new Float32Array(M)
  for (let t = 0; t < M; t++) {
    // signed area from vertex order; outward normal flips with handedness
    const a0 = elems[t * 3], a1 = elems[t * 3 + 1], a2 = elems[t * 3 + 2]
    const ax = vertsX[a1] - vertsX[a0], ay = vertsY[a1] - vertsY[a0]
    const bx = vertsX[a2] - vertsX[a0], by = vertsY[a2] - vertsY[a0]
    const signedA = ax * by - ay * bx
    const sgn = signedA >= 0 ? 1 : -1
    const absA = area[t] > 0 ? area[t] : Math.abs(signedA) * 0.5
    invArea[t] = 1 / Math.max(absA, 1e-9)
    for (let s = 0; s < 3; s++) {
      const p = elems[t * 3 + s], q = elems[t * 3 + (s + 1) % 3]
      const dx = vertsX[q] - vertsX[p], dy = vertsY[q] - vertsY[p]
      const L = Math.hypot(dx, dy) || 1
      // right-hand rotate for CCW order; flip if signed area negative
      edgeGeo[(t * 3 + s) * 4] = sgn * (dy / L)
      edgeGeo[(t * 3 + s) * 4 + 1] = sgn * (-dx / L)
      edgeGeo[(t * 3 + s) * 4 + 2] = L
    }
  }
  return { N, M, vertsX, vertsY, elems, nb, area, bed, rough, latC, lonC, edgeGeo, invArea, drainK }
}
