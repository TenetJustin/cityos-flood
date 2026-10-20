import { useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import { cityDemoData } from './zhejiangDemoData.js'

const LEVEL = { watch: '#6b9b8f', warning: '#d19a58', severe: '#b46f78' }
const fmt = (value) => Number(value || 0).toLocaleString('zh-CN')

function DemoTimeline({ rows, selectedHour, onSelect }) {
  const width = 720, height = 150, pad = 24
  const points = rows.map((row, index) => ({
    ...row,
    x: pad + (rows.length < 2 ? 0 : index * (width - pad * 2) / (rows.length - 1)),
    y: height - pad - row.water_index * (height - pad * 2),
  }))
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  return <div className="z-demo-chart-wrap">
    <svg className="z-demo-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="演示情景积水压力指数随时间变化">
      {[0.25, 0.5, 0.75].map((value) => <line key={value} x1={pad} x2={width - pad} y1={height - pad - value * (height - pad * 2)} y2={height - pad - value * (height - pad * 2)} className="z-demo-gridline"/>)}
      <path d={path} className="z-demo-line"/>
      {points.map((point) => <g key={point.id} role="button" tabIndex="0" aria-label={`${point.hour}小时，降雨${point.rainfall_mm}毫米`} onClick={() => onSelect(point.hour)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(point.hour) }}>
        <circle cx={point.x} cy={point.y} r={point.hour === selectedHour ? 7 : 5} fill={LEVEL[point.severity]}/>
        <text x={point.x} y={height - 5} textAnchor="middle">+{point.hour}h</text>
      </g>)}
    </svg>
    <div className="z-demo-chart-legend"><span><i/>规则合成积水压力指数</span><span>降雨为演示输入，不是实况</span></div>
  </div>
}

export default function DemoEventPanel({ city, dataset }) {
  const data = cityDemoData(dataset, city.id)
  const [selectedHour, setSelectedHour] = useState(0)
  if (!data?.city) return <section className="zo-card z-demo-panel"><strong>演示数据集暂不可用</strong><p>演示文件未通过结构校验；真实来源状态未受影响。</p></section>
  const selected = data.timeline.find((row) => row.hour === selectedHour) || data.timeline[0]
  const currentPoints = data.points.filter((point) => point.onset_hour <= (selected?.hour ?? 0))
  const residents = data.residentImpacts.reduce((sum, row) => ({
    exposed: sum.exposed + row.population_exposed,
    assist: sum.assist + row.assisted,
    shelter: sum.shelter + row.shelter_demand,
    self: sum.self + row.self_evacuate,
  }), { exposed: 0, assist: 0, shelter: 0, self: 0 })
  return <section className="zo-card z-demo-panel" aria-label={`${city.name}演示模拟态势`}>
    <div className="zo-section-title"><div><small>DEMO DATA / 模拟数据演示</small><h2>{city.name} · {dataset.scenario.name}</h2></div><span className="z-demo-stamp">{dataset.label}</span></div>
    <p className="z-demo-notice">此处所有点位坐标、雨量、水深、人数、居民行为比例及响应建议均由规则合成，仅用于演示界面和流程；不是实况、历史记录、真实居民反应或部门行动。</p>
    <div className="z-demo-controls"><label>情景时间 <strong>+{selected?.hour ?? 0} 小时</strong><input aria-label="选择演示情景时间" type="range" min="0" max="6" step="2" value={selectedHour} onChange={(event) => setSelectedHour(Number(event.target.value))}/></label><span>累计演示雨量 <strong>{selected?.rainfall_mm ?? 0} mm</strong></span><span>影响等级 <strong style={{ color: LEVEL[selected?.severity] }}>{data.city.status_label}</strong></span></div>
    <div className="z-demo-map" aria-label="模拟点位地图"><MapContainer center={[city.center[0], city.center[1]]} zoom={10} scrollWheelZoom zoomControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>
      {currentPoints.map((point) => <CircleMarker key={point.id} center={[point.coordinates[1], point.coordinates[0]]} radius={Math.max(7, Math.min(14, point.depth_cm / 5))} pathOptions={{ color: '#fff', weight: 2, fillColor: LEVEL[point.severity], fillOpacity: .88 }}><Tooltip>{point.label} · 合成片区 {point.area.slice(-1)} · 情景水深 {point.depth_cm} cm</Tooltip></CircleMarker>)}
    </MapContainer><span className="z-demo-map-badge">合成点位 · 非真实易涝点</span>{!currentPoints.length && <span className="z-demo-map-empty">该时刻尚未生成情景点位</span>}</div>
    <div className="z-demo-lower"><div><h3>情景时间序列</h3><DemoTimeline rows={data.timeline} selectedHour={selectedHour} onSelect={setSelectedHour}/></div><div className="z-demo-impact"><h3>居民影响估算 <small>规则假设 · 聚合值</small></h3><div><span>假设暴露人口</span><strong>{fmt(residents.exposed)}</strong></div><div><span>自主转移假设</span><strong>{fmt(residents.self)}</strong></div><div><span>协助需求假设</span><strong>{fmt(residents.assist)}</strong></div><div><span>避难需求假设</span><strong>{fmt(residents.shelter)}</strong></div><p>不是居民实际行为统计；不推断个人位置或行动路线。</p></div></div>
    <div className="z-demo-actions"><h3>建议性响应清单 <small>仅为系统演示建议，不表示部门已行动</small></h3><div className="z-demo-action-list">{data.departmentResponses.filter((row) => row.hour <= (selected?.hour ?? 0)).map((row) => <article key={row.id}><time>+{row.hour}h</time><strong>{row.action}</strong><span>{row.area} · 待人工复核</span></article>)}</div>{!data.departmentResponses.some((row) => row.hour <= (selected?.hour ?? 0)) && <p>该时间点暂无建议项；可拖动时间轴查看后续情景建议。</p>}</div>
  </section>
}
