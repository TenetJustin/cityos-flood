import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ZHEJIANG_CITIES } from './zhejiangData.js'
import { demoRankedPoints, demoTimeLabel } from './zhejiangDemoData.js'
import { syntheticTerrainElevation } from './demoFloodModel.js'
import { makeCustomGrid, makeCustomSeries as makeSeries } from './customVisualModel.js'
import FloodGridView from './FloodGridView.jsx'

const presets = [
  { id: 'compound', name: '复合暴雨压力', rain: 220, peak: 64, tide: 3, river: 2, drainage: 38 },
  { id: 'coastal', name: '暴雨 + 高潮位假设', rain: 180, peak: 52, tide: 4, river: 2, drainage: 45 },
  { id: 'river', name: '暴雨 + 河网顶托假设', rain: 200, peak: 58, tide: 2, river: 4, drainage: 42 },
  { id: 'capacity', name: '排水能力敏感性', rain: 150, peak: 42, tide: 2, river: 2, drainage: 72 },
]

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const noop = () => {}
function terrainHeight(x, z) {
  return syntheticTerrainElevation(x, z) * .16 - .4
}

function TerrainScene({ frame, cityName }) {
  const hostRef = useRef(null)
  const frameRef = useRef(frame)
  const [fallback, setFallback] = useState(false)
  useEffect(() => { frameRef.current = frame }, [frame])
  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    let renderer
    let raf = 0
    let fallbackTimer
    let rendered = false
    let disposed = false
    let dragging = false
    let pointerX = 0
    let pointerY = 0
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#edf4fb')
    scene.fog = new THREE.Fog('#edf4fb', 18, 38)
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100)
    camera.position.set(9, 8, 11)
    const root = new THREE.Group()
    scene.add(root)
    scene.add(new THREE.HemisphereLight(0xe6f3ff, 0x637b91, 2.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.7); key.position.set(-4, 10, 6); scene.add(key)
    const groundGeo = new THREE.PlaneGeometry(16, 16, 72, 72)
    groundGeo.rotateX(-Math.PI / 2)
    const pos = groundGeo.attributes.position
    const colors = []
    const low = new THREE.Color('#577383'), high = new THREE.Color('#c0cfb8')
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), z = pos.getZ(i)
      const h = terrainHeight(x, z)
      pos.setY(i, h)
      const c = low.clone().lerp(high, clamp(syntheticTerrainElevation(x, z) / 15, 0, 1))
      colors.push(c.r, c.g, c.b)
    }
    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    groundGeo.computeVertexNormals()
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 }))
    root.add(ground)
    const base = new THREE.Mesh(new THREE.BoxGeometry(16, .28, 16), new THREE.MeshStandardMaterial({ color: '#d9e5e3', roughness: 1 }))
    base.position.y = -.34; root.add(base)
    const roadMat = new THREE.MeshStandardMaterial({ color: '#c4d2dc', roughness: .94 })
    for (let offset = -6; offset <= 6; offset += 4) {
      for (let step = -7.75; step <= 7.75; step += .5) {
        const avenue = new THREE.Mesh(new THREE.BoxGeometry(.40, .018, .52), roadMat)
        avenue.position.set(offset, terrainHeight(offset, step) + .025, step); root.add(avenue)
        const crossStreet = new THREE.Mesh(new THREE.BoxGeometry(.52, .018, .40), roadMat)
        crossStreet.position.set(step, terrainHeight(step, offset) + .025, offset); root.add(crossStreet)
      }
    }
    const buildingGeo = new THREE.BoxGeometry(1, 1, 1)
    const buildingMat = new THREE.MeshStandardMaterial({ color: '#dce7ee', roughness: .56, metalness: .08, vertexColors: true })
    const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, 74)
    const dummy = new THREE.Object3D()
    let n = 0
    for (let z = -6; z <= 6; z += 2) for (let x = -6; x <= 6; x += 2) {
      if (((x * 7 + z * 3) % 5) === 0 || n >= 74) continue
      const h = .52 + (Math.abs(Math.sin(x * 3.1 + z)) * 2.0)
      const width = .72 + (n % 3) * .12
      dummy.position.set(x + .35, terrainHeight(x, z) + h / 2, z + .3)
      dummy.scale.set(width, h, .7 + (n % 2) * .12); dummy.updateMatrix(); buildings.setMatrixAt(n, dummy.matrix)
      const facade = new THREE.Color().setHSL(.56 + ((n % 5) * .012), .23, .78 - ((n % 4) * .025))
      buildings.setColorAt(n, facade)
      n += 1
    }
    buildings.count = n; root.add(buildings)
    const roofGeo = new THREE.BoxGeometry(1, 1, 1)
    const roofMat = new THREE.MeshStandardMaterial({ color: '#f7fbfd', roughness: .72 })
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, 74)
    const roofDummy = new THREE.Object3D()
    for (let index = 0; index < n; index += 1) {
      buildings.getMatrixAt(index, roofDummy.matrix)
      roofDummy.matrix.decompose(roofDummy.position, roofDummy.quaternion, roofDummy.scale)
      roofDummy.position.y += roofDummy.scale.y / 2 + .025
      roofDummy.scale.set(roofDummy.scale.x * 1.04, .05, roofDummy.scale.z * 1.04)
      roofDummy.updateMatrix(); roofs.setMatrixAt(index, roofDummy.matrix)
    }
    roofs.count = n; root.add(roofs)
    const windowGeo = new THREE.BoxGeometry(.16, .12, .025)
    const windowMat = new THREE.MeshStandardMaterial({ color: '#83b9d5', emissive: '#5593b3', emissiveIntensity: .16, roughness: .35 })
    const windows = new THREE.InstancedMesh(windowGeo, windowMat, 220)
    const windowDummy = new THREE.Object3D()
    let windowCount = 0
    for (let z = -6; z <= 6 && windowCount < 220; z += 2) for (let x = -6; x <= 6 && windowCount < 220; x += 2) {
      if (((x * 7 + z * 3) % 5) === 0) continue
      const h = .52 + (Math.abs(Math.sin(x * 3.1 + z)) * 2.0)
      for (let row = 0; row < Math.floor(h / .32) && windowCount < 220; row += 1) for (let col = -1; col <= 1 && windowCount < 220; col += 1) {
        windowDummy.position.set(x + .35 + col * .2, terrainHeight(x, z) + .28 + row * .29, z - .06)
        windowDummy.updateMatrix(); windows.setMatrixAt(windowCount++, windowDummy.matrix)
      }
    }
    windows.count = windowCount; root.add(windows)
    const waterGeo = new THREE.CircleGeometry(.48, 28); waterGeo.rotateX(-Math.PI / 2)
    const waterMat = new THREE.MeshStandardMaterial({ color: '#5aa8d8', emissive: '#1676b9', emissiveIntensity: .18, transparent: true, opacity: .58, roughness: .2, metalness: .08, side: THREE.DoubleSide, depthWrite: false })
    const water = new THREE.InstancedMesh(waterGeo, waterMat, 64)
    water.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(water)
    const waterDummy = new THREE.Object3D()
    const pointGeo = new THREE.SphereGeometry(.16, 14, 10)
    const pointMat = new THREE.MeshStandardMaterial({ color: '#dce7ee', roughness: .35, metalness: .06 })
    const pointMarkers = new THREE.InstancedMesh(pointGeo, pointMat, 25)
    pointMarkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(pointMarkers)
    const pointDummy = new THREE.Object3D()
    const colorForDepth = (depth) => new THREE.Color(depth >= 60 ? '#b46f78' : depth >= 30 ? '#d19a58' : depth >= 8 ? '#4f8fd6' : '#8ea1b7')
    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      camera.aspect = width / height; camera.updateProjectionMatrix()
      renderer?.setSize(width, height, false)
    }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      host.appendChild(renderer.domElement)
      resize()
      fallbackTimer = setTimeout(() => { if (!rendered) setFallback(true) }, 1200)
    } catch {
      host.dataset.error = 'true'
      setFallback(true)
      return () => { disposed = true }
    }
    const observer = new ResizeObserver(resize); observer.observe(host)
    const onDown = (event) => { dragging = true; pointerX = event.clientX; pointerY = event.clientY; renderer.domElement.setPointerCapture?.(event.pointerId) }
    const onMove = (event) => {
      if (!dragging) return
      root.rotation.y += (event.clientX - pointerX) * .006
      camera.position.y = clamp(camera.position.y + (event.clientY - pointerY) * -.025, 4, 14)
      pointerX = event.clientX; pointerY = event.clientY
    }
    const onUp = () => { dragging = false }
    const onWheel = (event) => { camera.position.multiplyScalar(event.deltaY > 0 ? 1.06 : .94); camera.position.clampLength(9, 25) }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointercancel', onUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true })
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animate = (now) => {
      if (disposed) return
      const points = frameRef.current.points || []
      let waterIndex = 0
      points.forEach((point, markerIndex) => {
        const x = clamp(point.terrain_x, -7, 7)
        const z = clamp(point.terrain_z, -7, 7)
        const depth = point.current_depth_cm || 0
        if (depth >= 8 && waterIndex < 64) {
          const spread = .75 // Point glyph, not a fabricated inundation footprint.
          waterDummy.position.set(x, terrainHeight(x, z) + depth / 100 * .16 + .028 + (reduced ? 0 : Math.sin(now / 650 + waterIndex) * .006), z)
          waterDummy.scale.set(spread * 1.12, 1, spread * .76)
          waterDummy.updateMatrix()
          water.setMatrixAt(waterIndex, waterDummy.matrix)
          water.setColorAt(waterIndex, colorForDepth(depth))
          waterIndex += 1
        }
        pointDummy.position.set(x, terrainHeight(x, z) + .13 + Math.min(depth, 80) / 360, z)
        const markerScale = point.point_id === frameRef.current.selectedPointId ? 2.2 : depth >= 8 ? 1 + Math.min(depth, 80) / 100 : .72
        pointDummy.scale.setScalar(markerScale)
        pointDummy.updateMatrix()
        pointMarkers.setMatrixAt(markerIndex, pointDummy.matrix)
        pointMarkers.setColorAt(markerIndex, colorForDepth(depth))
      })
      water.count = waterIndex; water.instanceMatrix.needsUpdate = true
      if (water.instanceColor) water.instanceColor.needsUpdate = true
      pointMarkers.count = points.length; pointMarkers.instanceMatrix.needsUpdate = true
      if (pointMarkers.instanceColor) pointMarkers.instanceColor.needsUpdate = true
      try {
        renderer.render(scene, camera)
        if (!rendered) rendered = true
      } catch { setFallback(true); return }
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => {
      disposed = true; cancelAnimationFrame(raf); clearTimeout(fallbackTimer); observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('pointercancel', onUp); renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.dispose(); groundGeo.dispose(); buildingGeo.dispose(); roofGeo.dispose(); windowGeo.dispose(); waterGeo.dispose(); pointGeo.dispose(); buildingMat.dispose(); roofMat.dispose(); windowMat.dispose(); roadMat.dispose(); waterMat.dispose(); pointMat.dispose(); scene.traverse((object) => { if (object.geometry && object !== ground && object !== buildings && object !== water && object !== roofs && object !== windows && object !== pointMarkers) object.geometry.dispose() })
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement)
    }
  }, [])
  return <div className="zv-scene-wrap"><div className="zv-scene" ref={hostRef} aria-label={`${cityName}参数化示意地形3D沙盘`}/>{fallback && <div className="zv-scene-fallback" aria-label="合成地形三维示意图">
    <div className="zv-fallback-plane">{Array.from({ length: 24 }, (_, index) => {
      const col = (index * 7 + 3) % 9, row = Math.floor(index / 3) % 8
      const active = (Math.abs(Math.sin(col * 1.23 + row * 2.7) * Math.cos(row * .7 - col * .9))) <= frame.stress + .08
      const height = 16 + ((index * 13) % 42)
      return <span key={index} className={`zv-fallback-building ${active ? 'near-water' : ''}`} style={{ left: `${8 + col * 9}%`, top: `${8 + row * 10}%`, height: `${height}px`, '--tower-h': `${height}px` }}><i/></span>
    })}{(frame.points || []).filter((point) => point.current_depth_cm >= 8).map((point) => {
      const depth = point.current_depth_cm
      return <span key={`water-${point.id}`} className={`zv-fallback-water ${depth >= 60 ? 'deep' : depth >= 30 ? 'moderate' : ''}`} style={{ left: `${50 + point.terrain_x * 3.3}%`, top: `${50 + point.terrain_z * 3.3}%`, opacity: .42 + Math.min(depth, 80) / 150 }} title={`${point.label || '点位'} · ${depth} cm`}/>
    })}{(frame.points || []).map((point) => <i key={`mark-${point.id}`} className={`zv-fallback-marker ${point.current_depth_cm >= 60 ? 'deep' : point.current_depth_cm >= 30 ? 'moderate' : ''}`} style={{ left: `${50 + point.terrain_x * 3.3}%`, top: `${50 + point.terrain_z * 3.3}%` }} title={`${point.label || '点位'} · ${point.current_depth_cm} cm`}/>)}</div><span className="zv-fallback-axis">合成相对高程</span>
  </div>}<div className="zv-scene-overlay"><span>3D TERRAIN LAB</span><strong>{cityName} · 相对高程</strong></div><div className="zv-scene-legend"><i className="elevation-low"/>低地 <i className="elevation-high"/>高地 <i className="deep"/>≥60 cm <i className="building"/>合成建筑</div></div>
}

function Field({ label, value, min, max, unit, onChange }) {
  return <label className="zv-field"><span><strong>{label}</strong><small>{value}{unit}</small></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))}/><span className="zv-range"><i>{min}{unit}</i><i>{max}{unit}</i></span></label>
}

function CustomVisualLab({ city }) {
  const [selectedPointId, setSelectedPointId] = useState(null)
  const [cityId, setCityId] = useState(city?.id || 'ningbo')
  const [presetId, setPresetId] = useState('compound')
  const [inputs, setInputs] = useState(presets[0])
  const [hour, setHour] = useState(8)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { if (city) setCityId(city.id) }, [city?.id])
  const selectedCity = ZHEJIANG_CITIES.find((item) => item.id === cityId) || ZHEJIANG_CITIES[0]
  const series = useMemo(() => makeSeries(inputs), [inputs])
  const frame = series[hour]
  const customTerrainPoints = useMemo(() => makeCustomGrid(frame.stress), [frame.stress])
  useEffect(() => {
    if (!playing) return undefined
    const timer = setInterval(() => setHour((value) => (value + 1) % 25), 850)
    return () => clearInterval(timer)
  }, [playing])
  const update = (key, value) => { setPresetId('custom'); setInputs((current) => { const next = { ...current, [key]: value }; next.peak = Math.max(Math.ceil(next.rain/24), next.peak); return next }) }
  const choosePreset = (id) => { const preset = presets.find((item) => item.id === id); if (preset) { setPresetId(id); setInputs(preset) } }
  return <section className="zv-lab zo-card" aria-labelledby="zv-title">
    <header className="zv-header"><div><small>SCENARIO VISUALIZATION / INTERACTIVE MODEL</small><h2 id="zv-title">情景沙盘</h2></div><span className="zv-sim-badge"><i/>演示</span></header>
    <div className="zv-toolbar"><label>情景预设<select value={presetId} onChange={(event) => choosePreset(event.target.value)}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}<option value="custom" disabled>自定义参数</option></select></label><label>研究城市<select value={cityId} disabled={!!city} onChange={(event) => setCityId(event.target.value)}>{ZHEJIANG_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="zv-toolbar-meta"><span>第 {String(hour).padStart(2, '0')} 小时</span><button type="button" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>{playing ? '暂停演示' : '▶ 播放演示'}</button></div></div>
    <div className="zv-control-row">
      <Field label="24h 假设雨量" value={inputs.rain} min={100} max={360} unit=" mm" onChange={(value) => update('rain', value)}/>
      <Field label="1h 峰值假设" value={inputs.peak} min={Math.max(10, Math.ceil(inputs.rain/24))} max={100} unit=" mm/h" onChange={(value) => update('peak', value)}/>
      <Field label="潮位边界等级" value={inputs.tide} min={0} max={4} unit=" / 4" onChange={(value) => update('tide', value)}/>
      <Field label="河网边界等级" value={inputs.river} min={0} max={4} unit=" / 4" onChange={(value) => update('river', value)}/>
      <Field label="排水能力假设" value={inputs.drainage} min={10} max={100} unit="%" onChange={(value) => update('drainage', value)}/>
    </div>
    <FloodGridView dataset={{ model: { engine: 'browser_rules', version: 'tabletop-visual-v1' }, scenario: { inputs, time_basis: 'relative_scenario_hours' } }} cityId={selectedCity.id} points={customTerrainPoints} hour={hour} selectedId={selectedPointId} onSelect={setSelectedPointId}/>
    <div className="zv-visual-grid">
      <article className="zv-panel"><div className="zv-panel-title"><div><small>01 / SPATIAL RESPONSE</small><h3>相对高程与情景水面 · 3D</h3></div></div><TerrainScene frame={{ ...frame, points: customTerrainPoints, selectedPointId: selectedPointId || customTerrainPoints[0]?.point_id }} cityName={selectedCity.name}/><div className="zv-frame-caption"><strong>{customTerrainPoints.filter((point) => point.current_depth_cm >= 8).length}</strong><span>点位达到8 cm阈值</span><b>情景时刻 T+{String(hour).padStart(2, '0')}h</b></div></article>
      <article className="zv-panel"><div className="zv-panel-title"><div><small>02 / TEMPORAL RESPONSE</small><h3>降雨与响应</h3></div></div><div className="zv-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series} margin={{ top: 15, right: 8, bottom: 4, left: -18 }} onClick={(state) => { if (Number.isInteger(state?.activeTooltipIndex)) { setHour(state.activeTooltipIndex); setPlaying(false) } }}>
        <defs><linearGradient id="wetFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4b9ad1" stopOpacity={.3}/><stop offset="100%" stopColor="#4b9ad1" stopOpacity={.02}/></linearGradient></defs>
        <CartesianGrid stroke="#e2eaf1" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="hour" tickFormatter={(value) => `${value}h`} tick={{ fill: '#65788d', fontSize: 10 }} axisLine={{ stroke: '#c9d5df' }} tickLine={false}/><YAxis yAxisId="rain" tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false} label={{ value: 'mm/h', angle: -90, position: 'insideLeft', fill: '#65788d', fontSize: 9 }}/><YAxis yAxisId="wet" orientation="right" domain={[0, 500]} tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ border: '1px solid #d7e1eb', borderRadius: 9, color: '#24364a', fontSize: 11 }} formatter={(value, name) => [name === 'rain' ? `${value} mm/h` : `${value} 个示意单元`, name === 'rain' ? '假设降雨' : '规则响应']} labelFormatter={(value) => `情景第 ${value} 小时`}/><ReferenceLine x={hour} yAxisId="rain" stroke="#284d72" strokeDasharray="4 4"/><Area yAxisId="wet" type="monotone" dataKey="wetCells" stroke="#4b9ad1" strokeWidth={2.5} fill="url(#wetFill)" activeDot={{ r: 5, onClick: (_, payload) => { setHour(payload?.payload?.hour ?? hour); setPlaying(false) } }} isAnimationActive={false}/><Line yAxisId="rain" type="monotone" dataKey="rain" stroke="#d49a63" strokeWidth={2} dot={false} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer></div><div className="zv-chart-legend"><span><i className="rain"/>假设小时雨量（左轴）</span><span><i className="response"/>规则响应单元（右轴）</span></div><div className="zv-chart-current"><span>累计假设降雨 <strong>{frame.cumulative.toFixed(1)} mm</strong></span><span>规则压力指数 <strong>{Math.round(frame.stress * 100)} / 100</strong></span></div></article>
    </div>
    <div className="zv-timeline"><button type="button" onClick={() => { setPlaying(false); setHour(0) }}>↺ 重置</button><input aria-label="情景时间轴" type="range" min="0" max="24" value={hour} onChange={(event) => { setHour(Number(event.target.value)); setPlaying(false) }}/><span>T+00h</span><span>T+24h</span></div>
  </section>
}

function EventVisualLab({ city, dataset, demoHour, onDemoHourChange }) {
  const [cityId, setCityId] = useState(city?.id || 'ningbo')
  const [selectedPointId, setSelectedPointId] = useState(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { if (city) setCityId(city.id) }, [city?.id])
  const selectedCity = ZHEJIANG_CITIES.find((item) => item.id === cityId) || ZHEJIANG_CITIES[0]
  const rows = dataset.timeline.filter((row) => row.city_id === selectedCity.id)
  const frame = rows.find((row) => row.hour === demoHour) || rows[0]
  const currentPoints = demoRankedPoints(dataset, [selectedCity.id], demoHour)
  const activePoints = currentPoints.filter((point) => point.current_depth_cm >= 8)
  const setHour = onDemoHourChange || noop
  const duration = dataset.scenario.duration_hours
  useEffect(() => {
    if (!playing) return undefined
    if (demoHour >= duration) { setPlaying(false); return undefined }
    const timer = setTimeout(() => setHour(demoHour + 1), 700)
    return () => clearTimeout(timer)
  }, [playing, demoHour, duration, setHour])
  return <section className="zv-lab zo-card" aria-labelledby="zv-event-title">
    <header className="zv-header"><div><small>EVENT VISUALIZATION / HOURLY SCENARIO</small><h2 id="zv-event-title">台风过程</h2></div><span className="zv-sim-badge"><i/>演示</span></header>
    <div className="zv-toolbar"><label>三维示例城市<select value={cityId} disabled={!!city} onChange={(event) => setCityId(event.target.value)}>{ZHEJIANG_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="zv-toolbar-meta"><span>{demoTimeLabel(demoHour, dataset.scenario.landfall_hour)} · 每6小时更新周期</span><button type="button" onClick={() => { if (!playing && demoHour >= duration) setHour(0); setPlaying((value) => !value) }} aria-pressed={playing}>{playing ? '暂停逐小时演示' : '▶ 播放逐小时过程'}</button></div></div>
    <FloodGridView dataset={dataset} cityId={selectedCity.id} points={currentPoints} hour={demoHour} selectedId={selectedPointId} onSelect={setSelectedPointId}/>
    <div className="zv-visual-grid">
      <article className="zv-panel"><div className="zv-panel-title"><div><small>RELATIVE RELIEF / NODE PONDING</small><h3>相对地形与节点蓄水 · 3D</h3></div></div><TerrainScene frame={{ stress: frame.water_index, wetCells: Math.round(frame.water_index * 100), points: currentPoints, selectedPointId: selectedPointId || currentPoints[0]?.point_id }} cityName={selectedCity.name}/><div className="zv-frame-caption"><strong>{activePoints.length}</strong><span>点位达到8 cm阈值</span><b>最高水深 {Math.max(0, ...activePoints.map((point) => point.current_depth_cm))} cm</b></div></article>
      <article className="zv-panel"><div className="zv-panel-title"><div><small>02 / HOURLY CITY RESPONSE</small><h3>{selectedCity.name} · 雨强与节点水深</h3></div></div><div className="zv-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 15, right: 8, bottom: 4, left: -18 }} onClick={(state) => { const hour = state?.activePayload?.[0]?.payload?.hour; if (Number.isInteger(hour)) { setHour(hour); setPlaying(false) } }}>
        <defs><linearGradient id="eventStressFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4b9ad1" stopOpacity={.34}/><stop offset="100%" stopColor="#4b9ad1" stopOpacity={.03}/></linearGradient></defs>
        <CartesianGrid stroke="#e2eaf1" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="hour" interval={5} tickFormatter={(value) => demoTimeLabel(Number(value), dataset.scenario.landfall_hour).replace(' ', '')} tick={{ fill: '#65788d', fontSize: 9 }} axisLine={{ stroke: '#c9d5df' }} tickLine={false}/><YAxis yAxisId="rain" tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false} label={{ value: 'mm/h', angle: -90, position: 'insideLeft', fill: '#65788d', fontSize: 9 }}/><YAxis yAxisId="stress" orientation="right" domain={[0, 1]} tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ border: '1px solid #d7e1eb', borderRadius: 9, color: '#24364a', fontSize: 11 }} formatter={(value, name) => [name === '情景小时雨强' ? `${value} mm/h` : value, name]} labelFormatter={(value) => `${demoTimeLabel(Number(value), dataset.scenario.landfall_hour)} · 第${value}小时`}/>{Array.from({ length: 13 }, (_, index) => index * 6).map((hour) => <ReferenceLine key={hour} x={hour} yAxisId="stress" stroke="#a8b9c8" strokeDasharray="2 5"/>)}<ReferenceLine x={demoHour} yAxisId="rain" stroke="#284d72" strokeWidth={2} strokeDasharray="4 4"/><Area yAxisId="stress" type="monotone" dataKey="water_index" name="归一化节点水深" stroke="#4b9ad1" strokeWidth={2.5} fill="url(#eventStressFill)" isAnimationActive={false}/><Line yAxisId="rain" type="monotone" dataKey="rainfall_rate_mm_h" name="情景小时雨强" stroke="#d49a63" strokeWidth={2} dot={false} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer></div><div className="zv-chart-legend"><span><i className="rain"/>情景雨强（左轴）</span><span><i className="response"/>归一化最高水深（右轴）</span><span>虚线：6小时更新</span></div><div className="zv-chart-current"><span>6小时雨量 <strong>{frame.rainfall_6h_mm.toFixed(1)} mm</strong></span><span>当前水深点位 <strong>{activePoints.length}</strong></span></div></article>
    </div>
    <div className="zv-timeline"><button type="button" onClick={() => { setPlaying(false); setHour(0) }}>↺ 回到登陆前24h</button><input aria-label="模拟台风逐小时时间轴" type="range" min="0" max={duration} step="1" value={demoHour} onChange={(event) => { setHour(Number(event.target.value)); setPlaying(false) }}/><span>T−24h</span><span>登陆 T0</span><span>T+48h</span></div>
  </section>
}

export default function ZhejiangVisualLab({ city, dataset, demoMode, demoHour, onDemoHourChange }) {
  const [mode, setMode] = useState(demoMode === 'demo' ? 'event' : 'custom')
  useEffect(() => setMode(demoMode === 'demo' ? 'event' : 'custom'), [demoMode])
  if (demoMode !== 'demo' || !dataset) return <CustomVisualLab city={city}/>
  return <div className="zv-module">
    <div className="zv-mode-switch" role="tablist" aria-label="可视化模式"><button type="button" role="tab" aria-selected={mode === 'event'} className={mode === 'event' ? 'active' : ''} onClick={() => setMode('event')}>模拟台风过程</button><button type="button" role="tab" aria-selected={mode === 'custom'} className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>自定义情景预演</button></div>
    {mode === 'event' ? <EventVisualLab city={city} dataset={dataset} demoHour={demoHour} onDemoHourChange={onDemoHourChange}/> : <CustomVisualLab city={city}/>}
  </div>
}
