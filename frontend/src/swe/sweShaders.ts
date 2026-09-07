// WGSL shallow-water finite-volume kernel (P0, first-order central-upwind
// on unstructured triangles, Kurganov–Petrova / SWEpy-style discretisation).
//
// State per triangle: eta (water surface elev), hu, hv  (conserved).
// Depth H = eta - bed.  Edge midpoint bed uses max(bed_L, bed_R) so the
// hydrostatic pressure terms and the bed-slope source cancel exactly for a
// flat water surface (well-balanced).  Wet/dry guard H_dry.
//
// Buffers:
//   @binding(0) states   array<vec4f>  size 2*M   (eta,hu,hv,pad) ping-pong halves
//   @binding(1) bed      array<f32>    M
//   @binding(2) rough    array<f32>    M   Manning n
//   @binding(3) invArea  array<f32>    M
//   @binding(4) edgeGeo  array<vec4f>  3M  (nx,ny,len,pad) per side s
//   @binding(5) nb       array<i32>    3M  neighbour tri id (-1 wall)
//   @binding(6) drainK   array<f32>   M   drainage capacity s^-1 (LarNO-calibrated)
//   @group(1)   params   uniform SimParams
export const SIM_WGSL = /* wgsl */ `
// Params live in a 64-byte storage buffer (two parity copies, ping-pong like
// states). Storage write path is reliable on SwiftShader; uniform was not.
// layout (f32): g,dt,rain_ms,h_dry,drain_on,drain_scale,pad,pad | u32: parity,n_tri
struct SimParams {
  g : f32, dt : f32, rain_ms : f32, h_dry : f32,
  drain_on : f32, drain_scale : f32, padA : f32, padB : f32,
  parity : u32, n_tri : u32, padC : u32,
};

@group(0) @binding(0) var<storage, read_write> states : array<vec4f>;
@group(0) @binding(1) var<storage, read> bed : array<f32>;
@group(0) @binding(2) var<storage, read> roughN : array<f32>;
@group(0) @binding(3) var<storage, read> invArea : array<f32>;
@group(0) @binding(4) var<storage, read> edgeGeo : array<vec4f>;
@group(0) @binding(5) var<storage, read> nbT : array<i32>;
@group(0) @binding(6) var<storage, read> drainK : array<f32>;
@group(1) @binding(0) var<storage, read> P : SimParams;

fn regularized(h : f32, q : f32) -> f32 {
  // SWEpy-style velocity de-singularisation: velocity compresses near dry edges.
  let h4 = h * h * h * h;
  let denom = sqrt(h4 + max(h4, 1e-6));
  return sqrt(2.0) * h * q / max(denom, 1e-30);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let t = gid.x;
  if (t >= P.n_tri) { return; }
  let rd = (1u - P.parity) * P.n_tri + t;  // read half
  let wr = P.parity * P.n_tri + t;         // write half

  var st = states[rd];
  let e0 = st.x; let hu0 = st.y; let hv0 = st.z;
  let b0 = bed[t];
  var hc = e0 - b0;                 // cell depth (may be negative when dry)
  var dE = 0.0; var dHU = 0.0; var dHV = 0.0;
  var wet = false;

  for (var s = 0u; s < 3u; s++) {
    let eoff = t * 3u + s;
    let geo = edgeGeo[eoff];
    let nx = geo.x; let ny = geo.y; let len = geo.z;
    let nbr = nbT[eoff];
    var eR : f32; var huR : f32; var hvR : f32; var bR : f32;
    if (nbr >= 0) {
      let o = u32(nbr) + (1u - P.parity) * P.n_tri;
      let s2 = states[o];
      eR = s2.x; huR = s2.y; hvR = s2.z; bR = bed[u32(nbr)];
    } else {
      // wall: mirror across the edge normal -> no normal flux
      let un = hu0 * nx + hv0 * ny;
      eR = e0; bR = b0;
      huR = hu0 - 2.0 * un * nx;
      hvR = hv0 - 2.0 * un * ny;
    }
    // edge midpoint bed: max of both cells (well-balanced / wet-dry)
    let bm = max(b0, bR);
    // edge-midpoint water levels: a dry side sits on the bed (W_edge = max(eta, bm)),
    // so the interface head difference is the true water depth, not the bed jump.
    let wmL = max(e0, bm);
    let wmR = max(eR, bm);
    var hmL = wmL - bm;
    var hmR = wmR - bm;
    if (hmL <= 0.0 && hmR <= 0.0) { continue; }  // both dry: no flux
    hmL = max(hmL, 0.0);
    hmR = max(hmR, 0.0);
    wet = true;
    // one-sided speeds
    let uL = regularized(hmL, hu0);
    let vL = regularized(hmL, hv0);
    let uR = regularized(hmR, huR);
    let vR = regularized(hmR, hvR);
    let unL = uL * nx + vL * ny;
    let unR = uR * nx + vR * ny;
    let cL = sqrt(P.g * hmL);
    let cR = sqrt(P.g * hmR);
    let aOut = max(max(unL + cL, unR + cR), 0.0);
    let aIn = -min(min(unL - cL, unR - cR), 0.0);
    let d = aIn + aOut;
    if (d < 1e-12) { continue; }
    let coeffE = len * aIn * aOut / d;
    // mass (eta) residual, SWEpy water_level_function sign convention
    dE += coeffE * (wmR - wmL);
    // x-momentum flux
    let qLx = hu0 * uL + 0.5 * P.g * hmL * hmL;   // HU*u + 1/2 g H^2
    let qRx = huR * uR + 0.5 * P.g * hmR * hmR;
    let qLy = hv0 * uL;                            // HV*u (=HU*v)
    let qRy = hvR * uR;
    dHU += coeffE * (huR - hu0)
         - (len * nx / d) * (aOut * qLx + aIn * qRx)
         - (len * ny / d) * (aOut * qLy + aIn * qRy);
    // y-momentum flux
    let wLy = hv0 * vL + 0.5 * P.g * hmL * hmL;
    let wRy = hvR * vR + 0.5 * P.g * hmR * hmR;
    let wLx = hu0 * vL;
    let wRx = huR * vR;
    dHV += coeffE * (hvR - hv0)
         - (len * ny / d) * (aOut * wLy + aIn * wRy)
         - (len * nx / d) * (aOut * wLx + aIn * wRx);
    // bed-slope source (well-balanced companion of the 1/2 g H^2 terms)
    dHU += 0.5 * P.g * len * hmL * hmL * nx;
    dHV += 0.5 * P.g * len * hmL * hmL * ny;
  }

  // --- explicit update (dt applied here; invArea converts sums to rates) ---
  var eN = e0 + P.dt * invArea[t] * dE;
  var huN = hu0 + P.dt * invArea[t] * dHU;
  var hvN = hv0 + P.dt * invArea[t] * dHV;
  // rainfall source on the mass equation (m/s * s)
  eN += P.rain_ms * P.dt;
  if (P.drain_on > 0.5) {
    // (a) sea/river outlet: low boundary triangles (Shenzhen Bay / river
    // mouth, bed < 2 m) relax toward sea level 0 (exponential, tau=600 s)
    var nWall = 0u;
    for (var w = 0u; w < 3u; w++) { if (nbT[t * 3u + w] < 0) { nWall++; } }
    if (nWall > 0u && b0 < 2.0 && eN > 0.0) {
      eN -= eN * (P.dt / 600.0);
    }
    // (b) drainage network + mountain stream pits:
    //   k = LarNO-calibrated capacity (built-up proxy) ; valley-floor cells
    //   (bed >= 0.5 m below all neighbours, bed > 8 m) additionally drain as
    //   stream channels (tau = 900 s)
    var minB = 1e9;
    for (var w2 = 0u; w2 < 3u; w2++) {
      let j2 = nbT[t * 3u + w2];
      if (j2 >= 0) { minB = min(minB, bed[j2]); }
    }
    var pitK = 0.0;
    if (b0 > 8.0 && b0 < minB - 0.5) { pitK = 1.0 / 900.0; }
    let pond = max(eN - b0, 0.0);
    eN -= pond * ((drainK[t] * P.drain_scale + pitK) * P.dt);
  }

  var hN = eN - b0;
  if (hN < P.h_dry && !wet) {
    // dry cell: keep any rainfall ponding (momentum zero) but never go below bed
    states[wr] = vec4f(max(b0, eN), 0.0, 0.0, 0.0);
    return;
  }
  // wet/dry cut-off: sub-threshold shallow water loses momentum only
  if (hN < P.h_dry) { states[wr] = vec4f(max(b0, eN), 0.0, 0.0, 0.0); return; }
  // Manning friction (semi-implicit)
  let nMan = roughN[t];
  let speed = sqrt(huN * huN + hvN * hvN);
  let fr = P.g * nMan * nMan * speed / pow(max(hN, P.h_dry), 2.333333);
  let damp = 1.0 / (1.0 + P.dt * fr);
  huN *= damp; hvN *= damp;
  // tiny-momentum noise cutoff
  if (abs(huN) + abs(hvN) < 1e-6) { huN = 0.0; hvN = 0.0; }
  states[wr] = vec4f(eN, huN, hvN, 0.0);
}
`
