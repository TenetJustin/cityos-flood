import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet'
import { demoPointDepth, demoResidentAtHour, demoTimeLabel } from './zhejiangDemoData.js'

const CITY_META = [
  { id: 'ningbo', name: '宁波', color: '#4f8fd6' },
  { id: 'taizhou', name: '台州', color: '#d19a58' },
  { id: 'wenzhou', name: '温州', color: '#b46f78' },
  { id: 'hangzhou', name: '杭州', color: '#6b9b8f' },
]
const LEVEL = { watch: '#6b9b8f', warning: '#d19a58', severe: '#b46f78' }
const SEVERITY_LABEL = { watch: '常态监测', warning: '重点关注', severe: '高影响情景' }
const fmt = (value) => Number(value || 0).toLocaleString('zh-CN')

function DemoTimeline({ rows, cityIds, duration, selectedHour, onSelect }) {
  const width = 760, height = 180, pad = 28
  const xAt = (hour) => pad + hour * (width - pad * 2) / duration
  const yAt = (value) => height - pad - value * (height - pad * 2)
  const series = cityIds.map((cityId) => {
    const meta = CITY_META.find((item) => item.id === cityId)
    const points = rows.filter((row) => row.city_id === cityId).sort((left, right) => left.hour - right.hour)
    return { ...meta, points, path: points.map((point, index) => `${index ? 'L' : 'M'} ${xAt(point.hour)} ${yAt(point.water_index)}`).join(' ') }
  })
  return <div className="z-demo-chart-wrap">
    <svg className="z-demo-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="四城逐小时情景积水压力指数，虚线表示每六小时一次的情景更新周期">
      {[0.25, 0.5, 0.75].map((value) => <line key={value} x1={pad} x2={width - pad} y1={yAt(value)} y2={yAt(value)} className="z-demo-gridline"/>)}
      {Array.from({ length: Math.floor(duration / 6) + 1 }, (_, index) => index * 6).map((hour) => <line key={hour} x1={xAt(hour)} x2={xAt(hour)} y1={pad - 3} y2={height - pad} className="z-demo-cycleline"/>)}
      {series.map((item) => <path key={item.id} d={item.path} className="z-demo-series-line" style={{ stroke: item.color }}/>) }
      {Array.from({ length: duration + 1 }, (_, hour) => <rect key={`select-${hour}`} x={xAt(hour) - 4} y={pad} width="8" height={height - pad * 2} fill="transparent" aria-hidden="true" onClick={() => onSelect(hour)}/>) }
      <line x1={xAt(selectedHour)} x2={xAt(selectedHour)} y1={pad - 5} y2={height - pad} className="z-demo-cursor"/>
      {series.map((item) => {
        const point = item.points.find((row) => row.hour === selectedHour)
        return point ? <circle key={item.id} cx={xAt(selectedHour)} cy={yAt(point.water_index)} r="5" fill={item.color} className="z-demo-current-dot"/> : null
      })}
      {[0, 12, 24, 36, 48, 60, 72].filter((hour) => hour <= duration).map((hour) => <text key={hour} x={xAt(hour)} y={height - 5} textAnchor="middle">{demoTimeLabel(hour)}</text>)}
    </svg>
    <div className="z-demo-chart-legend">{series.map((item) => <span key={item.id}><i style={{ background: item.color }}/>{item.name}</span>)}<span><i className="z-demo-cycle-key"/>6小时更新点</span></div>
    <div className="z-demo-chart-hint">拖动上方时间轴可按小时查看；圆点标出本次选择的时刻。</div>
  </div>
}

function readCurrentCityRows(dataset, cityIds, hour) {
  return cityIds.map((cityId) => ({ cityId, ...dataset.timeline.find((row) => row.city_id === cityId && row.hour === hour) })).filter((row) => row.id)
}

export default function DemoEventPanel({ city, dataset, selectedHour: externalHour, onHourChange }) {
  const [internalHour, setInternalHour] = useState(dataset?.scenario?.default_hour ?? 48)
  const [playing, setPlaying] = useState(false)
  const duration = dataset?.scenario?.duration_hours ?? 72
  const selectedHour = Math.min(duration, Math.max(0, externalHour ?? internalHour))
  const setSelectedHour = onHourChange || setInternalHour
  const cityIds = city ? [city.id] : CITY_META.map((item) => item.id)
  const rows = dataset?.timeline?.filter((row) => cityIds.includes(row.city_id)) || []
  const points = dataset?.points?.filter((point) => cityIds.includes(point.city_id)) || []
  const track = dataset?.storm_track || []
  const selectedTrack = track.filter((point) => point.hour <= selectedHour)
  const currentTrack = track.find((point) => point.hour === selectedHour)
  const currentRows = dataset ? readCurrentCityRows(dataset, cityIds, selectedHour) : []
  const residentTotals = cityIds.reduce((sum, cityId) => {
    const current = demoResidentAtHour(dataset, cityId, selectedHour)
    return Object.fromEntries(Object.keys(sum).map((key) => [key, sum[key] + current[key]]))
  }, { exposed: 0, stay: 0, self: 0, assist: 0, shelter: 0 })
  const currentPoints = points.map((point) => ({ ...point, current_depth_cm: demoPointDepth(point, selectedHour, dataset) }))
  const activePoints = currentPoints.filter((point) => point.current_depth_cm >= 8)
  const currentCycle = Math.floor(selectedHour / 6) * 6
  const currentRecommendations = cityIds.map((cityId) => dataset?.department_responses?.filter((row) => row.city_id === cityId && row.hour <= currentCycle).at(-1)).filter(Boolean)
  const mostSevere = currentRows.reduce((best, row) => !best || ({ watch: 1, warning: 2, severe: 3 })[row.severity] > ({ watch: 1, warning: 2, severe: 3 })[best.severity] ? row : best, null)
  const selectedRain = city
    ? currentRows[0]?.rainfall_rate_mm_h || 0
    : Math.max(0, ...currentRows.map((row) => row.rainfall_rate_mm_h))

  useEffect(() => {
    if (!playing) return undefined
    if (selectedHour >= duration) { setPlaying(false); return undefined }
    const timer = setTimeout(() => setSelectedHour(selectedHour + 1), 700)
    return () => clearTimeout(timer)
  }, [playing, selectedHour, duration, setSelectedHour])

  if (!dataset?.timeline?.length) return <section className="zo-card z-demo-panel"><strong>模拟演示集暂不可用</strong><p>演示文件未通过结构校验；真实来源状态未受影响。</p></section>
  const center = city ? city.center : [29.05, 121.25]
  const zoom = city ? 10 : 7
  return <section className="zo-card z-demo-panel" aria-label={`${city?.name || '浙江四城'}模拟台风逐时态势`}>
    <div className="zo-section-title"><div><small>72-HOUR EVENT MODEL / 逐小时风险演变</small><h2>{city ? `${city.name} · ${dataset.scenario.name}` : `浙江四城 · ${dataset.scenario.name}`}</h2></div><span className="z-demo-stamp">模拟情景 · 非实时</span></div>
    <p className="z-demo-notice">北京时间（Asia/Shanghai）口径，以模拟登陆时刻为 T0：登陆前24小时至登陆后48小时，共73个逐小时状态。每6小时形成一次情景更新；小时之间为规则演算展示，不代表获得了新的真实观测或预报。</p>
    <div className="z-demo-controls">
      <label>情景时刻 <strong>{demoTimeLabel(selectedHour, dataset.scenario.landfall_hour)}</strong><input aria-label="选择模拟台风逐小时时刻" type="range" min="0" max={duration} step="1" value={selectedHour} onChange={(event) => { setSelectedHour(Number(event.target.value)); setPlaying(false) }}/><button type="button" className="z-demo-play" onClick={() => { if (!playing && selectedHour >= duration) setSelectedHour(0); setPlaying((value) => !value) }} aria-pressed={playing}>{playing ? '暂停' : '▶ 逐小时播放'}</button></label>
      <span>{city ? '小时雨强' : '四城最高小时雨强'} <strong>{selectedRain.toFixed(1)} mm/h</strong></span>
      <span>当前影响 <strong style={{ color: LEVEL[mostSevere?.severity] }}>{SEVERITY_LABEL[mostSevere?.severity] || '待计算'}</strong></span>
      <span>演示点位 <strong>{activePoints.length}/{points.length}</strong></span>
    </div>
    {!city && <div className="z-demo-city-strip">{currentRows.map((row) => <span key={row.cityId}><i style={{ background: LEVEL[row.severity] }}/>{CITY_META.find((item) => item.id === row.cityId)?.name} · {SEVERITY_LABEL[row.severity]}</span>)}</div>}
    <div className="z-demo-map" role="region" aria-label={`${city?.name || '浙江四城'}台风路径与逐时积水点位`}><MapContainer center={center} zoom={zoom} scrollWheelZoom zoomControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>
      {selectedTrack.length > 1 && <Polyline positions={selectedTrack.map((point) => [point.coordinates[1], point.coordinates[0]])} pathOptions={{ color: '#4f8fd6', weight: 3, dashArray: '8 6', opacity: .8 }}><Tooltip sticky>模拟台风路径 · 规则合成，非预报</Tooltip></Polyline>}
      {currentTrack && <CircleMarker center={[currentTrack.coordinates[1], currentTrack.coordinates[0]]} radius={11} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2c70b8', fillOpacity: .96 }}><Tooltip direction="top" permanent>模拟台风中心 · {demoTimeLabel(selectedHour, dataset.scenario.landfall_hour)} · 非预报</Tooltip></CircleMarker>}
      {currentPoints.map((point) => {
        const active = point.current_depth_cm >= 8
        const color = point.current_depth_cm >= 60 ? LEVEL.severe : point.current_depth_cm >= 30 ? LEVEL.warning : active ? LEVEL.watch : '#96a6b9'
        return <CircleMarker key={point.id} center={[point.coordinates[1], point.coordinates[0]]} radius={active ? Math.max(8, Math.min(17, point.current_depth_cm / 4.5)) : 6} pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: active ? .92 : .38 }}><Tooltip direction="top" offset={[0, -8]} permanent={Boolean(city)}>演示点位 {point.label} · {point.current_depth_cm} cm</Tooltip></CircleMarker>
      })}
    </MapContainer><span className="z-demo-map-badge">台风路径 + 逐时积水点位 · {demoTimeLabel(selectedHour, dataset.scenario.landfall_hour)}</span><span className="z-demo-map-foot">坐标为演示微区，不对应已核实街道或真实易涝点</span></div>
    <div className="z-demo-lower"><div><h3>四城风险演变 <small>积水压力指数 · 规则演算</small></h3><DemoTimeline rows={rows} cityIds={cityIds} duration={duration} selectedHour={selectedHour} onSelect={(hour) => { setSelectedHour(hour); setPlaying(false) }}/></div><div className="z-demo-impact"><h3>居民影响情景 <small>规则估算，不代表实际行为</small></h3><div><span>情景暴露人数</span><strong>{fmt(residentTotals.exposed)}</strong></div><div><span>情景留置人数</span><strong>{fmt(residentTotals.stay)}</strong></div><div><span>自主转移参考量</span><strong>{fmt(residentTotals.self)}</strong></div><div><span>协助 / 避难需求参考量</span><strong>{fmt(residentTotals.assist)} / {fmt(residentTotals.shelter)}</strong></div></div></div>
    <div className="z-demo-actions"><h3>部门响应建议 <small>预案候选 · 待人工复核 · 非实际行动</small></h3><div className="z-demo-action-list">{currentRecommendations.map((row) => <article key={row.id}><time>{CITY_META.find((item) => item.id === row.city_id)?.name}<br/>{demoTimeLabel(row.hour, dataset.scenario.landfall_hour)}</time><strong>{row.action}</strong><span>{row.area} · 建议生成，不代表部门已执行</span></article>)}</div></div>
  </section>
}
