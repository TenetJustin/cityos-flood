import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ZHEJIANG_CITIES } from './zhejiangData.js'
import { demoPointDepth, demoTimeLabel } from './zhejiangDemoData.js'

const presets = [
  { id: 'compound', name: '复合暴雨压力', rain: 220, peak: 64, tide: 3, river: 2, drainage: 38 },
  { id: 'coastal', name: '暴雨 + 高潮位假设', rain: 180, peak: 52, tide: 4, river: 2, drainage: 45 },
  { id: 'river', name: '暴雨 + 河网顶托假设', rain: 200, peak: 58, tide: 2, river: 4, drainage: 42 },
  { id: 'capacity', name: '排水能力敏感性', rain: 150, peak: 42, tide: 2, river: 2, drainage: 72 },
]

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const noop = () => {}
function makeSeries(inputs) {
  const profile = [0,0,0,0,0,0,1,2,3,5,8,12,18,24,29,27,22,18,14,11,8,6,4,3,2]
  const peakIndex = profile.indexOf(Math.max(...profile))
  const otherHours = profile.reduce((a, b, i) => a + (i === peakIndex ? 0 : b), 0)
  const corrected = profile.map((v, i) => i === peakIndex ? inputs.peak : v / otherHours * (inputs.rain - inputs.peak))
  return Array.from({ length: 25 }, (_, hour) => {
    const cumulative = corrected.slice(0, hour + 1).reduce((a, b) => a + b, 0)
    const rainHour = hour === 0 ? 0 : corrected[hour - 1]
    const drain = inputs.drainage / 100
    const boundary = (inputs.tide + inputs.river) / 8
    const stress = clamp((cumulative / Math.max(inputs.rain, 1)) * .62 + (rainHour / 100) * .2 + boundary * .34 - drain * .24, 0, 1)
    return { hour, rain: Number(rainHour.toFixed(1)), cumulative: Number(cumulative.toFixed(1)), stress: Number(stress.toFixed(3)), wetCells: Math.round(8 + stress * stress * 420) }
  })
}

function terrainHeight(x, z) {
  const ridge = Math.sin(x * .42 + z * .18) * .16 + Math.cos(z * .55 - x * .2) * .12
  const basin = Math.exp(-((x - 2.5) ** 2 + (z + 1.8) ** 2) / 22) * -.25
  return ridge + basin + Math.sin(x * .13) * .08
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
    const low = new THREE.Color('#8faea9'), high = new THREE.Color('#bac9bd')
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), z = pos.getZ(i)
      const h = terrainHeight(x, z)
      pos.setY(i, h)
      const c = low.clone().lerp(high, clamp((h + .3) / .8, 0, 1))
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
      const avenue = new THREE.Mesh(new THREE.BoxGeometry(.54, .018, 16), roadMat)
      avenue.position.set(offset, -.185, 0); root.add(avenue)
      const crossStreet = new THREE.Mesh(new THREE.BoxGeometry(16, .018, .54), roadMat)
      crossStreet.position.set(0, -.183, offset); root.add(crossStreet)
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
    const water = new THREE.InstancedMesh(waterGeo, waterMat, 96)
    water.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(water)
    const waterDummy = new THREE.Object3D()
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
      const count = Math.round(frameRef.current.stress * 84)
      let idx = 0
      for (let z = -7.2; z <= 7.2 && idx < count; z += .9) for (let x = -7.2; x <= 7.2 && idx < count; x += .9) {
        const basinBias = Math.exp(-((x - 2.5) ** 2 + (z + 1.8) ** 2) / 28)
        const mod = Math.abs(Math.sin(x * 1.23 + z * 2.7) * Math.cos(z * .7 - x * .9)) * .68 + basinBias * .48
        if (mod > frameRef.current.stress + .08) continue
        waterDummy.position.set(x, terrainHeight(x, z) + .055 + (reduced ? 0 : Math.sin(now / 650 + idx) * .009), z)
        const spread = clamp(.48 + frameRef.current.stress * .85 + basinBias * .55, .48, 1.45)
        waterDummy.scale.set(spread * (1 + mod * .25), 1, spread * (.72 + mod * .2)); waterDummy.updateMatrix(); water.setMatrixAt(idx++, waterDummy.matrix)
      }
      water.count = idx; water.instanceMatrix.needsUpdate = true
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
      renderer.dispose(); groundGeo.dispose(); buildingGeo.dispose(); roofGeo.dispose(); windowGeo.dispose(); waterGeo.dispose(); buildingMat.dispose(); roofMat.dispose(); windowMat.dispose(); roadMat.dispose(); waterMat.dispose(); scene.traverse((object) => { if (object.geometry && object !== ground && object !== buildings && object !== water && object !== roofs && object !== windows) object.geometry.dispose() })
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement)
    }
  }, [])
  return <div className="zv-scene-wrap"><div className="zv-scene" ref={hostRef} aria-label={`${cityName}参数化示意地形3D沙盘`}/>{fallback && <div className="zv-scene-fallback" aria-label="合成地形三维示意图">
    <div className="zv-fallback-plane">{Array.from({ length: 24 }, (_, index) => {
      const col = (index * 7 + 3) % 9, row = Math.floor(index / 3) % 8
      const active = (Math.abs(Math.sin(col * 1.23 + row * 2.7) * Math.cos(row * .7 - col * .9))) <= frame.stress + .08
      const height = 16 + ((index * 13) % 42)
      return <span key={index} className={`zv-fallback-building ${active ? 'near-water' : ''}`} style={{ left: `${8 + col * 9}%`, top: `${8 + row * 10}%`, height: `${height}px`, '--tower-h': `${height}px` }}><i/></span>
    })}{Array.from({ length: Math.max(4, Math.round(frame.stress * 45)) }, (_, index) => {
      const col = (index * 5 + 2) % 10, row = Math.floor(index * 1.8 + 2) % 10
      return <span key={`water-${index}`} className="zv-fallback-water" style={{ left: `${6 + col * 8.7}%`, top: `${8 + row * 8.3}%`, opacity: .4 + frame.stress * .52 }}/>
    })}</div><span className="zv-fallback-axis">合成地形 / 示意模型</span>
  </div>}<div className="zv-scene-overlay"><span>3D TERRAIN LAB</span><strong>{cityName} · 城市街区合成模型</strong></div><div className="zv-scene-legend"><i/>情景积水斑块 <i className="building"/>合成建筑</div><div className="zv-scene-instructions">拖动旋转 · 滚轮缩放 · 时间轴驱动积水斑块扩展</div></div>
}

function Field({ label, value, min, max, unit, onChange }) {
  return <label className="zv-field"><span><strong>{label}</strong><small>{value}{unit}</small></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))}/><span className="zv-range"><i>{min}{unit}</i><i>{max}{unit}</i></span></label>
}

function CustomVisualLab({ city }) {
  const [cityId, setCityId] = useState(city?.id || 'ningbo')
  const [presetId, setPresetId] = useState('compound')
  const [inputs, setInputs] = useState(presets[0])
  const [hour, setHour] = useState(8)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { if (city) setCityId(city.id) }, [city?.id])
  const selectedCity = ZHEJIANG_CITIES.find((item) => item.id === cityId) || ZHEJIANG_CITIES[0]
  const series = useMemo(() => makeSeries(inputs), [inputs])
  const frame = series[hour]
  useEffect(() => {
    if (!playing) return undefined
    const timer = setInterval(() => setHour((value) => (value + 1) % 25), 850)
    return () => clearInterval(timer)
  }, [playing])
  const update = (key, value) => { setPresetId('custom'); setInputs((current) => ({ ...current, [key]: value })) }
  const choosePreset = (id) => { const preset = presets.find((item) => item.id === id); if (preset) { setPresetId(id); setInputs(preset) } }
  return <section className="zv-lab zo-card" aria-labelledby="zv-title">
    <header className="zv-header"><div><small>SCENARIO VISUALIZATION / INTERACTIVE MODEL</small><h2 id="zv-title">情景沙盘 · 驱动与响应</h2><p>调节边界条件，联动查看合成地形上的情景变化</p></div><span className="zv-sim-badge"><i/>模拟情景 · 非实况</span></header>
    <div className="zv-toolbar"><label>情景预设<select value={presetId} onChange={(event) => choosePreset(event.target.value)}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}<option value="custom" disabled>自定义参数</option></select></label><label>研究城市<select value={cityId} disabled={!!city} onChange={(event) => setCityId(event.target.value)}>{ZHEJIANG_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="zv-toolbar-meta"><span>第 {String(hour).padStart(2, '0')} 小时</span><button type="button" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>{playing ? '暂停演示' : '▶ 播放演示'}</button></div></div>
    <div className="zv-control-row">
      <Field label="24h 假设雨量" value={inputs.rain} min={100} max={360} unit=" mm" onChange={(value) => update('rain', value)}/>
      <Field label="1h 峰值假设" value={inputs.peak} min={10} max={100} unit=" mm/h" onChange={(value) => update('peak', value)}/>
      <Field label="潮位边界等级" value={inputs.tide} min={0} max={4} unit=" / 4" onChange={(value) => update('tide', value)}/>
      <Field label="河网边界等级" value={inputs.river} min={0} max={4} unit=" / 4" onChange={(value) => update('river', value)}/>
      <Field label="排水能力假设" value={inputs.drainage} min={10} max={100} unit="%" onChange={(value) => update('drainage', value)}/>
    </div>
    <div className="zv-visual-grid">
      <article className="zv-panel"><div className="zv-panel-title"><div><small>01 / SPATIAL RESPONSE</small><h3>二维合成地形 · 3D 视角</h3></div><span>水面随时间变化</span></div><TerrainScene frame={frame} cityName={selectedCity.name}/><div className="zv-frame-caption"><strong>{frame.wetCells}</strong><span>示意网格响应单元</span><b>情景时刻 T+{String(hour).padStart(2, '0')}h</b></div></article>
      <article className="zv-panel"><div className="zv-panel-title"><div><small>02 / TEMPORAL RESPONSE</small><h3>降雨驱动与规则响应</h3></div><span>可交互时间序列</span></div><div className="zv-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series} margin={{ top: 15, right: 8, bottom: 4, left: -18 }} onClick={(state) => { if (Number.isInteger(state?.activeTooltipIndex)) { setHour(state.activeTooltipIndex); setPlaying(false) } }}>
        <defs><linearGradient id="wetFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4b9ad1" stopOpacity={.3}/><stop offset="100%" stopColor="#4b9ad1" stopOpacity={.02}/></linearGradient></defs>
        <CartesianGrid stroke="#e2eaf1" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="hour" tickFormatter={(value) => `${value}h`} tick={{ fill: '#65788d', fontSize: 10 }} axisLine={{ stroke: '#c9d5df' }} tickLine={false}/><YAxis yAxisId="rain" tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false} label={{ value: 'mm/h', angle: -90, position: 'insideLeft', fill: '#65788d', fontSize: 9 }}/><YAxis yAxisId="wet" orientation="right" domain={[0, 500]} tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ border: '1px solid #d7e1eb', borderRadius: 9, color: '#24364a', fontSize: 11 }} formatter={(value, name) => [name === 'rain' ? `${value} mm/h` : `${value} 个示意单元`, name === 'rain' ? '假设降雨' : '规则响应']} labelFormatter={(value) => `情景第 ${value} 小时`}/><ReferenceLine x={hour} yAxisId="rain" stroke="#284d72" strokeDasharray="4 4"/><Area yAxisId="wet" type="monotone" dataKey="wetCells" stroke="#4b9ad1" strokeWidth={2.5} fill="url(#wetFill)" activeDot={{ r: 5, onClick: (_, payload) => { setHour(payload?.payload?.hour ?? hour); setPlaying(false) } }} isAnimationActive={false}/><Line yAxisId="rain" type="monotone" dataKey="rain" stroke="#d49a63" strokeWidth={2} dot={false} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer></div><div className="zv-chart-legend"><span><i className="rain"/>假设小时雨量（左轴）</span><span><i className="response"/>规则响应单元（右轴）</span></div><div className="zv-chart-current"><span>累计假设降雨 <strong>{frame.cumulative.toFixed(1)} mm</strong></span><span>规则压力指数 <strong>{Math.round(frame.stress * 100)} / 100</strong></span></div></article>
    </div>
    <div className="zv-timeline"><button type="button" onClick={() => { setPlaying(false); setHour(0) }}>↺ 重置</button><input aria-label="情景时间轴" type="range" min="0" max="24" value={hour} onChange={(event) => { setHour(Number(event.target.value)); setPlaying(false) }}/><span>T+00h</span><span>T+24h</span></div>
    <p className="zv-boundary"><strong>真实性边界</strong>：降雨、潮位、河网和排水参数为人为设定的假设值；地形与建筑是合成示意；蓝色区域、响应单元和指数均由演示规则生成，不表示真实地点、积水深度/范围、居民实际行为或经验证的城市预测。</p>
  </section>
}

function EventVisualLab({ city, dataset, demoHour, onDemoHourChange }) {
  const [cityId, setCityId] = useState(city?.id || 'ningbo')
  const [playing, setPlaying] = useState(false)
  useEffect(() => { if (city) setCityId(city.id) }, [city?.id])
  const selectedCity = ZHEJIANG_CITIES.find((item) => item.id === cityId) || ZHEJIANG_CITIES[0]
  const rows = dataset.timeline.filter((row) => row.city_id === selectedCity.id)
  const frame = rows.find((row) => row.hour === demoHour) || rows[0]
  const activePoints = dataset.points.filter((point) => point.city_id === selectedCity.id && demoPointDepth(point, demoHour, dataset) >= 8)
  const setHour = onDemoHourChange || noop
  const duration = dataset.scenario.duration_hours
  useEffect(() => {
    if (!playing) return undefined
    if (demoHour >= duration) { setPlaying(false); return undefined }
    const timer = setTimeout(() => setHour(demoHour + 1), 700)
    return () => clearTimeout(timer)
  }, [playing, demoHour, duration, setHour])
  return <section className="zv-lab zo-card" aria-labelledby="zv-event-title">
    <header className="zv-header"><div><small>EVENT VISUALIZATION / HOURLY SCENARIO</small><h2 id="zv-event-title">台风过程 · 三维影响示意</h2><p>{dataset.scenario.name} · 与逐小时地图、风险曲线和建议共享同一时间</p></div><span className="zv-sim-badge"><i/>模拟情景 · 非实时</span></header>
    <div className="zv-toolbar"><label>三维示例城市<select value={cityId} disabled={!!city} onChange={(event) => setCityId(event.target.value)}>{ZHEJIANG_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="zv-toolbar-meta"><span>{demoTimeLabel(demoHour, dataset.scenario.landfall_hour)} · 每6小时更新周期</span><button type="button" onClick={() => { if (!playing && demoHour >= duration) setHour(0); setPlaying((value) => !value) }} aria-pressed={playing}>{playing ? '暂停逐小时演示' : '▶ 播放逐小时过程'}</button></div></div>
    <div className="zv-visual-grid">
      <article className="zv-panel"><div className="zv-panel-title"><div><small>01 / PROCEDURAL CITY BLOCK</small><h3>参数化合成街区 · 3D水面演示</h3></div><span>随所选小时更新</span></div><TerrainScene frame={{ stress: frame.water_index, wetCells: Math.round(frame.water_index * 100) }} cityName={selectedCity.name}/><div className="zv-frame-caption"><strong>{Math.round(frame.water_index * 100)}</strong><span>情景压力指数 / 100</span><b>{activePoints.length} 个演示点位达到水深阈值</b></div></article>
      <article className="zv-panel"><div className="zv-panel-title"><div><small>02 / HOURLY CITY RESPONSE</small><h3>{selectedCity.name} · 雨强与情景压力</h3></div><span>逐小时规则演算</span></div><div className="zv-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 15, right: 8, bottom: 4, left: -18 }} onClick={(state) => { const hour = state?.activePayload?.[0]?.payload?.hour; if (Number.isInteger(hour)) { setHour(hour); setPlaying(false) } }}>
        <defs><linearGradient id="eventStressFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4b9ad1" stopOpacity={.34}/><stop offset="100%" stopColor="#4b9ad1" stopOpacity={.03}/></linearGradient></defs>
        <CartesianGrid stroke="#e2eaf1" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="hour" interval={5} tickFormatter={(value) => demoTimeLabel(Number(value), dataset.scenario.landfall_hour).replace(' ', '')} tick={{ fill: '#65788d', fontSize: 9 }} axisLine={{ stroke: '#c9d5df' }} tickLine={false}/><YAxis yAxisId="rain" tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false} label={{ value: 'mm/h', angle: -90, position: 'insideLeft', fill: '#65788d', fontSize: 9 }}/><YAxis yAxisId="stress" orientation="right" domain={[0, 1]} tick={{ fill: '#65788d', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ border: '1px solid #d7e1eb', borderRadius: 9, color: '#24364a', fontSize: 11 }} formatter={(value, name) => [name === '情景小时雨强' ? `${value} mm/h` : value, name]} labelFormatter={(value) => `${demoTimeLabel(Number(value), dataset.scenario.landfall_hour)} · 第${value}小时`}/>{Array.from({ length: 13 }, (_, index) => index * 6).map((hour) => <ReferenceLine key={hour} x={hour} yAxisId="stress" stroke="#a8b9c8" strokeDasharray="2 5"/>)}<ReferenceLine x={demoHour} yAxisId="rain" stroke="#284d72" strokeWidth={2} strokeDasharray="4 4"/><Area yAxisId="stress" type="monotone" dataKey="water_index" name="情景压力指数" stroke="#4b9ad1" strokeWidth={2.5} fill="url(#eventStressFill)" isAnimationActive={false}/><Line yAxisId="rain" type="monotone" dataKey="rainfall_rate_mm_h" name="情景小时雨强" stroke="#d49a63" strokeWidth={2} dot={false} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer></div><div className="zv-chart-legend"><span><i className="rain"/>情景雨强（左轴）</span><span><i className="response"/>规则压力指数（右轴）</span><span>虚线：6小时更新</span></div><div className="zv-chart-current"><span>6小时雨量 <strong>{frame.rainfall_6h_mm.toFixed(1)} mm</strong></span><span>当前水深点位 <strong>{activePoints.length}</strong></span></div></article>
    </div>
    <div className="zv-timeline"><button type="button" onClick={() => { setPlaying(false); setHour(0) }}>↺ 回到登陆前24h</button><input aria-label="模拟台风逐小时时间轴" type="range" min="0" max={duration} step="1" value={demoHour} onChange={(event) => { setHour(Number(event.target.value)); setPlaying(false) }}/><span>T−24h</span><span>登陆 T0</span><span>T+48h</span></div>
    <p className="zv-boundary"><strong>真实性边界</strong>：台风路径、城市风险指数、雨强与点位水深是规则合成数据；三维街区为参数化示意，不是浙江真实建筑或积水淹没范围。6小时更新周期是演示流程设定，小时之间不代表新增实时数据。</p>
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
