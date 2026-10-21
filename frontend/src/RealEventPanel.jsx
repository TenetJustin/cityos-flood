import { useEffect } from 'react'
import { useMap, CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import { currentCityEvidence } from './realEventEvidence.js'

const displayTime = (value) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value))
const floodLabels = { waterlogged: '积水报告', receding: '水位回落记录', cleared: '积水清除记录' }
const residentLabels = { affected: '受影响', transferred: '已转移', sheltered: '已安置', stranded: '受困报告' }
const responseLabels = { announced: '已发布', in_progress: '进行中', completed: '已完成', cancelled: '已撤销' }

function MoveToPoint({ point }) {
  const map = useMap()
  useEffect(() => {
    if (!point) return
    const [lon, lat] = point.coordinates
    const current = map.getCenter()
    if (Math.abs(current.lat - lat) > .0001 || Math.abs(current.lng - lon) > .0001) map.setView([lat, lon], 12)
  }, [map, point])
  return null
}

function SourceLine({ row }) {
  return <small className="zo-event-source">{displayTime(row.observed_at)}</small>
}

export default function RealEventPanel({ city, snapshot, state, now }) {
  const { floodPoints, residentImpacts, departmentResponses } = currentCityEvidence(snapshot, city.id, now)
  const point = floodPoints.find((row) => row.status !== 'cleared') || floodPoints[0]
  return <section className="zo-card zo-real-events" aria-label={`${city.name}真实事件记录`}>
    <div className="zo-section-title"><div><small>LIVE EVIDENCE / 近 24 小时记录</small><h2>内涝与实际响应</h2></div><span className="zo-event-snapshot">{state === 'ok' ? '已接入' : '待接入'}</span></div>
    <div className="zo-event-columns">
      <div className="zo-event-column"><h3>积水点位 <span>{floodPoints.length || '—'}</span></h3>
        {floodPoints.length ? floodPoints.map((row) => <article key={row.id}><strong>{row.place_name} · {floodLabels[row.status]}</strong><p>{row.water_depth_cm === null ? '积水深度未报' : `报告水深 ${row.water_depth_cm} cm`}</p><SourceLine row={row}/></article>) : <p className="zo-event-empty">暂无记录</p>}
      </div>
      <div className="zo-event-column"><h3>居民影响 <span>{residentImpacts.length || '—'}</span></h3>
        {residentImpacts.length ? residentImpacts.map((row) => <article key={row.id}><strong>{row.area_name} · {residentLabels[row.metric]} {row.count} 人</strong><p>区域汇总</p><SourceLine row={row}/></article>) : <p className="zo-event-empty">暂无记录</p>}
      </div>
      <div className="zo-event-column"><h3>部门响应 <span>{departmentResponses.length || '—'}</span></h3>
        {departmentResponses.length ? departmentResponses.map((row) => <article key={row.id}><strong>{row.action}</strong><p>{row.area_name} · {responseLabels[row.status]}</p><SourceLine row={row}/></article>) : <p className="zo-event-empty">暂无记录</p>}
      </div>
    </div>
    {point && <div className="zo-real-point-map" aria-label="实际积水点地图"><MapContainer center={[point.coordinates[1], point.coordinates[0]]} zoom={12} scrollWheelZoom zoomControl>
      <MoveToPoint point={point}/><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>
      {floodPoints.map((row) => <CircleMarker key={row.id} center={[row.coordinates[1], row.coordinates[0]]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: row.status === 'cleared' ? '#6b9b8f' : row.status === 'receding' ? '#b98958' : '#b46f78', fillOpacity: .95 }}><Tooltip>{row.place_name} · {floodLabels[row.status]} · {row.water_depth_cm === null ? '深度未报' : `${row.water_depth_cm} cm`} · {displayTime(row.observed_at)}</Tooltip></CircleMarker>)}
    </MapContainer></div>}
  </section>
}
