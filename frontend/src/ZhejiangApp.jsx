import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { CircleMarker, MapContainer, Polyline, Rectangle, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { CITY_CHECKS, ZHEJIANG_CITIES, ZHEJIANG_EVENTS } from './zhejiangData.js'
import { assessZhejiangSnapshot } from './zhejiangObservations.js'
import HistoricalTrackPanel from './HistoricalTrackPanel.jsx'
import HistoricalRainPanel from './HistoricalRainPanel.jsx'
import { ScenarioStudio } from './ScenarioStudio.jsx'
import RealEventPanel from './RealEventPanel.jsx'
import { assessForecastSnapshot, cityForecast, forecastDisplayStatus } from './zhejiangForecast.js'
import { activeFloodPointCount, assessRealEventSnapshot } from './realEventEvidence.js'
import { assessZhejiangRealtimeSnapshot, zhejiangRealtimeEndpoint } from './zhejiangRealtime.js'
import { cityDemoData, demoCityAtHour, demoPointAdvice, demoPointDepth, demoTimeLabel, validateDemoDataset } from './zhejiangDemoData.js'
import './zhejiang.css'

const ZhejiangVisualLab = lazy(() => import('./ZhejiangVisualLab.jsx'))
const DemoEventPanel = lazy(() => import('./DemoEventPanel.jsx'))

const cityById = (id) => ZHEJIANG_CITIES.find((city) => city.id === id)
const time = (value) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
  : '—'
const cityPath = (cityId, section = '') => `/workbench/${cityId}${section ? `/${section}` : ''}`

function useObservations() {
  const [result, setResult] = useState({ state: 'loading', data: null })
  useEffect(() => {
    let active = true
    const load = () => fetch(`${import.meta.env.BASE_URL}data/zhejiang-observations.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => { if (active) { const assessment = assessZhejiangSnapshot(data); setResult({ state: assessment.valid && data.state === 'ok' ? 'ok' : 'unavailable', data: assessment.valid ? data : null, assessment }) } })
      .catch(() => { if (active) setResult({ state: 'unavailable', data: null }) })
    load()
    const timer = setInterval(load, 5 * 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return result
}

function useRealEventEvidence() {
  const [result, setResult] = useState({ state: 'loading', data: null, checkedAt: Date.now() })
  useEffect(() => {
    let active = true
    const load = () => fetch(`${import.meta.env.BASE_URL}data/zhejiang-real-events.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => { if (active) { const assessment = assessRealEventSnapshot(data); setResult({ state: assessment.valid ? data.state : 'invalid', data: assessment.valid ? data : null, checkedAt: Date.now() }) } })
      .catch(() => { if (active) setResult({ state: 'unavailable', data: null, checkedAt: Date.now() }) })
    load()
    const timer = setInterval(load, 5 * 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return result
}

function useZhejiangRealtime() {
  const endpoint = zhejiangRealtimeEndpoint(import.meta.env.VITE_REALTIME_API_BASE)
  const [result, setResult] = useState(() => ({ state: endpoint ? 'loading' : 'not_configured', snapshot: null, checkedAt: null }))
  useEffect(() => {
    if (!endpoint) {
      setResult({ state: 'not_configured', snapshot: null, checkedAt: null })
      return undefined
    }
    let active = true
    const load = () => fetch(endpoint, { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((snapshot) => {
        if (!active) return
        const quality = assessZhejiangRealtimeSnapshot(snapshot)
        setResult({ state: quality.valid ? snapshot.status : 'invalid', snapshot: quality.valid ? snapshot : null, checkedAt: Date.now() })
      })
      .catch(() => { if (active) setResult({ state: 'unavailable', snapshot: null, checkedAt: Date.now() }) })
    load()
    const timer = setInterval(load, 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [endpoint])
  return result
}

function useDemoDataset() {
  const [result, setResult] = useState({ state: 'loading', data: null })
  useEffect(() => {
    let active = true
    fetch(`${import.meta.env.BASE_URL}data/zhejiang-demo-snapshot.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => { if (active) { const validation = validateDemoDataset(data); setResult({ state: validation.valid ? 'ready' : 'invalid', data: validation.valid ? data : null }) } })
      .catch(() => { if (active) setResult({ state: 'unavailable', data: null }) })
    return () => { active = false }
  }, [])
  return result
}

function Mark({ tone = 'muted', children }) { return <span className={`zo-mark zo-mark-${tone}`}>{children}</span> }
function LogoMark() { return <span className="zo-logo-glyph"><img src={`${import.meta.env.BASE_URL}cityos-logo.png`} alt=""/></span> }
function Arrow() { return <span aria-hidden="true">↗</span> }
function Card({ children, className = '', id }) { return <section id={id} className={`zo-card ${className}`}>{children}</section> }
function SectionTitle({ kicker, title, trailing }) { return <div className="zo-section-title"><div><small>{kicker}</small><h2>{title}</h2></div>{trailing}</div> }
function BeijingClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer) }, [])
  return <span className="zo-top-time">北京时间 · {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}</span>
}

function MoveMap({ center, zoom }) {
  const map = useMap()
  useEffect(() => { map.setView(center, zoom) }, [center[0], center[1], zoom, map])
  return null
}

function ProvinceMap({ cityId, onCity, landing = false }) {
  const city = cityById(cityId)
  const center = city ? city.center : [29.36, 120.7]
  const zoom = city ? 10 : 7
  return <div className={`zo-map ${landing ? 'zo-map-landing' : ''}`}>
    <MapContainer center={center} zoom={zoom} scrollWheelZoom={false} zoomControl={!landing}>
      <MoveMap center={center} zoom={zoom}/>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>
      {ZHEJIANG_CITIES.map((item) => <CircleMarker key={item.id} center={item.center} radius={cityId === item.id ? 10 : 7} pathOptions={{ color: '#f0faf8', weight: 2, fillColor: item.accent, fillOpacity: 1 }} eventHandlers={{ click: () => onCity(item.id) }}><Tooltip direction="top" offset={[0, -9]}>{item.name} · 城市中心示意</Tooltip></CircleMarker>)}
    </MapContainer>
    <div className="zo-map-corner"><span className="zo-live-dot"/> ZHEJIANG / 04 CITIES</div>
  </div>
}

const FORECAST_LEADS = [6, 12, 24, 48, 72]
const rainfallTone = (value) => value >= 100 ? '#b46f78' : value >= 50 ? '#d19a58' : value >= 10 ? '#7fa6c9' : '#6b9b8f'

function SpatialOverviewMap({ city, onCity, demo, demoMode, demoHour }) {
  const [snapshot, setSnapshot] = useState(null)
  const [forecastState, setForecastState] = useState('loading')
  const [lead, setLead] = useState(24)
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let active = true
    const load = () => fetch(`${import.meta.env.BASE_URL}data/zhejiang-weather-forecast.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => { if (!active) return; const quality = assessForecastSnapshot(data); setSnapshot(quality.valid ? data : null); setForecastState(quality.valid ? 'ok' : 'invalid'); setNow(Date.now()) })
      .catch(() => { if (active) { setSnapshot(null); setForecastState('unavailable') } })
    load()
    const refresh = setInterval(load, 15 * 60_000)
    const clock = setInterval(() => setNow(Date.now()), 60_000)
    return () => { active = false; clearInterval(refresh); clearInterval(clock) }
  }, [])
  const forecastStatus = snapshot ? forecastDisplayStatus(snapshot, now) : forecastState
  const validForecast = forecastStatus === 'current'
  useEffect(() => {
    if (!playing) return undefined
    const timer = setInterval(() => setLead((current) => FORECAST_LEADS[(FORECAST_LEADS.indexOf(current) + 1) % FORECAST_LEADS.length]), 1600)
    return () => clearInterval(timer)
  }, [playing])
  const center = city?.center || [29.36, 120.7]
  const mapZoom = city ? 11 : 7
  const currentTrack = demo.data?.storm_track?.find((point) => point.hour === demoHour)
  const visibleTrack = (demo.data?.storm_track || []).filter((point) => point.hour <= demoHour)
  const label = forecastStatus === 'current' ? `${lead} 小时累计降雨 · 城市邻近格点` : forecastStatus === 'stale' ? '降雨预报已过有效期' : '降雨预报暂不可用'
  return <div className="zo-spatial-card zo-card">
    <div className="zo-spatial-heading"><div><small>SPATIAL VIEW / 空间态势</small><h2>{city ? `${city.name} · 降雨与积水点位` : '浙江四城 · 降雨与积水点位'}</h2></div><span className={`zo-forecast-state ${validForecast ? 'available' : ''}`}>{label}</span></div>
    <div className="zo-spatial-controls"><div className="zo-lead-tabs" aria-label="选择降雨预报时效">{FORECAST_LEADS.map((item) => <button key={item} type="button" className={lead === item ? 'active' : ''} aria-pressed={lead === item} onClick={() => { setLead(item); setPlaying(false) }}>+{item}h</button>)}</div><button className="zo-play-control" type="button" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>{playing ? '暂停时间轴' : '播放时间轴'}</button></div>
    <div className="zo-map zo-spatial-map"><MapContainer center={center} zoom={mapZoom} scrollWheelZoom zoomControl>
      <MoveMap center={center} zoom={mapZoom}/>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>
      {validForecast && (city ? [city] : ZHEJIANG_CITIES).map((item) => {
        const record = cityForecast(snapshot, item.id)
        const sample = record?.values?.find((value) => value.lead_hours === lead)
        if (!record || !sample) return null
        const position = record.grid_cell
        const value = sample.cumulative_precip_mm
        const color = rainfallTone(value)
        return <Fragment key={item.id}>
          <Rectangle bounds={[[position[0] - .125, position[1] - .125], [position[0] + .125, position[1] + .125]]} pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: .22, dashArray: '4 5' }}>
            <Tooltip>{item.name}邻近格点 · +{lead}h 累计 {value.toFixed(1)} mm</Tooltip>
          </Rectangle>
          <CircleMarker center={position} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: .95 }}>
            <Tooltip direction="top">{item.name} · +{lead}h {value.toFixed(1)} mm 累计降雨预报</Tooltip>
          </CircleMarker>
        </Fragment>
      })}
      {demoMode === 'demo' && visibleTrack.length > 1 && <Polyline positions={visibleTrack.map((point) => [point.coordinates[1], point.coordinates[0]])} pathOptions={{ color: '#4f8fd6', weight: 3, dashArray: '8 6', opacity: .82 }}><Tooltip sticky>模拟台风路径</Tooltip></Polyline>}
      {demoMode === 'demo' && currentTrack && <CircleMarker center={[currentTrack.coordinates[1], currentTrack.coordinates[0]]} radius={10} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2c70b8', fillOpacity: .98 }}><Tooltip direction="top">模拟台风中心 · {demoTimeLabel(demoHour)}</Tooltip></CircleMarker>}
      {demoMode === 'demo' && (demo.data?.points || []).filter((point) => !city || point.city_id === city.id).map((point) => {
        const currentDepth = demoPointDepth(point, demoHour, demo.data)
        const active = currentDepth >= 8
        const color = currentDepth >= 60 ? '#b46f78' : currentDepth >= 30 ? '#d19a58' : active ? '#6b9b8f' : '#96a6b9'
        return <CircleMarker key={`demo-${point.id}`} center={[point.coordinates[1], point.coordinates[0]]} radius={active ? Math.max(8, Math.min(15, currentDepth / 5)) : 6} pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: active ? .92 : .42 }}><Tooltip permanent={Boolean(city)} direction="right" offset={[9, 0]}>点位 {point.label} · {currentDepth} cm</Tooltip></CircleMarker>
      })}
      {(city ? [city] : ZHEJIANG_CITIES).map((item) => <CircleMarker key={`city-${item.id}`} center={item.center} radius={5} pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#4f6d8a', fillOpacity: 1 }} eventHandlers={{ click: () => onCity?.(item.id) }}><Tooltip>{item.name} · 城市位置</Tooltip></CircleMarker>)}
    </MapContainer><div className="zo-map-corner"><span className="zo-live-dot"/> {city ? city.name : 'ZHEJIANG / 04 CITIES'}</div>{demoMode === 'demo' && <div className="z-overview-demo-legend"><i/>演示 · {demoTimeLabel(demoHour)}</div>}<div className="zo-map-foot">方格：降雨预报；圆点：点位</div></div>
    <div className="zo-spatial-legend"><span><i style={{ background: '#6b9b8f' }}/>0–9.9 mm</span><span><i style={{ background: '#7fa6c9' }}/>10–49.9 mm</span><span><i style={{ background: '#d19a58' }}/>50–99.9 mm</span><span><i style={{ background: '#b46f78' }}/>≥100 mm</span></div>
  </div>
}

function downloadWorkbenchSummary(city, section) {
  const cityLabel = city?.name || '浙江四城'
  const body = `# CityOS 工作台摘要\n\n- 城市范围：${cityLabel}\n- 工作区：${section}\n- 导出时间（北京时间）：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())}\n- 产品说明：https://github.com/TenetJustin/cityos-flood/blob/main/docs/CITYOS_PRODUCT_GUIDE.md\n`
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `CityOS-${cityLabel}-工作台摘要.md`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Landing() {
  const navigate = useNavigate()
  return <div className="zo-landing">
    <header className="zo-landing-header"><div className="zo-logo"><LogoMark/><strong><span>City</span><span className="zo-logo-os">OS</span></strong><span className="zo-logo-sub">ZHEJIANG</span></div><div className="zo-header-right"><Link to="/about">说明 <Arrow/></Link></div></header>
    <main className="zo-landing-main"><div className="zo-landing-copy"><div className="zo-kicker"><span className="zo-live-dot"/> CITY OPERATING SYSTEM / ZHEJIANG</div><h1>浙江台风与<br/>城市内涝<span>世界模型</span></h1><p>四城态势、历史事件、情景预演与决策建议，汇于一处。</p><Link className="zo-primary" to="/workbench">进入工作台 <span>↗</span></Link><div className="zo-landing-cities"><span className="zo-small-label">选择城市</span>{ZHEJIANG_CITIES.map((city, index) => <Link key={city.id} to={cityPath(city.id)}><span>0{index + 1}</span><strong>{city.name}</strong><span className="zo-city-chevron">↗</span></Link>)}</div></div>
      <div className="zo-landing-visual"><ProvinceMap onCity={(id) => navigate(cityPath(id))} landing/><div className="zo-map-overlay"><span>研究范围</span><strong>宁波 · 台州 · 温州 · 杭州</strong></div></div></main>
    <footer className="zo-landing-footer"><span>CityOS · 浙江城市韧性工作台</span><span>宁波 · 台州 · 温州 · 杭州</span><span>Asia/Shanghai · <Link to="/about/product">产品说明</Link></span></footer>
  </div>
}

const NAV = [
  ['overview', '实时态势', '◫'], ['impact', '影响与建议', '◎'],
  ['scenario', '推演', '◈'],
]

function Workbench({ observations, realEvents, realtime, demo, demoMode, setDemoMode }) {
  const { cityId, section } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const city = cityById(cityId)
  const activeSection = section === 'data' ? 'about' : section || 'overview'
  const [menuOpen, setMenuOpen] = useState(false)
  const [demoHour, setDemoHour] = useState(demo.data?.scenario?.default_hour ?? 48)
  useEffect(() => setMenuOpen(false), [location.pathname])
  if (cityId && !city) return <div className="zo-not-found"><h1>未找到城市</h1><Link to="/workbench">返回区域态势</Link></div>
  if (section === 'data') return <Navigate to="/about/product#sources" replace/>
  const legacySection = { points: 'overview', decision: 'impact', events: 'scenario' }[section]
  if (legacySection) return <Navigate to={city ? cityPath(city.id, legacySection === 'overview' ? '' : legacySection) : legacySection === 'overview' ? '/workbench' : cityPath('ningbo', legacySection)} replace/>
  const selectedCity = city?.id || 'ningbo'
  const navPath = (id) => city ? cityPath(city.id, id === 'overview' ? '' : id) : id === 'overview' ? '/workbench' : cityPath(selectedCity, id)
  return <div className="zo-shell"><a className="zo-skip" href="#zo-main">跳转至内容</a><aside className={`zo-sidebar ${menuOpen ? 'open' : ''}`}><Link className="zo-sidebar-brand" to="/"><LogoMark/><span><strong><span>City</span><span className="zo-logo-os">OS</span></strong><small>ZHEJIANG / WORKBENCH</small></span></Link><div className="zo-sidebar-label">工作空间</div><nav aria-label="工作台导航">{NAV.map(([id, label, icon]) => <NavLink key={id} end to={navPath(id)} className={activeSection === id ? 'active' : ''}><span className="zo-nav-icon">{icon}</span>{label}<span className="zo-nav-arrow">↗</span></NavLink>)}</nav><div className="zo-sidebar-bottom"><button type="button" className="zo-export-button" onClick={() => downloadWorkbenchSummary(city, NAV.find(([id]) => id === activeSection)?.[1] || '工作台')}>导出当前分析 ↧</button></div></aside>
    {menuOpen && <button className="zo-backdrop" aria-label="关闭菜单" onClick={() => setMenuOpen(false)}/>}
    <div className="zo-content"><header className="zo-topbar"><div className="zo-top-left"><button className="zo-menu-button" type="button" aria-label="打开导航" onClick={() => setMenuOpen(true)}>☰</button><Link to="/" className="zo-top-home"><LogoMark/><span><span>City</span><span className="zo-logo-os">OS</span></span></Link><span className="zo-slash">/</span><select aria-label="选择城市" value={city?.id || 'region'} onChange={(event) => navigate(event.target.value === 'region' ? '/workbench' : cityPath(event.target.value, activeSection === 'overview' ? '' : activeSection))}><option value="region">浙江区域</option>{ZHEJIANG_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="zo-slash">/</span><strong>{NAV.find(([id]) => id === activeSection)?.[1] || '工作台'}</strong></div><div className="zo-top-right">{activeSection !== 'scenario' && <div className="zo-demo-mode" role="group" aria-label="数据展示模式"><button type="button" className={demoMode === 'demo' ? 'active' : ''} aria-pressed={demoMode === 'demo'} onClick={() => setDemoMode('demo')}>演示数据</button><button type="button" className={demoMode === 'real' ? 'active' : ''} aria-pressed={demoMode === 'real'} onClick={() => setDemoMode('real')}>真实来源</button></div>}<BeijingClock/><Mark tone="muted">非公众预警</Mark><Link to="/about/product" aria-label="打开产品说明">?</Link></div></header>
      <main id="zo-main" className="zo-main"><div className="zo-page-heading"><div><div className="zo-kicker">{city ? `CITY / ${city.id.toUpperCase()}` : 'REGION / ZHEJIANG'} <span className="zo-kicker-line"/></div><h1>{city ? city.name : '浙江区域'}<span> / {NAV.find(([id]) => id === activeSection)?.[1]}</span></h1><p>{city ? city.focus : '宁波、台州、温州、杭州 · 统一视图'}</p></div></div>
        {activeSection === 'overview' && <Overview city={city} onCity={(id) => navigate(cityPath(id))} realEvents={realEvents} realtime={realtime} demo={demo} demoMode={demoMode} demoHour={demoHour} onDemoHourChange={setDemoHour}/>}
        {activeSection === 'impact' && <Impact city={city || cityById(selectedCity)} observations={observations} realEvents={realEvents} demo={demo} demoMode={demoMode} demoHour={demoHour} onDemoHourChange={setDemoHour}/>}
        {activeSection === 'scenario' && <Scenario city={city || cityById(selectedCity)}/>}
        {!NAV.some(([id]) => id === activeSection) && <Card><p>页面不存在。</p><Link to="/workbench">返回工作台</Link></Card>}
      </main></div>
  </div>
}

function Overview({ city, onCity, realEvents, realtime, demo, demoMode, demoHour, onDemoHourChange }) {
  const checks = city ? CITY_CHECKS[city.id] : ['关注短时强降雨及城市低洼点巡查', '核对河网水位与沿海潮位条件', '确认重点道路与排水设施现场状态']
  const reported = ZHEJIANG_CITIES.reduce((sum, item) => sum + activeFloodPointCount(realEvents.data, item.id, realEvents.checkedAt), 0)
  const selectedReports = city ? activeFloodPointCount(realEvents.data, city.id, realEvents.checkedAt) : reported
  const demoPoints = demoMode === 'demo' ? (demo.data?.points || []).filter((point) => !city || point.city_id === city.id) : []
  const activeDemoPoints = demoPoints.map((point) => ({ ...point, current_depth_cm: demoPointDepth(point, demoHour, demo.data) })).filter((point) => point.current_depth_cm >= 8)
  const focalPoint = [...activeDemoPoints].sort((left, right) => right.current_depth_cm - left.current_depth_cm)[0]
  const focalCity = focalPoint && ZHEJIANG_CITIES.find((item) => item.id === focalPoint.city_id)
  return <>
    <div className="zo-overview-layout">
      <SpatialOverviewMap city={city} onCity={onCity} demo={demo} demoMode={demoMode} demoHour={demoHour}/>
      <aside className="zo-overview-rail">
        <Card className="zo-city-status-card">
          <SectionTitle kicker="CITY STATUS / 当前研判" title={city ? `${city.name}状态` : '四城状态'}/>
          <div className="zo-city-status-list">{ZHEJIANG_CITIES.map((item) => {
            const count = activeFloodPointCount(realEvents.data, item.id, realEvents.checkedAt)
            const simulated = demoMode === 'demo' ? demoCityAtHour(demo.data, item.id, demoHour) : null
            const status = simulated?.severity || (count ? 'warning' : 'watch')
            const statusText = simulated ? `${simulated.status_label} · 点位 ${simulated.activePoints.length}/${simulated.points.length}${simulated.peak_depth_cm ? ` · 当前最大 ${simulated.peak_depth_cm} cm` : ''}` : count ? `${count} 条来源积水记录` : '城区内涝状态待核实'
            const tone = status === 'severe' ? 'danger' : status === 'warning' ? 'amber' : simulated ? 'mint' : 'muted'
            return <Link className={`zo-city-status ${city?.id === item.id ? 'selected' : ''}`} key={item.id} to={cityPath(item.id)}>
              <span className={`zo-status-indicator ${simulated ? `z-demo-status-${status}` : count ? 'zo-status-reported' : ''}`}/>
              <span><strong>{item.name}</strong><small>{statusText}</small></span>
              <Mark tone={tone}>{status === 'severe' ? '高影响' : status === 'warning' ? '关注' : simulated ? '常态' : count ? '有报告' : '待核实'}</Mark>
            </Link>
          })}</div>
        </Card>
      <Card className="zo-decision-preview"><SectionTitle kicker="DECISION / 首要建议" title="决策建议"/><div className="zo-initial-advice"><p>{demoMode === 'demo' && demo.data ? focalPoint ? `${focalCity?.name} · ${focalPoint.label}：${demoTimeLabel(demoHour)} 水深 ${focalPoint.current_depth_cm} cm。优先现场核验，核对实测水深、通行和排水状态。` : city ? `${city.name} 当前未达到点位阈值；继续查看雨强、水位和点位变化。` : '浙江四城当前未达到点位阈值。' : selectedReports ? `近 6 小时 ${selectedReports} 条积水记录。核对点位、时间和现场状态。` : city ? `${city.name} 当前无城区积水风险数据。` : '四城当前无城区积水风险数据。'}</p></div><div className="zo-action-preview"><Mark tone="amber">待复核</Mark>{checks.slice(0, 2).map((item) => <div key={item}>· {item}</div>)}</div><Link className="zo-text-link" to={cityPath(city?.id || 'ningbo', 'impact')}>查看建议措施 →</Link></Card>
      </aside>
    </div>
    <RealtimeSnapshotCard city={city} result={realtime}/>
    {demoMode === 'demo' && <Suspense fallback={<Card>载入演示场景…</Card>}><DemoEventPanel city={city} dataset={demo.data} selectedHour={demoHour} onHourChange={onDemoHourChange}/></Suspense>}
    <Suspense fallback={<Card className="zv-loading">正在加载交互式情景沙盘…</Card>}><ZhejiangVisualLab city={city} dataset={demo.data} demoMode={demoMode} demoHour={demoHour} onDemoHourChange={onDemoHourChange}/></Suspense>
  </>
}

const REALTIME_PHENOMENA = {
  rainfall: '降雨', tide_level: '潮位', river_level: '河流水位',
  flood_depth: '积水深度', road_closure: '道路中断',
}

function RealtimeSnapshotCard({ city, result }) {
  const statusLabel = {
    not_configured: '未配置实时服务', loading: '连接中', current: '有近期记录',
    degraded: '覆盖不完整或已延迟', unavailable: '数据不可用', invalid: '数据契约校验失败',
  }[result.state] || '数据不可用'
  const summaries = result.snapshot?.summaries?.filter((item) => !city || item.city_id === city.id) || []
  return <Card className="zo-realtime-card">
    <SectionTitle kicker="REALTIME API / 接入数据" title={city ? `${city.name} · 接入数据` : '浙江四城 · 接入数据'} trailing={<Mark tone={result.state === 'current' ? 'mint' : 'muted'}>{statusLabel}</Mark>}/>
    {result.state === 'not_configured' && <p className="zo-realtime-empty">未配置实时数据源</p>}
    {result.state === 'loading' && <p className="zo-realtime-empty">读取中…</p>}
    {result.state === 'unavailable' && <p className="zo-realtime-empty">数据不可用</p>}
    {result.state === 'invalid' && <p className="zo-realtime-empty">数据校验失败</p>}
    {['current', 'degraded'].includes(result.state) && <>
      {summaries.length ? <div className="zo-realtime-rows">{summaries.map((item) => <div className="zo-realtime-row" key={`${item.city_id}-${item.phenomenon}-${item.unit}`}><strong>{ZHEJIANG_CITIES.find((entry) => entry.id === item.city_id)?.name} · {REALTIME_PHENOMENA[item.phenomenon] || item.phenomenon}</strong><span>{item.record_count} 条 / {item.station_count} 个站点 · 最新观测 {time(item.latest_observed_at)}</span><small>{item.unit}</small></div>)}</div> : <p className="zo-realtime-empty">暂无接入记录</p>}
    </>}
  </Card>
}

function Impact({ city, observations, realEvents, demo, demoMode, demoHour, onDemoHourChange }) {
  return <div className="zo-impact-page"><Decision city={city} observations={observations} realEvents={realEvents} demo={demo} demoMode={demoMode} demoHour={demoHour}/>{demoMode === 'demo' && <Suspense fallback={<Card>载入演示场景…</Card>}><DemoEventPanel city={city} dataset={demo.data} selectedHour={demoHour} onHourChange={onDemoHourChange}/></Suspense>}{demoMode === 'real' && <RealEventPanel city={city} snapshot={realEvents.data} state={realEvents.state} now={realEvents.checkedAt}/>}<Card className="zo-impact-summary"><SectionTitle kicker="CITY IMPACT / 当前城市影响" title={`${city.name}影响概况`}/><div className="zo-impact-grid">{['人口暴露', '道路通行', '生命线设施', '避难需求'].map((label) => <div key={label}><span>{label}</span><strong>{demoMode === 'demo' ? '见情景数据' : '待接入'}</strong></div>)}</div></Card></div>
}

function Decision({ city, observations, realEvents, demo, demoMode, demoHour = 6 }) {
  const [reviewed, setReviewed] = useState([])
  const [reviewedPoints, setReviewedPoints] = useState([])
  useEffect(() => { setReviewed([]); setReviewedPoints([]) }, [city.id])
  const recommendations = CITY_CHECKS[city.id]
  const toggle = (index) => setReviewed((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index])
  const reports = activeFloodPointCount(realEvents.data, city.id, realEvents.checkedAt)
  const simulated = demoMode === 'demo' ? demo?.data?.cities.find((row) => row.city_id === city.id) : null
  const demoRows = simulated ? cityDemoData(demo.data, city.id) : null
  const activePoints = demoRows?.points.map((point) => ({ ...point, current_depth_cm: demoPointDepth(point, demoHour, demo.data) })).filter((point) => point.current_depth_cm >= 8) || []
  const upcomingPoints = demoRows?.points.filter((point) => point.onset_hour > demoHour).sort((left, right) => left.onset_hour - right.onset_hour).slice(0, 3) || []
  const displayPoints = activePoints.length ? activePoints : upcomingPoints
  const currentDepth = (point) => demoPointDepth(point, demoHour, demo.data)
  const deepestPoint = activePoints.reduce((deepest, point) => !deepest || currentDepth(point) > currentDepth(deepest) ? point : deepest, null)
  const togglePoint = (point) => setReviewedPoints((items) => items.some((item) => item.id === point.id) ? items.filter((item) => item.id !== point.id) : [...items, { id: point.id, hour: demoHour, depthCm: currentDepth(point) }])
  return <div className="zo-decision-page">
    <Card>
      <SectionTitle kicker="DECISION / 预置规则建议" title={`${city.name}决策建议`} trailing={<Mark tone="amber">待复核</Mark>}/>
      <div className="zo-advice-columns">
        <section>
          <Mark tone="blue">情景分析</Mark>
          <p>{simulated ? activePoints.length ? `${demoTimeLabel(demoHour)}：${activePoints.length} 个点位达到阈值，最高 ${deepestPoint.label} 为 ${currentDepth(deepestPoint)} cm。优先现场核验，复核实测水深、通行和排水状态。` : upcomingPoints.length ? `当前未达到点位阈值；下一个触发点为 ${upcomingPoints[0].label}（${demoTimeLabel(upcomingPoints[0].onset_hour)}）。` : '当前未达到点位阈值。' : reports ? `近 6 小时 ${reports} 条积水记录。核对点位、时间和现场状态。` : '城区积水风险数据不可用。'}</p>
        </section>
        <section>
          <Mark tone="amber">待复核</Mark>
          {recommendations.map((item, index) => <div className="zo-decision-row" key={item}><span className="zo-decision-index">0{index + 1}</span><div><strong>{item}</strong></div><button type="button" onClick={() => toggle(index)} className={reviewed.includes(index) ? 'selected' : ''}>{reviewed.includes(index) ? '已加入' : '加入清单'}</button></div>)}
        </section>
        <section>
          <Mark tone="mint">点位措施建议</Mark>
          {displayPoints.length ? <div className="z-point-advice-list">{displayPoints.map((point) => {
            const depthCm = currentDepth(point)
            const selected = reviewedPoints.some((item) => item.id === point.id)
            return <article key={point.id}><div><strong>点位 {point.label}</strong><span>{point.area} · {activePoints.length ? `${demoTimeLabel(demoHour)} · ${depthCm} cm` : `预计触发 ${demoTimeLabel(point.onset_hour)}`}</span></div><p>{demoPointAdvice(point, depthCm)}</p><button type="button" aria-pressed={selected} className={selected ? 'selected' : ''} onClick={() => togglePoint(point)}>{selected ? '已加入核查' : '加入核查'}</button></article>
          })}</div> : <p>暂未触发点位；继续监测天气、水位和现场信息。</p>}
        </section>
      </div>
    </Card>
    <Card className="zo-review-card">
      <SectionTitle kicker="REVIEW / 本次会话" title="复核清单"/>
      <div className="zo-review-count">{reviewed.length + reviewedPoints.length}<span> / {recommendations.length + (demoRows?.points.length || 0)} 条</span></div>
      {reviewed.length + reviewedPoints.length ? <ol className="zo-review-list">{reviewed.map((index) => <li key={`check-${index}`}>{recommendations[index]}</li>)}{reviewedPoints.map(({ id, hour, depthCm }) => { const point = demoRows?.points.find((item) => item.id === id); return point ? <li key={id}>点位 {point.label} · {point.area} · {demoTimeLabel(hour)} · {depthCm} cm</li> : null })}</ol> : <p className="zo-fineprint">尚未加入事项</p>}
    </Card>
  </div>
}

function Events({ city }) {
  const [selectedId, setSelectedId] = useState('infa-2021')
  const entries = city ? ZHEJIANG_EVENTS.filter((event) => event.city === city.id) : ZHEJIANG_EVENTS
  const selected = entries.find((event) => event.id === selectedId) || entries[0]
  return <div className="zo-history-replay"><Card><SectionTitle kicker="EVENT REPLAY / 历史回溯" title="选择台风事件"/><div className="zo-history-events">{entries.length ? entries.map((event) => <button className={selected?.id === event.id ? 'active' : ''} key={event.id} type="button" aria-pressed={selected?.id === event.id} onClick={() => setSelectedId(event.id)}><span>{event.year}</span><strong>{event.title}</strong><small>{cityById(event.city)?.name} · {event.type}</small></button>) : <p>当前城市暂无可选历史事件。</p>}</div>{selected && <div className="zo-history-summary"><div><strong>{selected.title}</strong><span>{selected.year} · {selected.type}</span></div></div>}</Card>{selected?.id === 'infa-2021' ? <HistoricalRainPanel city={city}/> : <Card className="zo-history-missing"><strong>{selected?.title || '该事件'}降雨未接入</strong></Card>}<HistoricalTrackPanel city={city} year={selected?.year}/><Card className="zo-history-missing"><strong>历史积水点位未接入</strong></Card></div>
}

function Scenario({ city }) {
  const [mode, setMode] = useState('custom')
  return <><div className="zo-workspace-tabs" role="tablist" aria-label="推演工作区"><button type="button" role="tab" aria-selected={mode === 'custom'} className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>自定义情景</button><button type="button" role="tab" aria-selected={mode === 'history'} className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>历史回溯</button></div>{mode === 'custom' ? <ScenarioStudio city={city}/> : <Events city={city}/>}</>
}

function About() {
  const nav = [['intro','产品介绍'],['usage','使用说明'],['functions','功能说明'],['technology','技术栈'],['sources','数据来源'],['impact','影响分析'],['methods','计算与模型'],['safety','使用边界']]
  return <div className="zo-about">
    <header><Link to="/" className="zo-logo"><LogoMark/><strong><span>City</span><span className="zo-logo-os">OS</span></strong></Link><Link to="/workbench">进入工作台 ↗</Link></header>
    <div className="zo-about-content"><div className="zo-kicker">ABOUT / 产品说明</div><h1>浙江台风与城市内涝韧性工作台</h1>
      <p>CityOS 面向宁波、台州、温州、杭州，组织台风、降雨、潮位、河网、城市空间和历史事件资料，支持实时态势查看、影响研判、历史回溯、情景比较和人工复核的决策建议。</p>
      <nav className="zo-doc-nav" aria-label="产品说明目录">{nav.map(([id,label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <div className="zo-about-grid">
        <Card id="intro"><h2>产品介绍</h2><p>日常研究工作台：先看四城态势，再查看影响与预置建议，最后回溯事件或比较自定义情景。城市间共享交互流程，但本地数据、参数与模型需分别验证。</p></Card>
        <Card id="usage"><h2>使用说明</h2><ul className="zo-doc-list">
          <li>首页选择城市进入工作台；顶部可切换城市和“演示数据 / 真实来源”。</li>
          <li>“实时态势”查看城市状态、降雨预报、点位与时间轴；图层控制地图显示。</li>
          <li>“影响与建议”查看决策建议、点位措施和复核清单；加入清单仅保留在当前页面。</li>
          <li>“推演”支持自定义参数与历史回溯；可保存、比较本机情景并下载草案。</li>
          <li>“演示、历史、待复核、非公众预警”为状态标签，详细边界见“使用边界”。</li>
        </ul></Card>
        <Card id="functions"><h2>功能说明</h2><p>实时态势展示公开天气模式格点和四城状态；影响与建议可展示有来源的积水点、居民区域汇总和部门行动，并提供人工复核建议；推演区支持自定义条件与历史事件回看。建议需由专业人员审核，不自动执行。</p></Card>
        <Card id="technology"><h2>技术栈</h2>
          <div className="zo-stack-diagram" role="img" aria-label="CityOS 技术栈分层图：交互层、接入层、计算层、模型层、发布与验证层">
            <div className="zo-stack-layer"><span>交互层</span><div><b>React 18</b><b>Vite</b><b>Leaflet</b><b>Three.js</b><b>Recharts</b></div></div>
            <i className="zo-stack-arrow">↓</i>
            <div className="zo-stack-layer"><span>接入层</span><div><b>FastAPI</b><b>OGC SensorThings</b><b>SQLite</b><b>静态快照</b></div></div>
            <i className="zo-stack-arrow">↓</i>
            <div className="zo-stack-layer"><span>计算层</span><div><b>EPA SWMM 5.2.4</b><b>Rasterio / GDAL</b><b>Shapely</b><b>NetworkX</b></div></div>
            <i className="zo-stack-arrow">↓</i>
            <div className="zo-stack-layer"><span>模型层</span><div><b>节点蓄水</b><b>居民规则</b><b>资源分配</b><b>情景规则</b></div></div>
            <i className="zo-stack-arrow">↓</i>
            <div className="zo-stack-layer"><span>发布与验证</span><div><b>GitHub Actions</b><b>GitHub Pages</b><b>Python unittest</b><b>Node test</b></div></div>
          </div>
          <p>React/Vite、Leaflet、Three.js、Recharts 提供交互地图、二维点位图与三维地形。离线计算使用 EPA SWMM 5.2.4 官方 C 引擎、Rasterio/GDAL、Shapely 和 NetworkX；产物可由 GitHub Pages 无后端展示。真实数据入口使用 OGC SensorThings 适配、FastAPI 与 SQLite 去重存储，需要单独配置供应商与服务地址。Leon Sans 使用 OFL 1.1；各开源软件与数据许可分别记录。</p>
        </Card>
        <Card id="sources"><h2>数据来源与许可</h2>
          <table className="zo-source-table"><thead><tr><th>来源</th><th>用途</th><th>许可 / 状态</th></tr></thead><tbody>
            <tr><td>ECMWF IFS Open Data</td><td>0.25° 降雨预报格点</td><td>CC BY 4.0；非城区实测</td></tr>
            <tr><td>NOAA AWC METAR</td><td>机场气象观测</td><td>公开 API；非城区雨量</td></tr>
            <tr><td>NOAA IBTrACS</td><td>历史台风最佳路径</td><td>公开研究数据；事后路径</td></tr>
            <tr><td>NOAA GHCN-Daily / GHCNh</td><td>历史站点降雨</td><td>公开；事后档案</td></tr>
            <tr><td>OpenStreetMap</td><td>地图底图</td><td>ODbL；保留署名</td></tr>
            <tr><td>浙江省 / 温州市数据开放平台</td><td>降水、水库、台风、潮位、易涝点</td><td>需注册/授权；目录线索</td></tr>
            <tr><td>政府公开事件与复盘</td><td>历史事件背景</td><td>公开网页；按原文引用</td></tr>
          </tbody></table>
          <p>不同来源的许可、采样范围、时效和可用性分别核对；门户有目录不等于接口已获批。详细注册与接口说明见 <a href="https://data.zjzwfw.gov.cn/dopServer/" target="_blank" rel="noreferrer">浙江·数据开放</a>。</p>
        </Card>
        <Card id="impact"><h2>影响分析</h2><p>真实事件区仅在取得来源、时间与许可核验通过的记录后显示积水点、居民区域汇总和部门行动；零记录表示未取得报告。暴露规模、道路连通性与可达性仍需城区积水范围和设施资料验证后计算，情景中的居民行为图只展示规则假设。</p></Card>
        <Card id="methods"><h2>计算与模型</h2><p>合成台风演示已运行 EPA SWMM 5.2.4：四城各25个独立微汇水区，按小时读取降雨、合成潮河边界，求解产流、动态管流与节点蓄水。显示水深=max(水头−合成地面高程,0)，不是二维淹没面积。地形由 Rasterio/GDAL 导出 GeoTIFF，Shapely 核查点位；NetworkX 在假设队伍容量内求解最小费用最大流，输出候选分配及缺口。居民分流仍为透明规则估算。自定义推演继续使用 tabletop-rules-v1，调整参数不会调用后台水动力求解器，也不会更改正式模型。</p><p>四城73小时合成算例通过无雨基线、扩大管径敏感性、重复性与1%水量连续性门槛；这属于工程验收，不是历史事件预测精度验证。</p></Card>
        <Card id="safety"><h2>使用边界与版本治理</h2><p>真实观测、历史记录、模型推断、模拟情景和缺失值分开展示。缺失不填零，也不等于安全。模型改进只能提出建议，经历史回测、安全检查和人工批准后发布新版本。网站不具备公众预警或自动调度资格。</p></Card>
      </div><div className="zo-about-footer"><a href="https://github.com/TenetJustin/cityos-flood/blob/main/docs/CITYOS_PRODUCT_GUIDE.md" target="_blank" rel="noreferrer">完整产品技术文档 ↗</a><a href="https://github.com/TenetJustin/cityos-flood" target="_blank" rel="noreferrer">GitHub 仓库 ↗</a><Link to="/workbench">返回工作台</Link></div>
    </div>
  </div>
}

export default function ZhejiangApp() {
  const observations = useObservations()
  const realEvents = useRealEventEvidence()
  const realtime = useZhejiangRealtime()
  const demo = useDemoDataset()
  const [demoMode, setDemoMode] = useState('demo')
  const workbench = <Workbench observations={observations} realEvents={realEvents} realtime={realtime} demo={demo} demoMode={demoMode} setDemoMode={setDemoMode}/>
  return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}><Routes><Route path="/" element={<Landing/>}/><Route path="/welcome" element={<Landing/>}/><Route path="/workbench" element={workbench}/><Route path="/workbench/:cityId" element={workbench}/><Route path="/workbench/:cityId/:section" element={workbench}/><Route path="/overview" element={<Navigate to="/workbench" replace/>}/><Route path="/cities/*" element={<Navigate to="/workbench" replace/>}/><Route path="/about" element={<Navigate to="/about/product" replace/>}/><Route path="/about/:section" element={<About/>}/><Route path="*" element={<div className="zo-not-found"><h1>页面不存在</h1><Link to="/">返回首页</Link></div>}/></Routes></BrowserRouter>
}
