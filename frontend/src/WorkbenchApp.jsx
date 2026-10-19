import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { catalogCheckedAt, cities, event, evidenceTypes, labModules, sources } from './workbenchData.js'
import './workbench.css'

const STATIC_PAGES = import.meta.env.VITE_STATIC_PAGES === 'true'
const REPO = 'https://github.com/TenetJustin/cityos-flood'
const nav = [
  ['overview', '总览', 'grid'], ['cities', '城市', 'pin'], ['events', '事件', 'clock'],
  ['models', '模型', 'layers'], ['sources', '来源', 'database'], ['review', '复核', 'check'], ['lab/shenzhen', '深圳实验区', 'flask'],
]
const fmt = (value) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '缺失'
const cityName = (id) => cities.find((city) => city.id === id)?.name || id

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    flask: <><path d="M9 3h6M10 3v7l-5.5 8.5A2 2 0 0 0 6.2 22h11.6a2 2 0 0 0 1.7-3.5L14 10V3M8 15h8"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    close: <path d="M5 5l14 14M19 5 5 19"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></>,
    moon: <path d="M20 16A8 8 0 0 1 8 4 8 8 0 1 0 20 16Z"/>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Badge({ children, tone = 'neutral' }) { return <span className={`wb-badge wb-${tone}`}>{children}</span> }
function Empty({ title, children, action }) { return <div className="wb-empty"><span className="wb-empty-mark">—</span><h3>{title}</h3><p>{children}</p>{action}</div> }
function SectionHead({ eyebrow, title, side }) { return <div className="wb-section-head"><div><div className="wb-eyebrow">{eyebrow}</div><h2>{title}</h2></div>{side}</div> }
function Panel({ children, className = '' }) { return <section className={`wb-panel ${className}`}>{children}</section> }

function useSnapshot() {
  const [result, setResult] = useState({ state: STATIC_PAGES ? 'static' : 'loading', data: null })
  useEffect(() => {
    if (STATIC_PAGES) return
    let active = true
    const load = () => fetch('/api/realtime/snapshot', { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => { if (active) setResult({ state: 'ok', data }) })
      .catch(() => { if (active) setResult({ state: 'unavailable', data: null }) })
    load()
    const timer = setInterval(load, 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return result
}

function ChangeMapView({ center, zoom }) {
  const map = useMap()
  useEffect(() => { map.flyTo(center, zoom, { duration: 0.6 }) }, [center[0], center[1], zoom, map])
  return null
}

function StudyMap({ activeCity, onSelect, showMarkers, compact = false }) {
  const center = activeCity?.center || [25.9, 116.5]
  const zoom = activeCity ? 10 : 6
  return <div className={`wb-map ${compact ? 'wb-map-compact' : ''}`}>
    <MapContainer center={center} zoom={zoom} scrollWheelZoom={false} zoomControl={true} attributionControl={true}>
      <ChangeMapView center={center} zoom={zoom} />
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      {showMarkers && cities.map((city) => <CircleMarker key={city.id} center={city.center} radius={activeCity?.id === city.id ? 10 : 8} pathOptions={{ color: '#f3f7f6', weight: 2, fillColor: city.id === 'shenzhen' ? '#36c9a2' : '#5b9cff', fillOpacity: 0.95 }} eventHandlers={{ click: () => onSelect(city.id) }}><Tooltip direction="top" offset={[0, -10]}>{city.name} · {city.status}</Tooltip></CircleMarker>)}
    </MapContainer>
    <div className="wb-map-legend"><span className="wb-dot blue"/>研究范围 <span className="wb-dot green"/>深圳原型 <span className="wb-map-legend-note">城市中心示意点，非风险位置</span></div>
  </div>
}

function Inspector({ selected, snapshot }) {
  const [tab, setTab] = useState('overview')
  useEffect(() => setTab('overview'), [selected?.id, selected?.kind])
  const tabs = [['overview', '概况'], ['source', '来源'], ['gaps', '缺口'], ['version', '版本']]
  const selectedCity = selected?.kind === 'city' ? cities.find((city) => city.id === selected.id) : null
  const selectedSource = selected?.kind === 'source' ? sources.find((source) => source.id === selected.id) : null
  return <aside className="wb-inspector" aria-label="对象检查器">
    <div className="wb-inspector-head"><div className="wb-eyebrow">INSPECTOR / 对象检查器</div><h2>{selectedCity?.name || selectedSource?.name || '五城研究范围'}</h2><p>{selectedCity ? selectedCity.form : selectedSource ? selectedSource.publisher : '选择地图城市或来源条目查看证据与缺口'}</p></div>
    <div className="wb-tabs" role="tablist" aria-label="检查器标签">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="wb-inspector-body">
      {tab === 'overview' && <>
        <div className="wb-mini-label">当前状态</div>
        <div className="wb-stack"><Badge tone="warning">{selectedCity?.status || selectedSource?.type || '区域研究'}</Badge><Badge tone="neutral">不具备公众预警资格</Badge></div>
        <dl className="wb-details"><dt>研究时区</dt><dd>Asia/Shanghai · UTC+08:00</dd><dt>目录核对</dt><dd>{catalogCheckedAt}</dd><dt>实时观测</dt><dd>{snapshot.state === 'ok' && snapshot.data?.stored_record_count ? `已存 ${snapshot.data.stored_record_count} 条未独立核验记录` : '公开站未提供核验观测'}</dd><dt>空间位置</dt><dd>{selectedCity ? '城市中心示意；非观测站点' : '未选择具体城市'}</dd></dl>
        {selectedCity && <><div className="wb-mini-label">研究驱动</div><div className="wb-stack">{selectedCity.drivers.map((driver) => <Badge key={driver}>{driver}</Badge>)}</div></>}
      </>}
      {tab === 'source' && <>
        {selectedSource ? <><dl className="wb-details"><dt>发布机构</dt><dd>{selectedSource.publisher}</dd><dt>接入状态</dt><dd>{selectedSource.access}</dd><dt>结构映射</dt><dd>{selectedSource.mapping}</dd><dt>许可</dt><dd>{selectedSource.license}</dd><dt>现象</dt><dd>{selectedSource.phenomena}</dd></dl><a className="wb-inline-link" href={selectedSource.url} target="_blank" rel="noopener noreferrer">打开原始入口 ↗</a></> : <Empty title="未选中来源">来源目录是候选清单，不能证明数据已接入。<br/><Link to="/sources">查看来源目录 →</Link></Empty>}
      </>}
      {tab === 'gaps' && <><div className="wb-mini-label">阻塞项</div><ul className="wb-gap-list">{(selectedSource?.gaps || ['逐站双时间观测未齐', '独立积水真值与许可待核', '五城模型尚未完成验证']).map((gap) => <li key={gap}>{gap}</li>)}</ul></>}
      {tab === 'version' && <><dl className="wb-details"><dt>目录版本</dt><dd>{catalogCheckedAt} 静态快照</dd><dt>模型版本</dt><dd>未批准区域生产模型</dd><dt>部署形态</dt><dd>{STATIC_PAGES ? 'GitHub Pages · 只读静态站' : '本地前端 · 后端按连接状态读取'}</dd></dl><p className="wb-muted">目录更新时间不是观测时间或数据实际可获得时间。</p></>}
    </div>
  </aside>
}

function Timeline({ snapshot }) {
  const [params, setParams] = useSearchParams()
  const asOf = params.get('as_of')
  const setAsOf = (value) => { const next = new URLSearchParams(params); if (value) next.set('as_of', value); else next.delete('as_of'); setParams(next) }
  const shift = (minutes) => {
    const base = asOf ? new Date(asOf) : new Date()
    if (Number.isNaN(base.getTime())) return
    setAsOf(new Date(base.getTime() + minutes * 60_000).toISOString())
  }
  const snapshotDate = snapshot.data?.as_of
  return <div className="wb-timeline"><div className="wb-timeline-top"><div><div className="wb-eyebrow">TIME / 双时间轴</div><strong>时间视图</strong><span className="wb-muted">此处仅改变查看时刻，不生成观测</span></div><div className="wb-timeline-actions"><button type="button" onClick={() => shift(-60)} aria-label="查看时间前移一小时">− 1h</button><button type="button" onClick={() => setAsOf('')}>回到当前</button><button type="button" onClick={() => shift(60)} aria-label="查看时间后移一小时">+ 1h</button></div></div><div className="wb-timeline-lanes"><div><span>查看时刻</span><b>{asOf && !Number.isNaN(new Date(asOf).getTime()) ? fmt(asOf) : '当前'}</b></div><div><span>观测时间 observed_at</span><b className="wb-missing">无可展示的核验观测</b></div><div><span>实际可获得时间 available_at</span><b className="wb-missing">无可展示的核验版本</b></div><div><span>快照生成</span><b>{snapshotDate ? fmt(snapshotDate) : '静态目录，无实时快照'}</b></div></div></div>
}

function Overview({ snapshot, selected, setSelected, showMarkers, setShowMarkers }) {
  const activeCity = selected?.kind === 'city' ? cities.find((city) => city.id === selected.id) : null
  return <>
    <div className="wb-page-intro"><div><div className="wb-eyebrow">REGIONAL RESEARCH / 五城研究</div><h1>从证据出发，理解城市内涝</h1><p>研究暴雨、台风、潮位、河流与城市系统的耦合作用。地图展示研究城市，并不显示实时风险。</p></div><Badge tone="warning">研究用途 · 非公众预警</Badge></div>
    <div className="wb-kpis"><div><span>研究城市</span><b>05</b><small>上海 · 宁波 · 福州 · 深圳 · 海口</small></div><div><span>来源登记</span><b>07</b><small>候选与门户线索，并非已接入</small></div><div><span>核验实时来源</span><b>00</b><small>尚未通过完整晋级条件</small></div><div><span>可发布预警模型</span><b>00</b><small>所有安全门槛保持关闭</small></div></div>
    <Panel className="wb-map-panel"><div className="wb-map-toolbar"><div><div className="wb-eyebrow">SPATIAL CONTEXT / 空间索引</div><h2>{activeCity ? `${activeCity.name} · ${activeCity.form}` : '五城研究地图'}</h2></div><label className="wb-check"><input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)}/>显示城市中心</label></div><StudyMap activeCity={activeCity} showMarkers={showMarkers} onSelect={(id) => setSelected({ kind: 'city', id })}/><div className="wb-map-foot"><span>底图 © OpenStreetMap contributors</span><span>积水 / 潮位 / 河流图层：未接入核验数据</span></div></Panel>
    <div className="wb-two-col"><Panel><SectionHead eyebrow="CITIES / 五城" title="独立模型，统一证据口径" side={<Link to="/cities" className="wb-inline-link">查看全部 <Icon name="arrow" size={15}/></Link>}/><div className="wb-city-mini-grid">{cities.map((city) => <Link to={`/cities/${city.id}`} key={city.id} className="wb-city-mini"><b>{city.name}</b><span>{city.form}</span><Badge tone={city.id === 'shenzhen' ? 'info' : 'neutral'}>{city.status}</Badge></Link>)}</div></Panel><Panel><SectionHead eyebrow="EVIDENCE / 真实性" title="五类证据，绝不混用"/><div className="wb-evidence-list">{evidenceTypes.map((item, index) => <div key={item.id}><span>0{index + 1}</span><b>{item.name}</b><small>{item.id}</small></div>)}</div><Link to="/about/evidence" className="wb-inline-link">查看证据契约 <Icon name="arrow" size={15}/></Link></Panel></div>
    <Timeline snapshot={snapshot}/>
  </>
}

function CitiesPage() { return <><PageIntro eyebrow="CITY MODELS / 城市" title="五城，各自建模" text="统一的是数据与事件契约，不是可直接复用的城市参数。城市配置不等于已接入观测或完成预测验证。"/><div className="wb-city-cards">{cities.map((city, i) => <Link to={`/cities/${city.id}`} key={city.id} className="wb-city-card"><span className="wb-card-index">0{i + 1} / 05</span><div><h2>{city.name}</h2><p>{city.form}</p></div><div className="wb-stack">{city.drivers.map((driver) => <Badge key={driver}>{driver}</Badge>)}</div><div className="wb-card-bottom"><Badge tone={city.id === 'shenzhen' ? 'info' : 'neutral'}>{city.status}</Badge><Icon name="arrow"/></div></Link>)}</div></> }

function CityPage() {
  const { cityId } = useParams(); const city = cities.find((item) => item.id === cityId)
  if (!city) return <NotFound/>
  const citySources = sources.filter((source) => source.city === city.id)
  return <><PageIntro eyebrow={`CITY / ${city.id.toUpperCase()}`} title={`${city.name} · ${city.form}`} text="本页展示研究范围、来源候选与待补证据。地图中心是示意位置，不是水位站或风险点。"/><div className="wb-city-layout"><Panel className="wb-city-map"><StudyMap activeCity={city} showMarkers onSelect={() => {}} compact/></Panel><Panel><SectionHead eyebrow="MODEL READINESS / 模型状态" title={city.status}/><p>主要致涝过程：{city.drivers.join('、')}。</p><div className="wb-callout">{city.id === 'shenzhen' ? '已有实验性模块，但尚缺独立历史真值、完整实时源和合格的预测回测。' : '已定义城市范围；观测接入、城市参数、独立事件验证和影响模型尚未完成。'}</div><div className="wb-gates"><span>实时观测</span><b>未核验</b><span>历史事件回测</span><b>未通过</b><span>公众预警</span><b>禁止</b></div></Panel></div><Panel><SectionHead eyebrow="SOURCES / 来源候选" title={`${citySources.length} 条目录记录`} side={<Link to="/sources" className="wb-inline-link">完整目录 →</Link>}/><div className="wb-source-grid">{citySources.map((source) => <div key={source.id} className="wb-source-tile"><Badge tone="warning">{source.type}</Badge><h3>{source.name}</h3><p>{source.access} · 许可{source.license}</p><a href={source.url} target="_blank" rel="noopener noreferrer">原始入口 ↗</a></div>)}</div></Panel></>
}

function PageIntro({ eyebrow, title, text, badge }) { return <div className="wb-page-intro"><div><div className="wb-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{text}</p></div>{badge}</div> }

function EventsPage() { return <><PageIntro eyebrow="EVENTS / 历史事件" title="事件证据，不是故事化重演" text="历史事件可包含台风、独立暴雨或复合致涝过程。当前仅登记一个端到端候选，并未完成有效的预测技巧回测。"/><Panel><div className="wb-event-row"><div className="wb-date-box"><b>07</b><span>2023 / 09</span></div><div><div className="wb-stack"><Badge tone="info">历史记录</Badge><Badge tone="warning">事件候选</Badge></div><h2>{event.title}</h2><p>{event.description}</p></div><Link to={`/events/${event.id}`} className="wb-open-btn">查看证据 <Icon name="arrow"/></Link></div></Panel><Panel><SectionHead eyebrow="EVENT CONTRACT / 事件契约" title="双时间与缺失值是必填边界"/><div className="wb-contract-grid"><div><b>observed_at</b><span>现象发生或被观测的时间</span></div><div><b>available_at</b><span>该版本实际可被当时运行读取的时间</span></div><div><b>space / unit</b><span>坐标、高程基准与原单位</span></div><div><b>provenance</b><span>来源、许可、质量与版本链</span></div></div></Panel></> }

function EventPage() { const { eventId } = useParams(); if (eventId !== event.id) return <NotFound/>; return <><PageIntro eyebrow="EVENT / HISTORICAL CANDIDATE" title={event.title} text={event.description} badge={<Badge tone="warning">不能用于公众预警</Badge>}/><div className="wb-two-col"><Panel><SectionHead eyebrow="VERIFIABLE / 可核验" title="事后官方资料"/><p className="wb-muted">下列是历史记录，不是当时可获得的实时输入。精确原文链接见仓库事件证据文档。</p><div className="wb-records">{event.records.map((record) => <div key={record.source}><Badge tone="info">历史记录</Badge><h3>{record.source}</h3><p>{record.fact}</p></div>)}</div><a className="wb-inline-link" href={`${REPO}/blob/main/docs/events/2023-09-07_SHENZHEN_EVIDENCE.md`} target="_blank" rel="noopener noreferrer">打开来源与限制清单 ↗</a></Panel><Panel><SectionHead eyebrow="MISSING / 数据缺口" title="回测被阻塞"/><ul className="wb-gap-list">{event.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul><div className="wb-callout">缺少 forecast-as-issued 和独立积水真值，不能报告预测技巧；事后部门汇总不能拆成个人行为或逐项执行日志。</div></Panel></div><Panel><SectionHead eyebrow="TIME / 事件时间线" title="已知事件窗口，未重建逐时状态"/><div className="wb-event-timeline"><div><b>2023-09-07 至 09-08</b><span>事件过程 · 由事后资料确认</span></div><div><b>2023-09-10 及以后</b><span>部门工作动态和年度总结发布；属于事后记录</span></div><div className="missing"><b>事件当时</b><span>逐站观测可获得时间、预报签发快照和行动日志均缺失</span></div></div></Panel></> }

function ModelsPage() { return <><PageIntro eyebrow="MODELS / 模型与版本" title="从研究原型到可审查模型" text="五城必须各自校准、验证，再以一致口径进入区域比较。实验代码的存在不表示模型已可交付。"/><div className="wb-city-cards wb-model-cards">{cities.map((city) => <Panel key={city.id}><div className="wb-card-top"><span className="wb-eyebrow">{city.id.toUpperCase()}</span><Badge tone={city.id === 'shenzhen' ? 'info' : 'neutral'}>{city.status}</Badge></div><h2>{city.name}模型</h2><p>{city.id === 'shenzhen' ? '已有研究原型；独立真值与历史回测仍未满足。' : '仅有研究配置，尚无城市模型可验证。'}</p><div className="wb-gates"><span>已批准版本</span><b>无</b><span>独立回测</span><b>未通过</b></div></Panel>)}</div><Panel><SectionHead eyebrow="CONTROLLED RSI / 受控改进" title="建议不能自行成为新版本"/><div className="wb-flow"><span>候选调整建议</span><i>→</i><span>冻结事件回测</span><i>→</i><span>泄漏与安全检查</span><i>→</i><span>人工批准</span><i>→</i><span>影子运行与回退</span></div><p className="wb-muted">未达到门槛时保持当前版本；任何组件不得自动更改模型、安全阈值或现实设施。</p></Panel></> }

function SourcesPage({ onSelect }) { const [query, setQuery] = useState(''); const [city, setCity] = useState('all'); const shown = sources.filter((source) => (city === 'all' || source.city === city) && `${source.name}${source.publisher}${source.phenomena}`.toLowerCase().includes(query.toLowerCase())); return <><PageIntro eyebrow="SOURCES / 来源登记" title="能找到，不等于能使用" text={`目录核对日期 ${catalogCheckedAt}。这里记录候选数据集与门户线索；当前没有通过完整来源、许可、时空、质量与回测门槛的实时来源。`}/><Panel><div className="wb-filterbar"><label>城市<select value={city} onChange={(e) => setCity(e.target.value)}><option value="all">全部城市</option>{cities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>搜索<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="来源、机构或现象"/></label><span>{shown.length} / {sources.length} 条</span></div><div className="wb-table-wrap"><table className="wb-table"><thead><tr><th>城市 / 来源</th><th>类别</th><th>接入状态</th><th>结构映射</th><th>许可</th><th>操作</th></tr></thead><tbody>{shown.map((source) => <tr key={source.id}><td><button className="wb-table-select" type="button" onClick={() => onSelect({ kind: 'source', id: source.id })}><strong>{source.name}</strong><small>{cityName(source.city)} · {source.publisher}</small></button></td><td>{source.type}</td><td>{source.access}</td><td><Badge tone="warning">{source.mapping}</Badge></td><td>{source.license}</td><td><a href={source.url} target="_blank" rel="noopener noreferrer">原始入口 ↗</a></td></tr>)}</tbody></table></div>{shown.length === 0 && <Empty title="没有匹配的来源">调整城市或关键词后重试。</Empty>}</Panel><Panel><SectionHead eyebrow="ADMISSION / 来源晋级" title="候选 → 合格输入"/><div className="wb-contract-grid"><div><b>01 · 权限</b><span>明确访问方式、许可与保存范围</span></div><div><b>02 · 结构</b><span>时间、坐标、单位、高程基准可解释</span></div><div><b>03 · 质量</b><span>新鲜度、缺测、重复与独立核验</span></div><div><b>04 · 回测</b><span>历史版本冻结与无泄漏验证</span></div></div></Panel></> }

function ReviewPage() { return <><PageIntro eyebrow="REVIEW / 复核台" title="拒绝未经证实的晋级" text="公开站仅展示规则与状态。审批、回测提交、模型发布需要身份、审计日志和受控服务端；GitHub Pages 不提供这些能力。" badge={<Badge tone="warning">只读</Badge>}/><div className="wb-two-col"><Panel><SectionHead eyebrow="GATES / 四道能力门" title="全部保持关闭"/><div className="wb-review-gates">{[['预测输入', '未开放'], ['模型同化', '未开放'], ['公众预警', '禁止'], ['自动调度', '禁止']].map(([name, status]) => <div key={name}><span>{name}</span><Badge tone="danger">{status}</Badge></div>)}</div></Panel><Panel><SectionHead eyebrow="QUEUE / 待复核" title="没有公开审批队列"/><Empty title="需要受控服务端">静态网站不能认证复核人，也不能持久化审批记录。这里不显示虚构队列或“已批准”项目。</Empty><button type="button" disabled className="wb-disabled-action" title="缺少身份与受控审批服务">批准模型版本</button></Panel></div><Panel><SectionHead eyebrow="CHECKLIST / 发布前检查" title="必须逐项留下证据"/><ol className="wb-checklist"><li>来源许可、原始记录、时间与空间基准已核验</li><li>冻结独立历史事件，并严格检查 available_at 泄漏</li><li>误差、覆盖、失败场景与安全约束满足预定门槛</li><li>人工审批、签名、回退与影子运行有可追溯记录</li></ol></Panel></> }

function LabPage() { const { moduleId } = useParams(); const module = labModules.find((item) => item.id === moduleId); if (moduleId && !module) return <NotFound/>; return <><PageIntro eyebrow="LAB / SHENZHEN" title={module ? module.name : '深圳实验区'} text={module ? module.detail : '既有深圳模块的研究索引。公开 GitHub Pages 不提供受控后端、原始数据和执行权限，因此不会把旧实验输出包装为五城实况。'} badge={<Badge tone="info">实验性 · 只读索引</Badge>}/>{module ? <div className="wb-two-col"><Panel><SectionHead eyebrow="MODULE / 模块边界" title={module.category}/><p>{module.detail}</p><div className="wb-callout">本模块的实验代码仍保留在仓库。此公开站不执行计算、不展示未经核验的输出，也不触发预警或调度。</div><a href={`${REPO}/tree/main/frontend/src/components`} target="_blank" rel="noopener noreferrer" className="wb-inline-link">查看原型代码 ↗</a></Panel><Panel><SectionHead eyebrow="AVAILABILITY / 可用性" title="公开运行环境不可用"/><Empty title="需要本地研究环境">运行该原型需后端、获授权数据及独立验证。请按仓库说明在本地环境使用，并保留证据类别标签。</Empty></Panel></div> : <div className="wb-lab-grid">{labModules.map((item) => <Link to={`/lab/shenzhen/${item.id}`} className="wb-lab-card" key={item.id}><Badge tone="info">{item.category}</Badge><h2>{item.name}</h2><p>{item.detail}</p><span>查看边界 <Icon name="arrow" size={16}/></span></Link>)}</div>}</> }

function AboutPage() { const { section } = useParams(); const sections = { project: ['项目定位', 'CITY OS 研究上海、宁波、福州、深圳、海口的复合城市内涝机制、影响与韧性。事件不限于台风，也包括独立暴雨和其他复合致涝过程。'], evidence: ['证据契约', '每条数据需保留证据类别、来源、许可、质量标记、缺失状态、时区、观测时间与实际可获得时间、空间和高程基准、单位及版本。'], safety: ['安全边界', '当前没有真实城市预警或自动调度资格。模型调整仅能提出建议，经回测、安全检查与人工批准后才可能进入新版本。'] }; const active = sections[section] ? section : 'project'; return <><PageIntro eyebrow="ABOUT / 项目说明" title={sections[active][0]} text={sections[active][1]}/><div className="wb-about-layout"><nav aria-label="关于页面目录">{Object.entries(sections).map(([id, [label]]) => <Link key={id} to={`/about/${id}`} className={id === active ? 'active' : ''}>{label}</Link>)}</nav><Panel>{active === 'evidence' ? <><SectionHead eyebrow="EVIDENCE CLASSES" title="分类、时间与缺失"/><div className="wb-evidence-detail">{evidenceTypes.map((item) => <div key={item.id}><Badge tone={item.id === 'missing' ? 'warning' : 'info'}>{item.name}</Badge><code>{item.id}</code><p>{item.description}</p></div>)}</div><div className="wb-callout">统一业务时区为 Asia/Shanghai。observed_at 与 available_at 不得互换；未知字段保持缺失，不填零、不推断为实况。</div></> : active === 'safety' ? <><SectionHead eyebrow="NOT OPERATIONAL" title="研究网站，不是指挥系统"/><p>没有已批准的五城生产模型，没有全部核验的实时来源，没有认证审批、公众预警与设施控制链路。</p><div className="wb-review-gates">{['真实预警', '自动调度', '自动改版', '虚构响应'].map((item) => <div key={item}><span>{item}</span><Badge tone="danger">禁止</Badge></div>)}</div></> : <><SectionHead eyebrow="THE WORKBENCH" title="看得见的证据与缺口"/><p>这个站点把城市、事件、模型、来源和复核边界放在同一工作台。地图用于导航和空间语境；要展示水深、时序或居民行为，必须先取得可核验资料。</p><p>项目代码及完整技术文档公开在 <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub 仓库 ↗</a>。</p></>}</Panel></div></> }

function SettingsPage({ theme, setTheme }) { return <><PageIntro eyebrow="SETTINGS / 查看设置" title="工作台偏好" text="偏好只保存在当前浏览器。这里没有账号或真实权限切换。"/><Panel><SectionHead eyebrow="APPEARANCE / 外观" title="颜色模式"/><div className="wb-setting-row"><span>界面主题</span><div className="wb-segmented"><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>深色</button><button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>浅色</button></div></div><div className="wb-setting-row"><span>时间显示</span><b>Asia/Shanghai · UTC+08:00</b></div><div className="wb-setting-row"><span>访问角色</span><b>公开访客 · 只读</b></div></Panel></> }

function NotFound() { return <div className="wb-not-found"><div className="wb-eyebrow">404 / NOT FOUND</div><h1>这里没有可用的研究页面</h1><p>检查地址，或返回五城总览。</p><Link to="/overview" className="wb-primary-link">返回总览 <Icon name="arrow"/></Link></div> }

function Shell() {
  const location = useLocation(); const [params, setParams] = useSearchParams(); const [selected, setSelectedState] = useState(() => params.get('city') ? { kind: 'city', id: params.get('city') } : null); const [showMarkers, setShowMarkers] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem('cityos-workbench-theme') || 'dark')
  const [menuOpen, setMenuOpen] = useState(false)
  const snapshot = useSnapshot()
  useEffect(() => { document.documentElement.dataset.wbTheme = theme; localStorage.setItem('cityos-workbench-theme', theme) }, [theme])
  useEffect(() => setMenuOpen(false), [location.pathname])
  const setSelected = (item) => { setSelectedState(item); const next = new URLSearchParams(params); if (item?.kind === 'city') next.set('city', item.id); else next.delete('city'); setParams(next) }
  const activeTop = useMemo(() => { const parts = location.pathname.split('/').filter(Boolean); return parts[0] || 'overview' }, [location.pathname])
  return <div className="wb-shell"><a className="wb-skip" href="#main">跳转至正文</a><aside className={`wb-sidebar ${menuOpen ? 'open' : ''}`}><Link to="/overview" className="wb-brand" aria-label="CITY OS 总览"><span className="wb-brand-symbol"><i/><i/><i/><i/></span><span><strong>CITY <em>OS</em></strong><small>FIVE-CITY FLOOD RESEARCH</small></span></Link><div className="wb-nav-label">RESEARCH WORKBENCH</div><nav className="wb-main-nav" aria-label="主导航">{nav.map(([id, label, icon]) => <NavLink key={id} to={`/${id}`} className={({ isActive }) => isActive || (id === 'cities' && activeTop === 'cities') || (id === 'events' && activeTop === 'events') || (id === 'lab/shenzhen' && activeTop === 'lab') ? 'active' : ''}><Icon name={icon}/><span>{label}</span><span className="wb-nav-arrow">›</span></NavLink>)}</nav><div className="wb-sidebar-bottom"><div className="wb-sidebar-status"><span className="wb-pulse"/><div><b>研究模式</b><small>非公众预警 · 无自动调度</small></div></div><p>CATALOG SNAPSHOT<br/>{catalogCheckedAt}</p></div></aside>
    {menuOpen && <button className="wb-backdrop" type="button" aria-label="关闭导航" onClick={() => setMenuOpen(false)}/>}
    <div className="wb-main-column"><header className="wb-topbar"><div className="wb-top-left"><button className="wb-mobile-menu" type="button" aria-label="打开导航" onClick={() => setMenuOpen(true)}>☰</button><span className="wb-breadcrumb">CITY OS <span>/</span> {activeTop === 'lab' ? '深圳实验区' : nav.find(([id]) => id === activeTop)?.[1] || '研究页面'}</span></div><div className="wb-top-actions"><Badge tone="warning">公开只读</Badge><button type="button" className="wb-icon-button" aria-label="切换主题" title="切换主题" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/></button><Link className="wb-icon-button" to="/about/project" aria-label="关于项目" title="关于项目"><Icon name="info"/></Link><Link className="wb-icon-button" to="/settings" aria-label="设置" title="设置"><Icon name="settings"/></Link></div></header><div className="wb-content-shell"><main id="main" className="wb-main" tabIndex="-1"><Routes><Route path="/" element={<Navigate to="/overview" replace/>}/><Route path="/overview" element={<Overview snapshot={snapshot} selected={selected} setSelected={setSelected} showMarkers={showMarkers} setShowMarkers={setShowMarkers}/>}/><Route path="/cities" element={<CitiesPage/>}/><Route path="/cities/:cityId" element={<CityPage/>}/><Route path="/events" element={<EventsPage/>}/><Route path="/events/:eventId" element={<EventPage/>}/><Route path="/models" element={<ModelsPage/>}/><Route path="/sources" element={<SourcesPage onSelect={setSelected}/>}/><Route path="/review" element={<ReviewPage/>}/><Route path="/lab/shenzhen" element={<LabPage/>}/><Route path="/lab/shenzhen/:moduleId" element={<LabPage/>}/><Route path="/about" element={<Navigate to="/about/project" replace/>}/><Route path="/about/:section" element={<AboutPage/>}/><Route path="/settings" element={<SettingsPage theme={theme} setTheme={setTheme}/>}/><Route path="*" element={<NotFound/>}/></Routes></main><Inspector selected={selected} snapshot={snapshot}/></div><footer className="wb-statusbar"><span><span className="wb-pulse"/> 数据状态：{snapshot.state === 'ok' ? snapshot.data?.stored_record_count ? '收到未核验记录' : '未连接实测记录' : snapshot.state === 'loading' ? '检查本地接口' : '静态目录 / 实时不可用'}</span><span>五城研究 · Asia/Shanghai</span><span>本站不提供预警或调度</span></footer></div></div>
}

export default function WorkbenchApp() { return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}><Shell/></BrowserRouter> }
