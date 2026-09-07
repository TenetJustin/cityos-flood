import { useEffect, useRef, useState } from 'react'
import { loadSweMesh } from '../swe/sweAssets'
import { SweEngine } from '../swe/sweEngine'

const DEPTH_COLORS = [
  [0.02, 0, 90, 170, 90],
  [0.05, 30, 144, 255, 220],
  [0.15, 65, 200, 120, 255],
  [0.3, 255, 200, 60, 255],
  [0.5, 255, 100, 40, 255],
  [1.0, 200, 30, 30, 255],
]
function depthColor(h) {
  if (h <= 0.005) return null
  for (let i = 0; i < DEPTH_COLORS.length; i++) {
    if (h <= DEPTH_COLORS[i][0]) {
      const c = DEPTH_COLORS[i]
      return [c[1], c[2], c[3], Math.max(60, c[4])]
    }
  }
  return [150, 20, 20, 255]
}
function fmt(v, d = 2) {
  return v == null || !isFinite(v) ? '—' : v.toFixed(d)
}

export default function SwePage() {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const terrainRef = useRef(null)
  const pxRef = useRef(null)
  const runRef = useRef(false)
  const [status, setStatus] = useState('初始化…')
  const [err, setErr] = useState(null)
  const [meta, setMeta] = useState(null)
  const [rain, setRain] = useState(50)
  const [speed, setSpeed] = useState(16) // sub-steps per frame (x1 speed)
  const [drain, setDrain] = useState(false)
  const [stats, setStats] = useState(null)
  const [sel, setSel] = useState(null) // clicked triangle info
  const [testResult, setTestResult] = useState('')
  const [impact, setImpact] = useState(null)
  const [impactBusy, setImpactBusy] = useState(false)
  const distRef = useRef(null) // { distIdx: Uint8Array, names: string[] }
  const [gridKey, setGridKey] = useState('futian') // futian=60m | futian30=30m full-res
  const profilesRef = useRef(null)
  const [rainEvent, setRainEvent] = useState('') // '' = constant mode
  const [busy, setBusy] = useState(false)
  const [larno, setLarno] = useState(null)

  useEffect(() => {
    let alive = true
    const base = `/swe/${gridKey}`
    const resLabel = gridKey === 'futian30' ? '30 m 全分辨率 (247k tri)' : '60 m (61k tri)'
    setStatus(`加载 ${resLabel} 福田三角网格…`)
    if (!profilesRef.current) {
      fetch('/swe/rain_profiles.json').then(r => r.json()).then(j => { profilesRef.current = j }).catch(() => {})
    }
    fetch('/api/larno/summary').then(r => r.json()).then(j => { if (alive) setLarno(j) }).catch(() => {})
    loadSweMesh(`${base}/mesh.bin`)
      .then(async (mesh) => {
        if (!alive) return
        setMeta(mesh)
        const eng = await SweEngine.create(mesh)
        if (!alive) return
        engineRef.current = eng
        window.__sweEng = eng // debug/E2E hook
        eng.initDry()
        // district map for the triangle -> behaviour bridge
        const [diBuf, metaJson] = await Promise.all([
          fetch(`${base}/dist_idx.bin`).then(r => r.arrayBuffer()),
          fetch(`${base}/meta.json`).then(r => r.json()),
        ])
        distRef.current = { distIdx: new Uint8Array(diBuf), names: metaJson.districts }
        // pre-compute triangle centroid -> canvas pixel mapping
        const W = 704
        const minLon = Math.min(...mesh.lonC)
        const maxLon = Math.max(...mesh.lonC)
        const minLat = Math.min(...mesh.latC)
        const maxLat = Math.max(...mesh.latC)
        const H = Math.max(160, Math.round(W * (maxLat - minLat) / (maxLon - minLon)))
        const px = new Int32Array(mesh.M * 2)
        for (let t = 0; t < mesh.M; t++) {
          px[t * 2] = Math.min(W - 1, Math.max(0, Math.round((mesh.lonC[t] - minLon) / (maxLon - minLon) * (W - 1))))
          px[t * 2 + 1] = Math.min(H - 1, Math.max(0, Math.round((maxLat - mesh.latC[t]) / (maxLat - minLat) * (H - 1))))
        }
        pxRef.current = { px, W, H }
        canvasRef.current.width = W
        canvasRef.current.height = H
        // static terrain layer (bed elevation, gray)
        const tv = document.createElement('canvas')
        tv.width = W; tv.height = H
        const tctx = tv.getContext('2d')
        const img = tctx.createImageData(W, H)
        const bedLo = 0, bedHi = 120 // visual clamp to lowland range
        for (let t = 0; t < mesh.M; t++) {
          const g = 40 + Math.round(130 * Math.min(1, Math.max(0, (mesh.bed[t] - bedLo) / (bedHi - bedLo))))
          const i = (px[t * 2 + 1] * W + px[t * 2]) * 4
          img.data[i] = g; img.data[i + 1] = g + 6; img.data[i + 2] = g + 14; img.data[i + 3] = 255
        }
        tctx.putImageData(img, 0, 0)
        terrainRef.current = tv
        setStatus('WebGPU 就绪 · 网格已装载（点击"开始模拟"或先跑自检）')
        loop()
      })
      .catch((e) => {
        if (alive) { setErr(String(e)); setStatus('初始化失败') }
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKey])

  async function loop() {
    const eng = engineRef.current
    if (!eng) return
    if (window.__swePauseLoop) { requestAnimationFrame(loop); return }
    if (runRef.current) eng.step(speedRef.current)
    // throttled readback + draw (~8 fps max)
    const t0 = performance.now()
    const dt = t0 - (loop.last || 0)
    if (dt > 120) {
      loop.last = t0
      const state = await eng.readState()
      draw(state)
      setStats(eng.statsFrom(state))
    }
    requestAnimationFrame(loop)
  }
  const speedRef = useRef(speed)
  useEffect(() => { speedRef.current = speed }, [speed])
  const rainRef = useRef(rain)
  useEffect(() => { rainRef.current = rain }, [rain])
  const drainRef = useRef(drain)
  useEffect(() => { drainRef.current = drain }, [drain])

  function syncParams() {
    const eng = engineRef.current
    if (!eng) return
    eng.params.rainMmH = rainRef.current
    eng.params.drainOn = drainRef.current
    eng.params.hDry = 1e-4
    eng.refreshUniforms()
  }

  function draw(state) {
    const eng = engineRef.current
    const canvas = canvasRef.current
    if (!eng || !canvas || !terrainRef.current || !pxRef.current) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(terrainRef.current, 0, 0)
    const { px, W, H } = pxRef.current
    const img = ctx.createImageData(W, H)
    const { bed } = eng.mesh
    for (let t = 0; t < eng.mesh.M; t++) {
      const e = state[t * 4]
      const h = e - bed[t]
      const c = depthColor(h)
      if (!c) continue
      const i = (px[t * 2 + 1] * W + px[t * 2]) * 4
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = c[3]
    }
    ctx.putImageData(img, 0, 0)
  }

  async function runTest(kind) {
    const eng = engineRef.current
    if (!eng) return
    syncParams()
    setTestResult('测试运行中…')
    try {
      if (kind === 'lake') {
        const r = await eng.selfTestLake(200)
        const driftCm = (r.maxEtaDriftM * 100)
        const pass = r.maxEtaDriftM < 5e-3 && r.maxSpeed < 0.02
        setTestResult(
          `湖静止 (200 s，真实地形上 η=3.0m 静水面)：水面漂移 ${fmt(driftCm, 4)} cm，最大流速 ${fmt(r.maxSpeed, 5)} m/s → ${pass ? '通过 ✓ (well-balanced)' : '失败 ✗'}`
        )
      } else if (kind === 'dry') {
        eng.initDry()
        setTestResult('已重置为干燥初始态（η = 地形高程）')
      }
    } catch (e) { setTestResult('测试异常: ' + e) }
  }

  async function pushImpact() {
    const eng = engineRef.current
    const dm = distRef.current
    if (!eng || !dm) { setImpact({ err: '引擎未就绪' }); return }
    setImpactBusy(true)
    try {
      const state = await eng.readState()
      const { M, bed, area } = eng.mesh
      const agg = {} // did -> {depthSum, wetArea}
      for (let t = 0; t < M; t++) {
        const h = state[t * 4] - bed[t]
        if (h > 0.02) {
          const did = dm.names[dm.distIdx[t]]
          const g = (agg[did] = agg[did] || { depthSum: 0, wetArea: 0 })
          g.depthSum += h * area[t]
          g.wetArea += area[t]
        }
      }
      const districts = Object.entries(agg)
        .map(([id, g]) => ({ id, depth_m: g.wetArea > 0 ? g.depthSum / g.wetArea : 0, wet_area_km2: g.wetArea / 1e6, wet_ratio: 0 }))
        .sort((a, b) => b.wet_area_km2 - a.wet_area_km2)
      if (districts.length === 0) { setImpact({ msg: '当前无 >2cm 积水：先降雨模拟一段时间再推送' }); setImpactBusy(false); return }
      const resp = await fetch('/api/swe/impact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hour_offset: Math.min(24, Math.floor(eng.simTime / 3600)), sim_hours: eng.simTime / 3600, districts }),
      })
      const d = await resp.json()
      const rows = (d.aggregate?.districts || []).filter(x => x.affected_population > 0 || x.affected_cells > 0)
      setImpact({
        source: d.physics_source,
        simHours: eng.simTime / 3600,
        wetDistricts: districts.map(x => `${x.id} ${(x.depth_m * 100).toFixed(0)}cm/${x.wet_area_km2.toFixed(1)}km²`),
        rows: rows.slice(0, 5),
      })
    } catch (e) { setImpact({ err: String(e) }) }
    setImpactBusy(false)
  }

  function toggleRun() {
    const eng = engineRef.current
    if (!eng) return
    syncParams()
    runRef.current = !runRef.current
    setStatus(runRef.current ? `运行中 · 实时×${speed} 推演中` : '已暂停')
  }

  async function runEvent() {
    const eng = engineRef.current
    if (!eng || !rainEvent) return
    const prof = profilesRef.current?.find(x => x.id === rainEvent)
    if (!prof) return
    setBusy(true)
    const pausedBefore = !!window.__swePauseLoop
    window.__swePauseLoop = true
    runRef.current = false
    try {
      eng.initDry()
      eng.params.drainOn = drainRef.current
      eng.refreshUniforms()
      const mm = prof.mm_per_5min
      const N = mm.length
      setStatus(`事件「${prof.name}」推演中… 0/${N} 段 (5min/段)`)
      for (let i = 0; i < N; i++) {
        eng.params.rainMmH = mm[i] * 12 // mm/5min -> mm/h
        eng.refreshUniforms()
        eng.step(300) // 5 min at dt=1s
        if (i % 12 === 0) {
          await eng.readState() // drain queue, keep UI responsive
          setStatus(`事件「${prof.name}」推演中… ${i}/${N} 段 (${(i * 5 / 60).toFixed(1)}h/6h)`)
        }
      }
      eng.params.rainMmH = 0
      eng.refreshUniforms()
      setStatus(`事件完成：「${prof.name}」累计 ${prof.total_mm}mm · 模拟 6h · 峰值 ${prof.peak_intensity_mmh}mm/h`)
    } catch (e) { setStatus('事件推演失败: ' + e) }
    window.__swePauseLoop = pausedBefore
    setBusy(false)
  }

  return (
    <div style={{ color: '#dfe6ee', fontFamily: 'system-ui, sans-serif', padding: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <canvas ref={canvasRef} style={{ background: '#0b1015', border: '1px solid #2a3a4a', borderRadius: 6, width: 704, height: 508 }} />
        <div style={{ fontSize: 11, color: '#7f95a8', maxWidth: 704 }}>
          福田片 60 m 非结构三角网格 SWE 模拟 · 底图=NASADEM 30m 灰度（0-120 m 视觉钳制）· 水深色阶 0.02/0.05/0.15/0.3/0.5 m
          · 引擎=浏览器 WebGPU/WGSL · 求解=Kurganov–Petrova 中心迎风 FVM（一阶）+ well-balanced 床底源 + Manning 半隐式 + wet/dry
        </div>
        <div style={{ fontSize: 11, color: '#7f95a8' }}>
          数据溯源：床底=真实 NASADEM 30m（observed-derived）· 糙率 n=真实建成度→假设映射 n(b)（assumed）· 网格=离线 Delaunay（backend/scripts/gen_futian_mesh.py）
        </div>
        {err && <div style={{ color: '#ff8a80' }}>⚠ {err}</div>}
        <div style={{ fontSize: 12 }}>状态：{status}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#10161d', border: '1px solid #26323e', borderRadius: 6, padding: 12, minWidth: 320 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>SWE 控制</h3>
        <label style={{ fontSize: 12 }}>网格
          <select value={gridKey} onChange={e => setGridKey(e.target.value)} style={{ marginLeft: 6, background: '#0b1015', color: '#dfe6ee', border: '1px solid #2a3a4a', borderRadius: 4, padding: '2px 4px' }}>
            <option value="futian">60 m（61k tri，SwiftShader 快）</option>
            <option value="futian30">30 m 全分辨率（247k tri，NASADEM 原分辨率）</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          雨型模式
          <select value={rainEvent} onChange={e => setRainEvent(e.target.value)} style={{ marginLeft: 6, background: '#0b1015', color: '#dfe6ee', border: '1px solid #2a3a4a', borderRadius: 4, padding: '2px 4px' }}>
            <option value="">恒定强度（下面滑杆）</option>
            {(profilesRef.current || []).map(pr => <option key={pr.id} value={pr.id}>{pr.name}（{pr.total_mm}mm 日雨→设计雨型）</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          恒定降雨强度 {rain} mm/h（synthetic 常数；历史事件见上方雨型）
          <input type="range" min={0} max={150} step={5} value={rain} onChange={e => setRain(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 12 }}>
          推演倍速 ×{speed}（子步/帧，dt=1 s）
          <input type="range" min={1} max={64} step={1} value={speed} onChange={e => setSpeed(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={drain} onChange={e => { setDrain(e.target.checked); if (engineRef.current) engineRef.current.params.drainOn = e.target.checked }} />
排水总开关：管网（LarNO 77 场退水中位 1.47%/5min 标定容量场 × 建成度）+ 海/河出口（深圳湾低岸 τ600s）+ 山溪坑（derived）
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={toggleRun} style={{ padding: '6px 14px', borderRadius: 4, border: 'none', background: '#1e6fb8', color: '#fff', cursor: 'pointer' }}>
            {runRef.current ? '⏸ 暂停' : '▶ 开始降雨模拟'}
          </button>
          <button onClick={() => runTest('lake')} style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #2a3a4a', background: 'transparent', color: '#bfd4e6', cursor: 'pointer' }}>湖静止自检</button>
          <button onClick={runEvent} disabled={busy || !rainEvent} style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #b98a2a', background: busy ? '#231a08' : 'rgba(185,138,42,0.12)', color: '#e2b95a', cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '事件推演中…' : '⛈ 推演历史暴雨事件 (6 h)'}
          </button>
          <button onClick={() => runTest('dry')} style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #2a3a4a', background: 'transparent', color: '#bfd4e6', cursor: 'pointer' }}>重置干燥</button>
        </div>
        {testResult && <div style={{ fontSize: 12, color: '#9fd0ff', background: '#0c1722', padding: 8, borderRadius: 4 }}>{testResult}</div>}
        <button onClick={pushImpact} disabled={impactBusy} style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid #2a9d8f', background: impactBusy ? '#123' : 'rgba(42,157,143,0.15)', color: '#8fe3d5', cursor: impactBusy ? 'wait' : 'pointer' }}>
          {impactBusy ? '推送中…' : '⇢ 推送 SWE 快照 → 居民行为层 (/api/swe/impact)'}
        </button>
        {impact && (
          <div style={{ fontSize: 12, background: '#0c1722', padding: 8, borderRadius: 4, lineHeight: 1.7 }}>
            {impact.err ? <div style={{ color: '#ff8a80' }}>⚠ {impact.err}</div>
              : impact.msg ? <div>{impact.msg}</div> : (
                <>
                  <div style={{ color: '#7fd0c0' }}>{impact.source} · 推演 {impact.simHours.toFixed(1)} h</div>
                  <div style={{ color: '#9fb8c9' }}>积水区: {impact.wetDistricts.join('，')}</div>
                  {impact.rows.length === 0
                    ? <div>积水未达行为阈值（无 affected 区）</div>
                    : impact.rows.map(r => (
                      <div key={r.district_id}>▸ <b>{r.district}</b> 受影响人口 <b>{Math.round(r.affected_population / 10000) / 1} 万</b> · 影响格 {r.affected_cells} · 被困 {Math.round(r.stranded_population)} 人{r.isolated_cells > 0 ? ` · 孤岛 ${r.isolated_cells} 格` : ''}</div>
                    ))}
                </>
              )}
          </div>
        )}
        <details style={{ fontSize: 11, color: '#a8bfd1', marginTop: 4 }}>
          <summary style={{ cursor: 'pointer' }}>LarNO 域级对照（MIKE+ 真实福田管网 20m 基准，77 场）</summary>
          <div style={{ lineHeight: 1.7, marginTop: 4 }}>
            {larno && (
              <div>
                LarNO 77 场中位：峰值水深 <b>{larno.severity_vs_recession?.median_peak_depth_m ?? '?'} m</b> · &gt;15cm 面积 <b>{((larno.severity_vs_recession?.median_actionable_pct ?? 0) / 100 * 100).toFixed(1)} km²</b> · 退水 <b>{larno.severity_vs_recession?.median_decay_pct_per_5min}%/5min</b>
                <br />本面板排水容量即以该退水中位标定（derived）。本模拟右侧实时 stats 的 &gt;15cm 面积可与 3.6 km² 量级对照（保守偏大，原因见脚注）。
              </div>
            )}
            {!larno && <div style={{ color: '#6a7f90' }}>（后端 /api/larno/summary 不可用）</div>}
            <div style={{ color: '#5c7183' }}>逐格面积重合/时序指标待 A2 地理锚定（backend/scripts/larno_compare.py 已就绪）。</div>
          </div>
        </details>
        {stats && (
          <div style={{ fontSize: 12, lineHeight: 1.8, background: '#0c1219', padding: 10, borderRadius: 4 }}>
            <div>模拟时刻 <b>{fmt(stats.simSeconds / 3600, 2)} h</b>（{Math.round(stats.simSeconds)} s）</div>
            <div>积水总量 <b>{fmt(stats.totalWaterM3 / 1e4, 1)} 万 m³</b></div>
            <div>积水面积 <b>{fmt(stats.wetKm2, 1)} km²</b> / 109.9 km² · 其中 &gt;5cm <b>{fmt(stats.wet05Km2 || 0, 1)}</b>、&gt;15cm <b>{fmt(stats.wet15Km2 || 0, 1)} km²</b></div>
            <div>最大水深 <b>{fmt(stats.maxDepthM, 2)} m</b>（稳健 p90 <b>{fmt(stats.p90DepthM || 0, 2)} m</b>）· 最大流速 <b>{fmt(stats.maxSpeedMs, 2)} m/s</b></div>
            {sel && <div>选中三角 {sel}</div>}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#5c7183', borderTop: '1px solid #1d2834', paddingTop: 8 }}>
          P0 底层物理引擎验证面板：先跑「湖静止自检」（well-balanced 通过后再降雨才有物理意义）。
          <br />验证记录：湖静止 200 s drift≈0（CPU 0 / GPU f32 0）；600 s 50 mm/h 质量误差 CPU(f64) −2e-7 / GPU(f32) −2.2%（单精度守恒损失，P1 平移坐标缓解）；
          LarNO 量级对照（域级，诚实框定）：排水关闭时 6h 均强度 &gt;15cm 面积 6.9 km² vs LarNO 5.2 km²（偏高 ~40%，wall 上界）；排水开启后（GPU 30m 事件 20140511 169mm）&gt;15cm 15.1 km²、p90 水深 0.54 m（LarNO 中位 3.6% 面积 ≈ 3.6 km²；无溪线/蓄滞 → 保守偏大 ~3×；逐格不可比，待 A2 锚定）。
          <br />P1 已接入：30m 全分辨率网格、LarNO 退水标定排水三件套（管网/海出口/山溪）、CHIRPS 历史暴雨日→设计雨型事件推演、LarNO 校验框架（backend/scripts/larno_compare.py）。
          <br />P1 后续：LarNO 地理锚定（网络恢复后）→ 逐格面积重合/时序指标；二阶重构。
        </div>
      </div>
    </div>
  )
}
