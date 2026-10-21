import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet'
import { demoPointAdvice, demoRankedPoints, demoRainfallGridAtHour, demoResidentAtHour, demoTimeLabel } from './zhejiangDemoData.js'
import { demoActionForPoint } from './demoFloodModel.js'

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
    <svg className="z-demo-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="四城逐小时归一化最高节点水深，虚线为六小时建议汇集点">
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
  const [layers, setLayers] = useState({ rain: true, flood: true, track: true })
  const duration = dataset?.scenario?.duration_hours ?? 72
  const selectedHour = Math.min(duration, Math.max(0, externalHour ?? internalHour))
  const setSelectedHour = onHourChange || setInternalHour
  const cityIds = city ? [city.id] : CITY_META.map((item) => item.id)
  const rows = dataset?.timeline?.filter((row) => cityIds.includes(row.city_id)) || []
  const track = dataset?.storm_track || []
  const selectedTrack = track.filter((point) => point.hour <= selectedHour)
  const currentTrack = track.find((point) => point.hour === selectedHour)
  const currentRows = dataset ? readCurrentCityRows(dataset, cityIds, selectedHour) : []
  const residentTotals = cityIds.reduce((sum, cityId) => {
    const current = demoResidentAtHour(dataset, cityId, selectedHour)
    return Object.fromEntries(Object.keys(sum).map((key) => [key, sum[key] + current[key]]))
  }, { exposed: 0, stay: 0, self: 0, assist: 0, shelter: 0 })
  const currentPoints = demoRankedPoints(dataset, cityIds, selectedHour)
  const rainfallCells = demoRainfallGridAtHour(dataset, cityIds, selectedHour)
  const activePoints = currentPoints.filter((point) => point.current_depth_cm >= 8)
  const currentCycle = Math.floor(selectedHour / 6) * 6
  const currentRecommendations = cityIds.map((cityId) => dataset?.department_responses?.filter((row) => row.city_id === cityId && row.hour <= currentCycle).at(-1)).filter(Boolean)
  const mostSevere = currentRows.reduce((best, row) => !best || ({ watch: 1, warning: 2, severe: 3 })[row.severity] > ({ watch: 1, warning: 2, severe: 3 })[best.severity] ? row : best, null)
  const selectedRain = city
    ? currentRows[0]?.rainfall_rate_mm_h || 0
    : Math.max(0, ...currentRows.map((row) => row.rainfall_rate_mm_h))
  const exposedTotal = Math.max(1, residentTotals.exposed)
  const residentMix = [
    { id: 'stay', label: '情景留置', value: residentTotals.stay },
    { id: 'self', label: '自主避险', value: residentTotals.self },
    { id: 'assist', label: '需要协助', value: residentTotals.assist },
  ]
  const deepestPoint = activePoints[0] || currentPoints[0]
  const priorityCounts = {
    p1: activePoints.filter((point) => point.priority_tier === 'P1').length,
    p2: activePoints.filter((point) => point.priority_tier === 'P2').length,
    p3: activePoints.filter((point) => point.priority_tier === 'P3').length,
    deep: activePoints.filter((point) => point.current_depth_cm >= 60).length,
  }
  const rainPeak = Math.max(0, ...rainfallCells.map((cell) => cell.rainfall_rate_mm_h))
  const capacity = cityIds.reduce((total, id) => {
    const plan = dataset?.hydraulics?.resource_plans?.[id]?.[selectedHour]
    return { available: total.available + (plan?.available_teams || 0), assigned: total.assigned + (plan?.assigned_teams || 0), unmet: total.unmet + (plan?.unmet_teams || 0) }
  }, { available: 0, assigned: 0, unmet: 0 })
  const setLayer = (name) => setLayers((current) => ({ ...current, [name]: !current[name] }))

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
    <p className="z-demo-notice">登陆前24小时至登陆后48小时，共73个逐小时状态；每6小时汇集建议。{dataset.model?.engine === 'epa_swmm' ? 'EPA SWMM 5.2.4 计算合成微区节点蓄水；居民影响为规则估算。' : '透明规则筛查演示。'} 非真实观测或台风预报。</p>
    <div className="z-demo-feed" aria-label="模拟数据流与分析链路"><strong><i/>模拟数据流 · 已载入</strong><span>雨量格点 + 潮位/河网 + 台风路径</span><b>→</b><span>点位筛查</span><b>→</b><span>影响分布</span><b>→</b><span>资源建议</span><small>本次情景驱动更新 {demoTimeLabel(currentCycle, dataset.scenario.landfall_hour)} · 每6小时 · 非真实源到达</small></div>
    <div className="z-demo-controls">
      <label>情景时刻 <strong>{demoTimeLabel(selectedHour, dataset.scenario.landfall_hour)}</strong><input aria-label="选择模拟台风逐小时时刻" type="range" min="0" max={duration} step="1" value={selectedHour} onChange={(event) => { setSelectedHour(Number(event.target.value)); setPlaying(false) }}/><button type="button" className="z-demo-play" onClick={() => { if (!playing && selectedHour >= duration) setSelectedHour(0); setPlaying((value) => !value) }} aria-pressed={playing}>{playing ? '暂停' : '▶ 逐小时播放'}</button></label>
      <span>{city ? '小时雨强' : '四城最高小时雨强'} <strong>{selectedRain.toFixed(1)} mm/h</strong></span>
      <span>当前影响 <strong style={{ color: LEVEL[mostSevere?.severity] }}>{SEVERITY_LABEL[mostSevere?.severity] || '待计算'}</strong></span>
      <span>演示点位 <strong>{activePoints.length}/{currentPoints.length}</strong></span>
    </div>
    {!city && <div className="z-demo-city-strip">{currentRows.map((row) => <span key={row.cityId}><i style={{ background: LEVEL[row.severity] }}/>{CITY_META.find((item) => item.id === row.cityId)?.name} · {SEVERITY_LABEL[row.severity]}</span>)}</div>}
    <section className="z-demo-command" aria-label="值守调度速览">
      <div className="z-demo-command-head"><div><small>SHIFT BRIEF / 值守决策速览</small><h3>先核验哪里、准备什么力量</h3></div><span>演示情景排序 · 待现场复核</span></div>
      <div className="z-demo-command-metrics">
        <div className={`priority ${priorityCounts.p1 ? 'hot' : priorityCounts.p2 ? 'watch' : ''}`}><span>最高优先级点位</span><strong>{priorityCounts.p1 ? `${priorityCounts.p1} 个 P1` : priorityCounts.p2 ? `${priorityCounts.p2} 个 P2` : '暂无触发'}</strong></div>
        <div><span>≥60 cm 点位</span><strong>{priorityCounts.deep}</strong></div>
        <div><span>当前受影响微区</span><strong>{activePoints.length} / {currentPoints.length}</strong></div>
        <div><span>演示情景暴露人数</span><strong>{fmt(residentTotals.exposed)}</strong></div>
        <div><span>格点最高小时雨强</span><strong>{rainPeak.toFixed(1)} mm/h</strong></div>
      </div>
      <div className="z-demo-priority-layout">
        <div className="z-demo-priority-list"><h4>优先复核点位 <small>按水深、道路重要性、情景暴露与相对低洼度排序</small></h4>
          {currentPoints.slice(0, 5).map((point) => <article key={point.id}>
            <b className={`z-priority-badge ${point.priority_tier.toLowerCase()}`}>{point.priority_tier}</b>
            <div><strong>{CITY_META.find((item) => item.id === point.city_id)?.name} · {point.label}</strong><span>{point.area} · {point.current_depth_cm} cm · 排序分 {point.priority_score}</span></div>
            <p>{demoPointAdvice(point, point.current_depth_cm)}</p>
          </article>)}
        </div>
        <div className="z-demo-resource-brief"><h4>资源准备建议 <small>不代表已调度</small></h4>
          {dataset.hydraulics && <p>情景队伍：可用 <b>{capacity.available}</b> 支，候选分配 <b>{capacity.assigned}</b> 支，需求缺口 <b>{capacity.unmet}</b> 支。<br/>按优先级与容量约束优化，具体点位可在下方二维视图检查。</p>}
          {deepestPoint ? <><strong>{demoActionForPoint(deepestPoint, deepestPoint.current_depth_cm).action}</strong><div>{demoActionForPoint(deepestPoint, deepestPoint.current_depth_cm).resource_types.map((item) => <span key={item}>{item}</span>)}</div></> : <p>暂无点位结果；先确认降雨、水位和演示数据链路，不把缺失理解为安全。</p>}
          <small>居民数字为微区聚合情景估算，不是居民实际行为；措施须由值班人员结合现场和属地预案批准。</small>
        </div>
      </div>
    </section>
    <div className="z-demo-layer-toolbar" aria-label="地图图层开关"><span>地图图层</span>{[['rain', '降雨格点'], ['flood', '内涝筛查点'], ['track', '台风路径']].map(([key, label]) => <button type="button" key={key} className={layers[key] ? 'active' : ''} aria-pressed={layers[key]} onClick={() => setLayer(key)}>{label}</button>)}</div>
    <div className="z-demo-map" role="region" aria-label={`${city?.name || '浙江四城'}台风路径与逐时积水点位`}><MapContainer center={center} zoom={zoom} scrollWheelZoom zoomControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>
      {layers.track && selectedTrack.length > 1 && <Polyline positions={selectedTrack.map((point) => [point.coordinates[1], point.coordinates[0]])} pathOptions={{ color: '#4f8fd6', weight: 3, dashArray: '8 6', opacity: .8 }}><Tooltip sticky>模拟台风路径 · 规则合成，非预报</Tooltip></Polyline>}
      {layers.track && currentTrack && <CircleMarker center={[currentTrack.coordinates[1], currentTrack.coordinates[0]]} radius={11} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2c70b8', fillOpacity: .96 }}><Tooltip direction="top" permanent>模拟台风中心 · {demoTimeLabel(selectedHour, dataset.scenario.landfall_hour)} · 非预报</Tooltip></CircleMarker>}
      {layers.rain && rainfallCells.map((cell) => <CircleMarker key={cell.id} center={[cell.coordinates[1], cell.coordinates[0]]} radius={Math.max(4, Math.min(10, 4 + cell.rainfall_rate_mm_h / 9))} pathOptions={{ color: '#fff', weight: 1, fillColor: '#347ccb', fillOpacity: Math.max(.16, Math.min(.7, .16 + cell.rainfall_rate_mm_h / 55)) }}><Tooltip>{CITY_META.find((item) => item.id === cell.city_id)?.name} · 格点雨强 {cell.rainfall_rate_mm_h.toFixed(1)} mm/h</Tooltip></CircleMarker>)}
      {layers.flood && currentPoints.map((point, index) => {
        const active = point.current_depth_cm >= 8
        const color = point.current_depth_cm >= 60 ? LEVEL.severe : point.current_depth_cm >= 30 ? LEVEL.warning : active ? LEVEL.watch : '#96a6b9'
        return <CircleMarker key={point.id} center={[point.coordinates[1], point.coordinates[0]]} radius={active ? Math.max(6, Math.min(14, point.current_depth_cm / 5)) : 4} pathOptions={{ color: point.priority_tier === 'P1' ? '#8b3746' : '#fff', weight: point.priority_tier === 'P1' ? 3 : 1.5, fillColor: color, fillOpacity: active ? .92 : .3 }}><Tooltip direction="top" offset={[0, -8]} permanent={Boolean(city && index < 3 && active)}>{CITY_META.find((item) => item.id === point.city_id)?.name} · {point.label} · {point.current_depth_cm} cm · {point.priority_tier}</Tooltip></CircleMarker>
      })}
    </MapContainer><span className="z-demo-map-badge">降雨格点 + 逐小时筛查点 · {demoTimeLabel(selectedHour, dataset.scenario.landfall_hour)}</span><span className="z-demo-map-foot">位置为演示微区；水深为当前演示模型输出，不是实测街道积水</span></div>
    <div className="z-demo-lower"><div><h3>四城风险演变 <small>归一化最高水深 · 非概率</small></h3><DemoTimeline rows={rows} cityIds={cityIds} duration={duration} selectedHour={selectedHour} onSelect={(hour) => { setSelectedHour(hour); setPlaying(false) }}/></div><div className="z-demo-impact"><h3>居民影响情景 <small>规则估算，不代表实际行为</small></h3><div><span>情景暴露人数</span><strong>{fmt(residentTotals.exposed)}</strong></div><div><span>情景留置人数</span><strong>{fmt(residentTotals.stay)}</strong></div><div><span>自主转移参考量</span><strong>{fmt(residentTotals.self)}</strong></div><div><span>协助 / 避难需求参考量</span><strong>{fmt(residentTotals.assist)} / {fmt(residentTotals.shelter)}</strong></div><div className="z-demo-resident-viz"><span>情景人群分配构成 · 不是实测行为</span><div className="z-demo-resident-bar" role="img" aria-label={`情景暴露 ${fmt(residentTotals.exposed)} 人：留置 ${fmt(residentTotals.stay)}，自主避险 ${fmt(residentTotals.self)}，需要协助 ${fmt(residentTotals.assist)}`}>{residentMix.map((item) => <i key={item.id} className={item.id} style={{ width: `${item.value / exposedTotal * 100}%` }}/>)}</div><div className="z-demo-resident-key">{residentMix.map((item) => <span key={item.id}><i className={item.id}/>{item.label} {Math.round(item.value / exposedTotal * 100)}%</span>)}</div></div></div></div>
    <div className="z-demo-actions"><h3>部门响应建议 <small>预案候选 · 待人工复核 · 非实际行动</small></h3><div className="z-demo-action-list">{currentRecommendations.map((row) => <article key={row.id}><time>{CITY_META.find((item) => item.id === row.city_id)?.name}<br/>{demoTimeLabel(row.hour, dataset.scenario.landfall_hour)}</time><strong>{row.action}</strong><span>{row.area} · 建议生成，不代表部门已执行</span></article>)}</div></div>
  </section>
}
