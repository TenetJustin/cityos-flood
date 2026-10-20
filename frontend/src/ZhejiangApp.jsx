import { useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { stationDisplayStatus } from './publicObservations.js'
import { CITY_CHECKS, ZHEJIANG_CITIES, ZHEJIANG_EVENTS, ZHEJIANG_SOURCES } from './zhejiangData.js'
import { assessZhejiangSnapshot } from './zhejiangObservations.js'
import HistoricalTrackPanel from './HistoricalTrackPanel.jsx'
import HistoricalRainPanel from './HistoricalRainPanel.jsx'
import { ResidentBehaviorPanel, ScenarioStudio } from './ScenarioStudio.jsx'
import ZhejiangForecastPanel from './ZhejiangForecastPanel.jsx'
import './zhejiang.css'

const cityById = (id) => ZHEJIANG_CITIES.find((city) => city.id === id)
const time = (value) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
  : '—'
const sourceCount = (cityId) => ZHEJIANG_SOURCES.filter((source) => source.city === cityId || source.city === 'all').length
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

function cityObservation(observations, cityId) {
  if (observations.state !== 'ok') return null
  return observations.data?.stations?.find((station) => station.city === cityId) || null
}

function cityState(observations, cityId) {
  if (observations.state === 'loading') return { label: '读取中', tone: 'muted', detail: '正在读取公开快照' }
  if (observations.state !== 'ok') return { label: '快照不可用', tone: 'amber', detail: observations.assessment?.valid === false ? '公开快照未通过字段与时间校验' : '公开机场接口或构建任务不可用' }
  const station = cityObservation(observations, cityId)
  if (!station?.latest) return { label: '无机场报文', tone: 'muted', detail: '本轮 AWC 查询没有返回本站记录' }
  if (stationDisplayStatus(station) === 'stale') return { label: '观测延迟', tone: 'amber', detail: `最近观测 ${time(station.latest.observed_at)}` }
  return { label: '机场观测可用', tone: 'mint', detail: `最近观测 ${time(station.latest.observed_at)}` }
}

function Mark({ tone = 'muted', children }) { return <span className={`zo-mark zo-mark-${tone}`}>{children}</span> }
function Arrow() { return <span aria-hidden="true">↗</span> }
function Card({ children, className = '' }) { return <section className={`zo-card ${className}`}>{children}</section> }
function SectionTitle({ kicker, title, trailing }) { return <div className="zo-section-title"><div><small>{kicker}</small><h2>{title}</h2></div>{trailing}</div> }

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

function Landing({ observations }) {
  const navigate = useNavigate()
  return <div className="zo-landing">
    <header className="zo-landing-header"><div className="zo-logo"><span className="zo-logo-glyph">◈</span><strong>CityOS</strong><span className="zo-logo-sub">ZHEJIANG</span></div><div className="zo-header-right"><Mark tone="mint">研究工作台</Mark><Link to="/about">说明 <Arrow/></Link></div></header>
    <main className="zo-landing-main"><div className="zo-landing-copy"><div className="zo-kicker"><span className="zo-live-dot"/> CITY OPERATING SYSTEM / ZHEJIANG</div><h1>浙江台风与<br/>城市内涝<span>世界模型</span></h1><p>四城态势、历史事件、情景预演与决策建议，汇于一处。</p><Link className="zo-primary" to="/workbench">进入工作台 <span>↗</span></Link><div className="zo-landing-cities"><span className="zo-small-label">选择城市</span>{ZHEJIANG_CITIES.map((city, index) => <Link key={city.id} to={cityPath(city.id)}><span>0{index + 1}</span><strong>{city.name}</strong><span className="zo-city-chevron">↗</span></Link>)}</div></div>
      <div className="zo-landing-visual"><ProvinceMap onCity={(id) => navigate(cityPath(id))} landing/><div className="zo-map-overlay"><span>研究范围</span><strong>宁波 · 台州 · 温州 · 杭州</strong><small>点击地图标记进入城市工作台</small></div></div></main>
    <footer className="zo-landing-footer"><span>CityOS · 浙江四城</span><span>公开机场快照：{ZHEJIANG_CITIES.filter((city) => cityObservation(observations, city.id)?.latest).length} / 4 站有报文</span><span>Asia/Shanghai · <Link to="/about">说明与边界</Link></span></footer>
  </div>
}

const NAV = [
  ['overview', '实时态势', '◫'], ['points', '点位', '⌖'], ['impact', '居民影响', '◎'],
  ['decision', '应急决策', '◇'], ['events', '事件库', '◷'], ['scenario', '情景预演', '◈'], ['data', '数据与模型', '▤'],
]

function Workbench({ observations }) {
  const { cityId, section } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const city = cityById(cityId)
  const activeSection = section || 'overview'
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])
  if (cityId && !city) return <div className="zo-not-found"><h1>未找到城市</h1><Link to="/workbench">返回区域态势</Link></div>
  const selectedCity = city?.id || 'ningbo'
  const navPath = (id) => city ? cityPath(city.id, id === 'overview' ? '' : id) : id === 'overview' ? '/workbench' : cityPath(selectedCity, id)
  const station = cityObservation(observations, city?.id)
  const status = city ? cityState(observations, city.id) : null
  return <div className="zo-shell"><a className="zo-skip" href="#zo-main">跳转至内容</a><aside className={`zo-sidebar ${menuOpen ? 'open' : ''}`}><Link className="zo-sidebar-brand" to="/"><span className="zo-logo-glyph">◈</span><span><strong>CityOS</strong><small>ZHEJIANG / WORKBENCH</small></span></Link><div className="zo-sidebar-label">工作空间</div><nav aria-label="工作台导航">{NAV.map(([id, label, icon]) => <NavLink key={id} to={navPath(id)} className={activeSection === id ? 'active' : ''}><span className="zo-nav-icon">{icon}</span>{label}<span className="zo-nav-arrow">↗</span></NavLink>)}</nav><div className="zo-sidebar-bottom"><Mark tone="mint">研究模式</Mark><p>浙江四城统一工作台</p><Link to="/about">数据与使用说明 ↗</Link></div></aside>
    {menuOpen && <button className="zo-backdrop" aria-label="关闭菜单" onClick={() => setMenuOpen(false)}/>}
    <div className="zo-content"><header className="zo-topbar"><div className="zo-top-left"><button className="zo-menu-button" type="button" aria-label="打开菜单" onClick={() => setMenuOpen(true)}>☰</button><Link to="/" className="zo-top-home">CityOS</Link><span className="zo-slash">/</span><select aria-label="选择城市" value={city?.id || 'region'} onChange={(event) => navigate(event.target.value === 'region' ? '/workbench' : cityPath(event.target.value, activeSection === 'overview' ? '' : activeSection))}><option value="region">浙江区域</option>{ZHEJIANG_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="zo-slash">/</span><strong>{NAV.find(([id]) => id === activeSection)?.[1] || '工作台'}</strong></div><div className="zo-top-right"><span className="zo-top-time">北京时间 · {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).format(new Date())}</span><Mark tone="muted">非公众预警</Mark><Link to="/about" aria-label="打开说明">?</Link></div></header>
      <main id="zo-main" className="zo-main"><div className="zo-page-heading"><div><div className="zo-kicker">{city ? `CITY / ${city.id.toUpperCase()}` : 'REGION / ZHEJIANG'} <span className="zo-kicker-line"/></div><h1>{city ? city.name : '浙江区域'}<span> / {NAV.find(([id]) => id === activeSection)?.[1]}</span></h1><p>{city ? city.focus : '宁波、台州、温州、杭州 · 统一视图'}</p></div><div className="zo-mode-tabs" aria-label="工作模式"><Link className={['overview', 'points', 'impact', 'decision', 'data'].includes(activeSection) ? 'active' : ''} to={city ? cityPath(city.id) : '/workbench'}>实时</Link><Link className={activeSection === 'events' ? 'active' : ''} to={navPath('events')}>回放</Link><Link className={activeSection === 'scenario' ? 'active' : ''} to={navPath('scenario')}>预演</Link></div></div>
        {activeSection === 'overview' && <Overview observations={observations} city={city} onCity={(id) => navigate(cityPath(id))}/>}
        {activeSection === 'points' && <Points city={city || cityById(selectedCity)} observations={observations}/>}
        {activeSection === 'impact' && <Impact city={city || cityById(selectedCity)}/>}
        {activeSection === 'decision' && <Decision city={city || cityById(selectedCity)}/>}
        {activeSection === 'events' && <Events city={city}/>}
        {activeSection === 'scenario' && <Scenario city={city || cityById(selectedCity)}/>}
        {activeSection === 'data' && <Data city={city} observations={observations}/>}
        {!NAV.some(([id]) => id === activeSection) && <Card><p>页面不存在。</p><Link to="/workbench">返回工作台</Link></Card>}
      </main><footer className="zo-statusbar"><span><i/> {city ? `${city.name} · ${status.label}` : '浙江四城 · 来源状态分城显示'}</span><span>城市中心为示意位置 · 观测与模型结果分开标记</span><span>研究分析 / 不执行调度</span></footer></div>
    <aside className="zo-inspector"><div className="zo-inspector-head"><small>INSPECTOR / 状态</small><h2>{city ? city.name : '浙江四城'}</h2><p>{city ? city.context : '四城共享界面，分别记录来源与缺口'}</p></div><div className="zo-inspector-body"><div className="zo-inspector-row"><span>数据时效</span><Mark tone={status?.tone || 'muted'}>{status?.label || '分城查看'}</Mark></div><div className="zo-inspector-row"><span>空间位置</span><strong>城市中心示意</strong></div><div className="zo-inspector-row"><span>内涝等级</span><strong>无可验证输出</strong></div><div className="zo-inspector-row"><span>模型版本</span><strong>研究阶段</strong></div>{station?.latest && <div className="zo-inspector-note"><small>机场观测 / NOAA AWC</small><strong>{time(station.latest.observed_at)}</strong><span>气温 {station.latest.temperature_c ?? '—'} °C · 风速 {station.latest.wind_kt ?? '—'} kt</span><p>仅代表机场点位气象。</p></div>}<div className="zo-inspector-note"><small>下一步</small><p>{city ? CITY_CHECKS[city.id][0] : '选择城市查看来源与核查清单。'}</p></div><Link className="zo-inspector-link" to={cityPath(selectedCity, 'data')}>查看数据来源与缺口 ↗</Link></div></aside>
  </div>
}

function Overview({ observations, city, onCity }) {
  const station = cityObservation(observations, city?.id)
  const state = city ? cityState(observations, city.id) : null
  const cards = city ? [
    ['最新气象观测', station?.latest ? time(station.latest.observed_at) : '—', station?.latest ? `${station.name} · 真实观测` : '当前无可用城市观测'],
    ['内涝点位等级', '—', '点位真值与模型验证待接入'],
    ['城市影响', '—', '无经过验证的影响估算'],
    ['待复核建议', '03', '基于城市特征的核查模板'],
  ] : [
    ['研究城市', '04', '宁波 · 台州 · 温州 · 杭州'],
    ['机场站点有报文', String(ZHEJIANG_CITIES.filter((item) => cityObservation(observations, item.id)?.latest).length).padStart(2, '0'), '公开机场气象 · 非城区积水'],
    ['内涝点位等级', '—', '无经过验证的四城输出'],
    ['来源目录', String(ZHEJIANG_SOURCES.length).padStart(2, '0'), '开放入口与申请线索'],
  ]
  return <><div className="zo-metrics">{cards.map(([label, value, note]) => <Card key={label} className="zo-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></Card>)}</div><div className="zo-dashboard-grid"><Card className="zo-map-card"><SectionTitle kicker="SPATIAL VIEW / 空间视图" title={city ? `${city.name}城市范围` : '浙江四城态势'} trailing={<Mark tone="muted">位置示意</Mark>}/><ProvinceMap cityId={city?.id} onCity={onCity}/><div className="zo-map-caption"><span>© OpenStreetMap contributors</span><span>台风 / 降雨 / 潮位 / 积水图层待接入</span></div></Card><div className="zo-dashboard-rail"><Card><SectionTitle kicker="DATA HEALTH / 数据状态" title={city ? '当前来源' : '四城状态'}/>{city ? <><div className="zo-health-line"><span>{city.name}</span><Mark tone={state.tone}>{state.label}</Mark></div><p className="zo-fineprint">{state.detail}</p><Link className="zo-text-link" to={cityPath(city.id, 'data')}>查看 {sourceCount(city.id)} 条来源线索 ↗</Link></> : ZHEJIANG_CITIES.map((item) => { const status = cityState(observations, item.id); return <Link className="zo-health-line" key={item.id} to={cityPath(item.id)}><span>{item.name}</span><Mark tone={status.tone}>{status.label}</Mark></Link> })}</Card><Card><SectionTitle kicker="ACTION / 核查入口" title="下一步"/>{(city ? CITY_CHECKS[city.id] : ['选择城市检查来源时效', '核对台风与降水开放数据接口', '建立历史事件的双时间证据']).map((text, index) => <div className="zo-action-line" key={text}><span>0{index + 1}</span><p>{text}</p></div>)}<Link className="zo-text-link" to={cityPath(city?.id || 'ningbo', 'decision')}>打开决策建议板 ↗</Link></Card></div></div><ZhejiangForecastPanel city={city}/><Card className="zo-bottom-card"><SectionTitle kicker="EVIDENCE / 研究流程" title="从观测到建议"/><div className="zo-process"><span>真实观测<small>来源与双时间</small></span><b>→</b><span>复合分析<small>城市参数与事件</small></span><b>→</b><span>影响评估<small>人口与设施</small></span><b>→</b><span>决策建议<small>人工复核</small></span></div></Card></>
}

function Points({ city, observations }) {
  const station = cityObservation(observations, city.id)
  const local = ZHEJIANG_SOURCES.filter((source) => source.city === city.id && source.category === '历史点位')
  return <div className="zo-two-col"><Card><SectionTitle kicker="POINTS / 点位清单" title={`${city.name}点位` } trailing={<Mark tone="amber">真值待接入</Mark>}/><div className="zo-empty-state"><span>⌖</span><h3>尚无可定位的积水观测点位</h3><p>已登记的公开点位资料需核对坐标、观测时间、深度基准和使用许可，之后才能用于地图和等级验证。</p></div>{local.map((source) => <a className="zo-source-lead" key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>{source.name}</span><small>{source.access}</small><Arrow/></a>)}</Card><Card><SectionTitle kicker="STATION / 已接入观测" title="气象站点"/>{station?.latest ? <div className="zo-station"><strong>{station.name} · {station.icao}</strong><div><span>观测时间</span><b>{time(station.latest.observed_at)}</b></div><div><span>气温</span><b>{station.latest.temperature_c ?? '—'} °C</b></div><div><span>气压</span><b>{station.latest.pressure_hpa ?? '—'} hPa</b></div><div><span>风速</span><b>{station.latest.wind_kt ?? '—'} kt</b></div><small>机场站点观测，不代表城区降雨或积水。</small></div> : <div className="zo-empty-state zo-empty-small"><span>—</span><h3>本轮无机场报文</h3><p>AWC 查询未返回此城市站点记录，或快照不可用。</p></div>}</Card></div>
}

function Impact({ city }) {
  const layers = [['人口暴露', 'WorldPop / GHS-POP · 数据导入与许可待核'], ['道路交通', '道路与下穿通道 · 城市级中断记录待接入'], ['居民行为', '规则 / Agent 情景 · 需调查与事件记录校准'], ['生命线设施', '停电停水记录 · 需授权']]
  return <div className="zs-stack"><div className="zo-two-col"><Card><SectionTitle kicker="IMPACT / 城市影响" title={`${city.name}居民与设施`}/><div className="zo-impact-hero"><span>实际影响人口</span><strong>—</strong><small>未接入可用于估算的暴露与积水图层</small></div><div className="zo-impact-grid">{['被困人口', '出行中断', '停电停水', '避难需求'].map((label) => <div key={label}><span>{label}</span><strong>—</strong></div>)}</div></Card><Card><SectionTitle kicker="LAYERS / 证据层" title="分析输入"/>{layers.map(([name, detail]) => <div className="zo-layer-line" key={name}><span className="zo-layer-symbol">◎</span><div><strong>{name}</strong><small>{detail}</small></div><Mark tone="muted">待接入</Mark></div>)}<p className="zo-fineprint">下方图像为假设人群的规则分流，不代表真实居民反应。</p></Card></div><ResidentBehaviorPanel city={city}/></div>
}

function Decision({ city }) {
  const [reviewed, setReviewed] = useState([])
  useEffect(() => setReviewed([]), [city.id])
  const recommendations = CITY_CHECKS[city.id]
  const toggle = (index) => setReviewed((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index])
  return <div className="zo-two-col"><Card><SectionTitle kicker="DECISION / 建议板" title={`${city.name}核查建议`} trailing={<Mark tone="amber">人工复核</Mark>}/><p className="zo-fineprint">当前清单来自城市特征和通用核查规则。未接入实时内涝风险，因此不生成封路、转移或泵闸调度指令。</p>{recommendations.map((item, index) => <div className="zo-decision-row" key={item}><span className="zo-decision-index">0{index + 1}</span><div><strong>{item}</strong><small>依据：{city.focus} · 现场与部门数据待复核</small></div><button type="button" onClick={() => toggle(index)} className={reviewed.includes(index) ? 'selected' : ''}>{reviewed.includes(index) ? '已加入' : '加入复核'}</button></div>)}</Card><Card><SectionTitle kicker="REVIEW / 本次会话" title="复核清单"/><div className="zo-review-count">{reviewed.length}<span> / {recommendations.length} 条已加入</span></div>{reviewed.length ? <ol className="zo-review-list">{reviewed.map((index) => <li key={index}>{recommendations[index]}</li>)}</ol> : <div className="zo-empty-state zo-empty-small"><span>◇</span><h3>选择需要复核的建议</h3><p>此清单只保留在当前页面会话，不提交给任何部门。</p></div>}<div className="zo-review-gate"><span>自动执行</span><Mark tone="muted">关闭</Mark></div><div className="zo-review-gate"><span>公众预警</span><Mark tone="muted">主管部门发布</Mark></div></Card></div>
}

function Events({ city }) {
  const entries = city ? ZHEJIANG_EVENTS.filter((event) => event.city === city.id) : ZHEJIANG_EVENTS
  return <><div className="zo-two-col"><Card><SectionTitle kicker="EVENT LIBRARY / 资料登记" title="历史事件" trailing={<Mark tone="muted">按证据等级筛选</Mark>}/>{entries.length ? entries.map((event) => <a className="zo-event-row" key={event.id} href={event.url} target="_blank" rel="noreferrer"><span className="zo-event-year">{event.year}</span><div><strong>{event.title}</strong><small>{cityById(event.city)?.name} · {event.type} · {event.source}</small><p>{event.note}</p></div><Mark tone="amber">{event.grade}</Mark><Arrow/></a>) : <div className="zo-empty-state zo-empty-small"><span>◷</span><h3>暂无已登记的事件资料</h3><p>事件需附来源、发生时间和当时可获得的数据版本。</p></div>}</Card><Card><SectionTitle kicker="REPLAY / 回放规则" title="证据分级"/><div className="zo-grade"><b>A</b><span>完整签发预报、观测、点位与响应</span></div><div className="zo-grade"><b>B</b><span>部分点位与环境证据</span></div><div className="zo-grade"><b>C</b><span>仅环境驱动，缺点位真值</span></div><div className="zo-grade"><b>D</b><span>报道或事后复盘，仅作背景</span></div><p className="zo-fineprint">只有具备当时签发数据和独立真值的事件才能用于定量回测。</p></Card></div><HistoricalRainPanel city={city}/><HistoricalTrackPanel city={city}/></>
}

function Scenario({ city }) {
  return <ScenarioStudio city={city}/>
}

function Data({ city, observations }) {
  const entries = city ? ZHEJIANG_SOURCES.filter((source) => source.city === city.id || source.city === 'all') : ZHEJIANG_SOURCES
  const audit = observations.assessment
  const snapshot = observations.data
  return <>
    <div className="zo-data-summary">
      <Card><strong>{entries.length}</strong><span>来源条目</span></Card>
      <Card><strong>04</strong><span>公开快照适配</span></Card>
      <Card><strong>—</strong><span>城市积水实测</span></Card>
    </div>
    <Card><SectionTitle kicker="SNAPSHOT / 质量核查" title="公开机场快照" trailing={<Mark tone={audit?.valid ? 'mint' : 'amber'}>{observations.state === 'loading' ? '读取中' : audit?.valid ? '结构通过' : '不可用'}</Mark>}/><div className="zo-model-row"><span>抓取时间 · 北京时间</span><strong>{snapshot?.fetched_at ? time(snapshot.fetched_at) : '—'}</strong></div><div className="zo-model-row"><span>本轮站点覆盖</span><strong>{audit ? `${audit.coverage} / 4` : '—'}</strong></div><div className="zo-model-row"><span>缺少站点</span><strong>{audit?.missing?.length ? audit.missing.map((id) => cityById(id)?.name || id).join(' · ') : audit ? '无' : '—'}</strong></div><div className="zo-model-row"><span>实际可获得时间</span><strong>未获独立证据 · null</strong></div><p className="zo-fineprint">结构校验只确认四站身份、时序、质量字段和明确缺失；不证明数据能代表城区雨量或积水，也不证明可用于历史回测。{audit?.issues?.length ? `校验问题：${audit.issues.join('、')}` : ''}</p></Card>
    <Card><SectionTitle kicker="SOURCE REGISTRY / 数据来源" title="接入与许可"/><div className="zo-source-table-wrap"><table className="zo-source-table"><thead><tr><th>来源</th><th>范围</th><th>接入状态</th><th>时效 / 覆盖</th><th>许可</th></tr></thead><tbody>{entries.map((source) => <tr key={source.id}><td><a href={source.url} target="_blank" rel="noreferrer"><strong>{source.name} ↗</strong><small>{source.publisher} · {source.category}</small></a></td><td>{source.id === 'awc' ? '四城机场' : source.id === 'ibtracs' ? '四城邻近路径' : source.id === 'ecmwf' ? '四城预报格点' : source.id === 'ghcnd' ? '4 站日值 / 温州本地缺失' : source.city === 'all' ? '全省目录' : cityById(source.city)?.name}</td><td><Mark tone={['awc', 'ibtracs', 'ecmwf', 'ghcnd'].includes(source.id) ? 'mint' : 'amber'}>{source.access}</Mark></td><td>{source.cadence}<small>{source.coverage}</small></td><td>{source.license}</td></tr>)}</tbody></table></div></Card>
    <Card><SectionTitle kicker="MODEL / 版本状态" title="浙江模型"/><div className="zo-model-row"><span>四城统一数据契约</span><Mark tone="mint">方案已定义</Mark></div><div className="zo-model-row"><span>点位四级概率模型</span><Mark tone="amber">训练与验证待完成</Mark></div><div className="zo-model-row"><span>居民 Agent 与资源优化</span><Mark tone="amber">情景研究阶段</Mark></div><div className="zo-model-row"><span>公众预警与自动调度</span><Mark tone="muted">未启用</Mark></div></Card>
  </>
}

function About() {
  return <div className="zo-about">
    <header><Link to="/" className="zo-logo"><span className="zo-logo-glyph">◈</span><strong>CityOS</strong></Link><Link to="/workbench">进入工作台 ↗</Link></header>
    <div className="zo-about-content"><div className="zo-kicker">ABOUT / 说明中心</div><h1>浙江台风与城市内涝世界模型</h1>
      <p>CityOS 面向宁波、台州、温州、杭州，组织台风、降雨、潮位、河网、城市空间和历史事件的证据，支持研究分析、情景预演和人工复核的决策建议。</p>
      <div className="zo-about-grid">
        <Card><h2>数据口径</h2><p>每条记录应保留来源、许可、观测时间、实际可获得时间、时区、空间基准、单位、质量与缺失状态。真实观测、历史记录、模型推断和模拟情景分别标记。</p></Card>
        <Card><h2>模型与建议</h2><p>城市参数需分别校准；点位等级、居民影响和资源方案须经过历史事件回测。建议保留触发依据、时间窗和人工复核状态。</p></Card>
        <Card><h2>当前网站</h2><p>公开机场气象快照对四城发起查询，各城市仅显示本轮实际返回的记录；ECMWF 天气模式格点提供降雨预报驱动，历史最佳路径用于筛选待核验事件。城区实测雨量、潮位、河网和积水来源仍需准入；规则演练采用用户输入的假设条件。</p></Card>
        <Card><h2>使用边界</h2><p>本站供研究分析和专业辅助研判。公众预警由主管部门发布；本站不自动执行封路、转移、泵闸或救援调度。</p></Card>
      </div><div className="zo-about-footer"><a href="https://github.com/TenetJustin/cityos-flood" target="_blank" rel="noreferrer">GitHub 仓库 ↗</a><Link to="/workbench/ningbo/data">查看来源目录 ↗</Link></div>
    </div>
  </div>
}

export default function ZhejiangApp() {
  const observations = useObservations()
  return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}><Routes><Route path="/" element={<Landing observations={observations}/>}/><Route path="/workbench" element={<Workbench observations={observations}/>}/><Route path="/workbench/:cityId" element={<Workbench observations={observations}/>}/><Route path="/workbench/:cityId/:section" element={<Workbench observations={observations}/>}/><Route path="/overview" element={<Navigate to="/workbench" replace/>}/><Route path="/cities/*" element={<Navigate to="/workbench" replace/>}/><Route path="/about" element={<About/>}/><Route path="*" element={<div className="zo-not-found"><h1>页面不存在</h1><Link to="/">返回首页</Link></div>}/></Routes></BrowserRouter>
}
