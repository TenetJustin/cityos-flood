import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { CircleMarker, MapContainer, Rectangle, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { CITY_CHECKS, ZHEJIANG_CITIES, ZHEJIANG_EVENTS } from './zhejiangData.js'
import { assessZhejiangSnapshot } from './zhejiangObservations.js'
import HistoricalTrackPanel from './HistoricalTrackPanel.jsx'
import HistoricalRainPanel from './HistoricalRainPanel.jsx'
import { ScenarioStudio } from './ScenarioStudio.jsx'
import RealEventPanel from './RealEventPanel.jsx'
import { assessForecastSnapshot, cityForecast, forecastDisplayStatus } from './zhejiangForecast.js'
import { activeFloodPointCount, assessRealEventSnapshot } from './realEventEvidence.js'
import { assessZhejiangRealtimeSnapshot, zhejiangRealtimeEndpoint } from './zhejiangRealtime.js'
import './zhejiang.css'

const ZhejiangVisualLab = lazy(() => import('./ZhejiangVisualLab.jsx'))

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
    <div className="zo-map-foot">城市中心示意点 · 无积水风险图层</div>
  </div>
}

const FORECAST_LEADS = [6, 12, 24, 48, 72]
const rainfallTone = (value) => value >= 100 ? '#b46f78' : value >= 50 ? '#d19a58' : value >= 10 ? '#7fa6c9' : '#6b9b8f'

function SpatialOverviewMap({ city, onCity }) {
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
  const label = forecastStatus === 'current' ? `ECMWF ${lead} 小时累计降雨 · 城市邻近格点` : forecastStatus === 'stale' ? '公开降雨预报已过有效期' : '公开降雨预报暂不可用'
  return <div className="zo-spatial-card zo-card">
    <div className="zo-spatial-heading"><div><small>SPATIAL VIEW / 空间态势</small><h2>{city ? `${city.name} · 降雨与城市位置` : '浙江四城 · 降雨预报格点'}</h2></div><span className={`zo-forecast-state ${validForecast ? 'available' : ''}`}>{label}</span></div>
    <div className="zo-spatial-controls"><div className="zo-lead-tabs" aria-label="选择降雨预报时效">{FORECAST_LEADS.map((item) => <button key={item} type="button" className={lead === item ? 'active' : ''} aria-pressed={lead === item} onClick={() => { setLead(item); setPlaying(false) }}>+{item}h</button>)}</div><button className="zo-play-control" type="button" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>{playing ? '暂停时间轴' : '播放时间轴'}</button></div>
    <div className="zo-map zo-spatial-map"><MapContainer center={center} zoom={7} scrollWheelZoom zoomControl>
      <MoveMap center={center} zoom={city ? 7 : 7}/>
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
            <Tooltip>{item.name}邻近 ECMWF 格点 · +{lead}h 累计 {value.toFixed(1)} mm · 非积水范围</Tooltip>
          </Rectangle>
          <CircleMarker center={position} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: .95 }}>
            <Tooltip direction="top">{item.name} · +{lead}h {value.toFixed(1)} mm 累计降雨预报</Tooltip>
          </CircleMarker>
        </Fragment>
      })}
      {(city ? [city] : ZHEJIANG_CITIES).map((item) => <CircleMarker key={`city-${item.id}`} center={item.center} radius={5} pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#4f6d8a', fillOpacity: 1 }} eventHandlers={{ click: () => onCity?.(item.id) }}><Tooltip>{item.name} · 城市位置</Tooltip></CircleMarker>)}
    </MapContainer><div className="zo-map-corner"><span className="zo-live-dot"/> {city ? city.name : 'ZHEJIANG / 04 CITIES'}</div><div className="zo-map-foot">方格为 0.25° ECMWF 网格示意，不是积水或风险边界</div></div>
    <div className="zo-spatial-legend"><span><i style={{ background: '#6b9b8f' }}/>0–9.9 mm</span><span><i style={{ background: '#7fa6c9' }}/>10–49.9 mm</span><span><i style={{ background: '#d19a58' }}/>50–99.9 mm</span><span><i style={{ background: '#b46f78' }}/>≥100 mm</span><small>{snapshot?.model_run_at ? `起报 ${time(snapshot.model_run_at)} · 北京时间` : '预报时间不可用'} · {snapshot?.available_at ? `快照读取 ${time(snapshot.available_at)}` : '未取得有效快照'}</small></div>
    <p className="zo-spatial-note">公开模式降雨预报，不是雨量站观测、城区实况或内涝预测；颜色只表示该格点的累计降雨量级。</p>
  </div>
}

function downloadWorkbenchSummary(city, section) {
  const cityLabel = city?.name || '浙江四城'
  const body = `# CityOS 工作台摘要\n\n- 城市范围：${cityLabel}\n- 工作区：${section}\n- 导出时间（北京时间）：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())}\n- 数据说明：工作台展示的预报、历史记录、模拟情景与缺失数据分别标识；当前结果不构成公众预警或自动调度。\n- 产品说明：https://github.com/TenetJustin/cityos-flood/blob/main/docs/CITYOS_PRODUCT_GUIDE.md\n`
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `CityOS-${cityLabel}-工作台摘要.md`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ResearchFlow() {
  return <Card className="zo-research-flow"><SectionTitle kicker="WORKFLOW / 研究流程" title="从多源数据到可复核建议"/><div className="zo-research-steps"><article><b>01</b><strong>接入与质控</strong><p>统一观测时间、实际可获得时间、空间基准、单位、许可、质量和缺失标记。</p></article><i>→</i><article><b>02</b><strong>复合致涝分析</strong><p>关联台风、降雨、潮位、河网与城市地形；城市参数分别维护。</p></article><i>→</i><article><b>03</b><strong>影响评估</strong><p>叠加人群、道路和重点设施，区分观测事实与模型推断。</p></article><i>→</i><article><b>04</b><strong>情景与建议</strong><p>回放历史事件、比较假设情景，形成待人工复核的建议。</p></article></div></Card>
}

function Landing() {
  const navigate = useNavigate()
  return <div className="zo-landing">
    <header className="zo-landing-header"><div className="zo-logo"><LogoMark/><strong><span>City</span><span className="zo-logo-os">OS</span></strong><span className="zo-logo-sub">ZHEJIANG</span></div><div className="zo-header-right"><Mark tone="mint">研究工作台</Mark><Link to="/about">说明 <Arrow/></Link></div></header>
    <main className="zo-landing-main"><div className="zo-landing-copy"><div className="zo-kicker"><span className="zo-live-dot"/> CITY OPERATING SYSTEM / ZHEJIANG</div><h1>浙江台风与<br/>城市内涝<span>世界模型</span></h1><p>四城态势、历史事件、情景预演与决策建议，汇于一处。</p><Link className="zo-primary" to="/workbench">进入工作台 <span>↗</span></Link><div className="zo-landing-cities"><span className="zo-small-label">选择城市</span>{ZHEJIANG_CITIES.map((city, index) => <Link key={city.id} to={cityPath(city.id)}><span>0{index + 1}</span><strong>{city.name}</strong><span className="zo-city-chevron">↗</span></Link>)}</div></div>
      <div className="zo-landing-visual"><ProvinceMap onCity={(id) => navigate(cityPath(id))} landing/><div className="zo-map-overlay"><span>研究范围</span><strong>宁波 · 台州 · 温州 · 杭州</strong><small>点击地图标记进入城市工作台</small></div></div></main>
    <ResearchFlow/>
    <footer className="zo-landing-footer"><span>CityOS · 浙江城市韧性工作台</span><span>宁波 · 台州 · 温州 · 杭州</span><span>Asia/Shanghai · <Link to="/about/product">产品说明</Link></span></footer>
  </div>
}

const NAV = [
  ['overview', '实时态势', '◫'], ['impact', '影响与建议', '◎'],
  ['scenario', '推演', '◈'],
]

function Workbench({ observations, realEvents, realtime }) {
  const { cityId, section } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const city = cityById(cityId)
  const activeSection = section === 'data' ? 'about' : section || 'overview'
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])
  if (cityId && !city) return <div className="zo-not-found"><h1>未找到城市</h1><Link to="/workbench">返回区域态势</Link></div>
  if (section === 'data') return <Navigate to="/about/product#sources" replace/>
  const legacySection = { points: 'overview', decision: 'impact', events: 'scenario' }[section]
  if (legacySection) return <Navigate to={city ? cityPath(city.id, legacySection === 'overview' ? '' : legacySection) : legacySection === 'overview' ? '/workbench' : cityPath('ningbo', legacySection)} replace/>
  const selectedCity = city?.id || 'ningbo'
  const navPath = (id) => city ? cityPath(city.id, id === 'overview' ? '' : id) : id === 'overview' ? '/workbench' : cityPath(selectedCity, id)
  return <div className="zo-shell"><a className="zo-skip" href="#zo-main">跳转至内容</a><aside className={`zo-sidebar ${menuOpen ? 'open' : ''}`}><Link className="zo-sidebar-brand" to="/"><LogoMark/><span><strong><span>City</span><span className="zo-logo-os">OS</span></strong><small>ZHEJIANG / WORKBENCH</small></span></Link><div className="zo-sidebar-label">工作空间</div><nav aria-label="工作台导航">{NAV.map(([id, label, icon]) => <NavLink key={id} end to={navPath(id)} className={activeSection === id ? 'active' : ''}><span className="zo-nav-icon">{icon}</span>{label}<span className="zo-nav-arrow">↗</span></NavLink>)}</nav><div className="zo-sidebar-bottom"><button type="button" className="zo-export-button" onClick={() => downloadWorkbenchSummary(city, NAV.find(([id]) => id === activeSection)?.[1] || '工作台')}>导出当前分析 ↧</button></div></aside>
    {menuOpen && <button className="zo-backdrop" aria-label="关闭菜单" onClick={() => setMenuOpen(false)}/>}
    <div className="zo-content"><header className="zo-topbar"><div className="zo-top-left"><button className="zo-menu-button" type="button" aria-label="打开导航" onClick={() => setMenuOpen(true)}>☰</button><Link to="/" className="zo-top-home"><LogoMark/><span><span>City</span><span className="zo-logo-os">OS</span></span></Link><span className="zo-slash">/</span><select aria-label="选择城市" value={city?.id || 'region'} onChange={(event) => navigate(event.target.value === 'region' ? '/workbench' : cityPath(event.target.value, activeSection === 'overview' ? '' : activeSection))}><option value="region">浙江区域</option>{ZHEJIANG_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="zo-slash">/</span><strong>{NAV.find(([id]) => id === activeSection)?.[1] || '工作台'}</strong></div><div className="zo-top-right"><BeijingClock/><span className="zo-landfall-time">预计登陆 · —</span><Mark tone="muted">非公众预警</Mark><Link to="/about/product" aria-label="打开产品说明">?</Link></div></header>
      <main id="zo-main" className="zo-main"><div className="zo-page-heading"><div><div className="zo-kicker">{city ? `CITY / ${city.id.toUpperCase()}` : 'REGION / ZHEJIANG'} <span className="zo-kicker-line"/></div><h1>{city ? city.name : '浙江区域'}<span> / {NAV.find(([id]) => id === activeSection)?.[1]}</span></h1><p>{city ? city.focus : '宁波、台州、温州、杭州 · 统一视图'}</p></div></div>
        {activeSection === 'overview' && <Overview city={city} onCity={(id) => navigate(cityPath(id))} realEvents={realEvents} realtime={realtime}/>}
        {activeSection === 'impact' && <Impact city={city || cityById(selectedCity)} observations={observations} realEvents={realEvents}/>}
        {activeSection === 'scenario' && <Scenario city={city || cityById(selectedCity)}/>}
        {!NAV.some(([id]) => id === activeSection) && <Card><p>页面不存在。</p><Link to="/workbench">返回工作台</Link></Card>}
      </main></div>
  </div>
}

function Overview({ city, onCity, realEvents, realtime }) {
  const checks = city ? CITY_CHECKS[city.id] : ['关注短时强降雨及城市低洼点巡查', '核对河网水位与沿海潮位条件', '确认重点道路与排水设施现场状态']
  const reported = ZHEJIANG_CITIES.reduce((sum, item) => sum + activeFloodPointCount(realEvents.data, item.id, realEvents.checkedAt), 0)
  const selectedReports = city ? activeFloodPointCount(realEvents.data, city.id, realEvents.checkedAt) : reported
  return <>
    <div className="zo-overview-layout">
      <SpatialOverviewMap city={city} onCity={onCity}/>
      <aside className="zo-overview-rail">
        <Card className="zo-city-status-card"><SectionTitle kicker="CITY STATUS / 当前研判" title={city ? `${city.name}状态` : '四城状态'}/><div className="zo-city-status-list">{ZHEJIANG_CITIES.map((item) => { const count = activeFloodPointCount(realEvents.data, item.id, realEvents.checkedAt); return <Link className={`zo-city-status ${city?.id === item.id ? 'selected' : ''}`} key={item.id} to={cityPath(item.id)}><span className={`zo-status-indicator ${count ? 'zo-status-reported' : ''}`}/><span><strong>{item.name}</strong><small>{count ? `近 6 小时 ${count} 条积水来源记录` : '城区内涝状态待核实'}</small></span><Mark tone={count ? 'amber' : 'muted'}>{count ? '有报告' : '待核实'}</Mark></Link> })}</div><p className="zo-status-boundary">来源报告只覆盖已取得的点位；未覆盖区域不能据此判断安全。机场气象与天气格点不等于城区积水观测。</p></Card>
        <Card className="zo-decision-preview"><SectionTitle kicker="DECISION / 首要建议" title="决策建议"/><div className="zo-initial-advice"><Mark tone="blue">初步分析</Mark><p>{selectedReports ? `近 6 小时取得 ${selectedReports} 条积水来源记录。建议核对点位、发生时间和现场状态，并检查相邻低洼道路；是否采取措施由主管人员复核。` : city ? `${city.name}当前无可核验的城区积水风险输出。建议按常态监测，并优先核实短时雨量、河网/潮位和低洼点现场信息。` : '四城均缺少可核验的城区积水风险输出。建议保持常态监测，并优先补核降雨、水位与低洼点现场信息。'}</p></div><div className="zo-action-preview"><span>需要人工复核</span>{checks.slice(0, 2).map((item) => <div key={item}>· {item}</div>)}</div><Link className="zo-text-link" to={cityPath(city?.id || 'ningbo', 'impact')}>查看建议措施与复核清单 →</Link></Card>
      </aside>
    </div>
    <RealtimeSnapshotCard city={city} result={realtime}/>
    <Suspense fallback={<Card className="zv-loading">正在加载交互式情景沙盘…</Card>}><ZhejiangVisualLab city={city}/></Suspense>
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
    <SectionTitle kicker="REALTIME API / 描述性观测" title={city ? `${city.name} · 接入数据` : '浙江四城 · 接入数据'} trailing={<Mark tone={result.state === 'current' ? 'mint' : 'muted'}>{statusLabel}</Mark>}/>
    {result.state === 'not_configured' && <p className="zo-realtime-empty">当前部署未配置实时 API。静态天气/历史快照仍按各自来源显示；这里不会把页面刷新当作新观测。</p>}
    {result.state === 'loading' && <p className="zo-realtime-empty">正在读取受控服务的描述性观测快照…</p>}
    {result.state === 'unavailable' && <p className="zo-realtime-empty">实时服务暂不可用或尚无记录。缺失不代表安全；请核对数据链路和现场情况。</p>}
    {result.state === 'invalid' && <p className="zo-realtime-empty">返回数据未通过区域、时间、字段或能力边界校验，数值已隐藏。</p>}
    {['current', 'degraded'].includes(result.state) && <>
      {summaries.length ? <div className="zo-realtime-rows">{summaries.map((item) => <div className="zo-realtime-row" key={`${item.city_id}-${item.phenomenon}-${item.unit}`}><strong>{ZHEJIANG_CITIES.find((entry) => entry.id === item.city_id)?.name} · {REALTIME_PHENOMENA[item.phenomenon] || item.phenomenon}</strong><span>{item.record_count} 条 / {item.station_count} 个站点 · 最新观测 {time(item.latest_observed_at)}</span><small>数据实际可获得 {time(item.latest_available_at)} · {item.unit}{item.vertical_datum ? ` · ${item.vertical_datum}` : ''}</small></div>)}</div> : <p className="zo-realtime-empty">当前范围没有可展示的观测摘要；请勿把空记录解读为零值。</p>}
      <p className="zo-realtime-meta">服务快照时刻 {time(result.snapshot.as_of)} · 本页检查 {result.checkedAt ? time(result.checkedAt) : '—'} · 仅描述性汇总，未用于积水预测、预警或调度</p>
    </>}
  </Card>
}

function Impact({ city, observations, realEvents }) {
  return <div className="zo-impact-page"><Decision city={city} observations={observations} realEvents={realEvents}/><RealEventPanel city={city} snapshot={realEvents.data} state={realEvents.state} now={realEvents.checkedAt}/><Card className="zo-impact-summary"><SectionTitle kicker="CITY IMPACT / 当前城市影响" title={`${city.name}影响概况`}/><p>人口暴露、道路中断与避难需求仍需有坐标和时间的积水记录、人口及设施资料共同计算。上方居民和部门记录如有展示，属于其来源报告的实际影响与行动，不代表全城覆盖。</p><div className="zo-impact-grid">{['人口暴露', '道路通行', '生命线设施', '避难需求'].map((label) => <div key={label}><span>{label}</span><strong>待接入</strong></div>)}</div><Link className="zo-inline-doc-link" to="/about/product#impact">数据来源与影响计算说明 ↗</Link></Card></div>
}

function Decision({ city, observations, realEvents }) {
  const [reviewed, setReviewed] = useState([])
  useEffect(() => setReviewed([]), [city.id])
  const recommendations = CITY_CHECKS[city.id]
  const toggle = (index) => setReviewed((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index])
  const reports = activeFloodPointCount(realEvents.data, city.id, realEvents.checkedAt)
  return <div className="zo-decision-page"><Card><SectionTitle kicker="DECISION / 预置规则建议" title={`${city.name}决策建议`} trailing={<Mark tone="amber">人工复核</Mark>}/><div className="zo-advice-columns"><section><Mark tone="blue">初步分析</Mark><p>{reports ? `近 6 小时取得 ${reports} 条积水来源记录。请先核对点位、水深和现场变化，再判断道路及排水设施的处置需求。` : observations?.state === 'ok' ? '已获取机场气象快照，但机场点位不能代表城区降雨或积水。当前没有可核验的城区风险输出，按常态监测并补核关键水情。' : '当前城区风险数据不可用或覆盖不足，无法判断是否存在内涝。建议先确认数据链路和现场情况，不将“无数据”解释为安全。'}</p></section><section><Mark tone="amber">需要人工复核</Mark>{recommendations.map((item, index) => <div className="zo-decision-row" key={item}><span className="zo-decision-index">0{index + 1}</span><div><strong>{item}</strong><small>复核依据：{city.focus} · 需以现场或部门记录确认</small></div><button type="button" onClick={() => toggle(index)} className={reviewed.includes(index) ? 'selected' : ''}>{reviewed.includes(index) ? '已加入' : '加入清单'}</button></div>)}</section><section><Mark tone="mint">建议措施</Mark><p>优先核验易涝点、下穿道路、河网与潮位状态；补齐当前缺失的雨量及现场水情后再更新研判。任何封路、转移或泵闸运行措施由主管人员基于本地规程决定。</p><div className="zo-review-count">{reviewed.length}<span> 条人工核查项已加入本次清单</span></div></section></div></Card><Card className="zo-review-card"><SectionTitle kicker="REVIEW / 本次会话" title="人工复核清单"/><div className="zo-review-count">{reviewed.length}<span> / {recommendations.length} 条</span></div>{reviewed.length ? <ol className="zo-review-list">{reviewed.map((index) => <li key={index}>{recommendations[index]}</li>)}</ol> : <p className="zo-fineprint">加入需要现场确认的事项后，可在此集中查看。本清单仅保留在当前页面会话。</p>}<div className="zo-review-gate"><span>自动执行措施</span><Mark tone="muted">关闭</Mark></div><div className="zo-review-gate"><span>公众预警发布</span><Mark tone="muted">主管部门负责</Mark></div></Card></div>
}

function Events({ city }) {
  const [selectedId, setSelectedId] = useState('infa-2021')
  const entries = city ? ZHEJIANG_EVENTS.filter((event) => event.city === city.id) : ZHEJIANG_EVENTS
  const selected = entries.find((event) => event.id === selectedId) || entries[0]
  return <div className="zo-history-replay"><Card><SectionTitle kicker="EVENT REPLAY / 历史回溯" title="选择台风事件"/><div className="zo-history-events">{entries.length ? entries.map((event) => <button className={selected?.id === event.id ? 'active' : ''} key={event.id} type="button" aria-pressed={selected?.id === event.id} onClick={() => setSelectedId(event.id)}><span>{event.year}</span><strong>{event.title}</strong><small>{cityById(event.city)?.name} · {event.type}</small></button>) : <p>当前城市暂无可选历史事件。</p>}</div>{selected && <div className="zo-history-summary"><div><strong>{selected.title}</strong><span>{selected.source} · {selected.year}</span><p>{selected.note}</p></div><a href={selected.url} target="_blank" rel="noreferrer">查看事件资料 ↗</a></div>}</Card>{selected?.id === 'infa-2021' ? <HistoricalRainPanel city={city}/> : <Card className="zo-history-missing"><strong>{selected?.title || '该事件'}的可用城市降雨时序尚未接入</strong><p>目前仅展示登记的事件资料与可匹配路径；不会用其他年份的降雨记录代替。</p></Card>}<HistoricalTrackPanel city={city} year={selected?.year}/><Card className="zo-history-missing"><strong>内涝点位与城市积水图层</strong><p>当前历史事件缺少带坐标、观测时间和水深的城市积水点真值，因此地图只展示真实轨迹和已登记气象资料，不绘制推测的历史积水点。</p></Card></div>
}

function Scenario({ city }) {
  const [mode, setMode] = useState('custom')
  return <><div className="zo-workspace-tabs" role="tablist" aria-label="推演工作区"><button type="button" role="tab" aria-selected={mode === 'custom'} className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>自定义情景</button><button type="button" role="tab" aria-selected={mode === 'history'} className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>历史回溯</button></div>{mode === 'custom' ? <ScenarioStudio city={city}/> : <Events city={city}/>}</>
}

function About() {
  return <div className="zo-about">
    <header><Link to="/" className="zo-logo"><LogoMark/><strong><span>City</span><span className="zo-logo-os">OS</span></strong></Link><Link to="/workbench">进入工作台 ↗</Link></header>
    <div className="zo-about-content"><div className="zo-kicker">ABOUT / 产品说明</div><h1>浙江台风与城市内涝韧性工作台</h1>
      <p>CityOS 面向宁波、台州、温州、杭州，组织台风、降雨、潮位、河网、城市空间和历史事件资料，支持实时态势查看、影响研判、历史回溯、情景比较和人工复核的决策建议。</p>
      <nav className="zo-doc-nav" aria-label="产品说明目录">{[['intro','产品介绍'],['functions','功能说明'],['technology','技术栈'],['sources','数据来源'],['impact','影响分析'],['methods','计算与模型'],['safety','使用边界']].map(([id,label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <div className="zo-about-grid">
        <Card id="intro"><h2>产品介绍</h2><p>日常研究工作台：先看四城态势，再查看影响与预置建议，最后回溯事件或比较自定义情景。城市间共享交互流程，但本地数据、参数与模型需分别验证。</p></Card>
        <Card id="functions"><h2>功能说明</h2><p>实时态势展示公开天气模式格点和四城状态；影响与建议可展示有来源的积水点、居民区域汇总和部门行动，并提供人工复核建议；推演区支持自定义条件与历史事件回看。建议需由专业人员审核，不自动执行。</p></Card>
        <Card id="technology"><h2>技术栈</h2><p>React、Vite、React Router 构建静态站点交互；Leon Sans（SIL Open Font License 1.1）用于拉丁文字与数字标题，中文回退至 Noto Sans SC；Leaflet / React-Leaflet 展示地理地图，Three.js 在浏览器绘制参数化合成地形，Recharts 展示可交互时间序列；GitHub Pages 发布静态站点，GitHub Actions 定时获取开放数据快照；Node.js 脚本负责规范化、质量核查与构建。沙盘不需要后端服务。</p></Card>
        <Card id="sources"><h2>数据来源与许可</h2><p>当前已用来源包括 ECMWF IFS Open Data 降水模式格点、NOAA AWC 机场 METAR、NOAA IBTrACS 历史路径、NOAA GHCN-Daily 历史站点切片及政府数据门户登记线索。不同来源的许可、采样范围、时效和可用性分别核对；门户有目录不等于接口已获批。详细注册与接口说明见 <a href="https://data.zjzwfw.gov.cn/dopServer/" target="_blank" rel="noreferrer">浙江·数据开放</a>。</p></Card>
        <Card id="impact"><h2>影响分析</h2><p>真实事件区仅在取得来源、时间与许可核验通过的记录后显示积水点、居民区域汇总和部门行动；零记录表示未取得报告。暴露规模、道路连通性与可达性仍需城区积水范围和设施资料验证后计算，情景中的居民行为图只展示规则假设。</p></Card>
        <Card id="methods"><h2>计算与模型</h2><p>地图中的降雨圆形范围按 ECMWF 0.25° 邻近格点显示，值为同一起报累计降雨，非积水边界。情景台 `tabletop-rules-v1` 将输入的雨量、峰值、潮位、河网和排水档位映射为离散核查压力；该规则用于情景比较，不代表积水概率、严重度或经过训练的城市预测模型。实时态势的沙盘曲线根据用户假设的 24 小时总雨量与 1 小时峰值构造小时雨型，再将累计雨量、边界等级和排水假设映射为 0–1 规则指数及合成网格单元数。地形、建筑和水面由程序生成，不表达真实空间范围或水深。水动力候选技术包括 SFINCS 或 ANUGA，需本地地形、边界与水情数据校准后才可用于研究。</p></Card>
        <Card id="safety"><h2>使用边界与版本治理</h2><p>真实观测、历史记录、模型推断、模拟情景和缺失值分开展示。缺失不填零，也不等于安全。模型改进只能提出建议，经历史回测、安全检查和人工批准后发布新版本。网站不具备公众预警或自动调度资格。</p></Card>
      </div><div className="zo-about-footer"><a href="https://github.com/TenetJustin/cityos-flood/blob/main/docs/CITYOS_PRODUCT_GUIDE.md" target="_blank" rel="noreferrer">完整产品技术文档 ↗</a><a href="https://github.com/TenetJustin/cityos-flood" target="_blank" rel="noreferrer">GitHub 仓库 ↗</a><Link to="/workbench">返回工作台</Link></div>
    </div>
  </div>
}

export default function ZhejiangApp() {
  const observations = useObservations()
  const realEvents = useRealEventEvidence()
  const realtime = useZhejiangRealtime()
  return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}><Routes><Route path="/" element={<Landing/>}/><Route path="/welcome" element={<Landing/>}/><Route path="/workbench" element={<Workbench observations={observations} realEvents={realEvents} realtime={realtime}/>}/><Route path="/workbench/:cityId" element={<Workbench observations={observations} realEvents={realEvents} realtime={realtime}/>}/><Route path="/workbench/:cityId/:section" element={<Workbench observations={observations} realEvents={realEvents} realtime={realtime}/>}/><Route path="/overview" element={<Navigate to="/workbench" replace/>}/><Route path="/cities/*" element={<Navigate to="/workbench" replace/>}/><Route path="/about" element={<Navigate to="/about/product" replace/>}/><Route path="/about/:section" element={<About/>}/><Route path="*" element={<div className="zo-not-found"><h1>页面不存在</h1><Link to="/">返回首页</Link></div>}/></Routes></BrowserRouter>
}
