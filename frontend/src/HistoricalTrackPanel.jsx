import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { ZHEJIANG_CITIES } from './zhejiangData.js'
import { assessTrackSnapshot, nearbyTracks, trackSegments } from './historicalTracks.js'
import './historicalTrackPanel.css'

const date = (value) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '—'
const keyOf = (track) => `${track.sid}:${track.track_type}`
const distanceFor = (track, city) => city ? track.city_min_km[city.id] : Math.min(...Object.values(track.city_min_km))

function TrackViewport({ track }) {
  const map = useMap()
  useEffect(() => {
    if (track?.points?.length) map.fitBounds(track.points.map((point) => [point.lat, point.lon]), { padding: [32, 32], maxZoom: 7 })
  }, [map, track])
  return null
}

export default function HistoricalTrackPanel({ city }) {
  const [snapshot, setSnapshot] = useState(null)
  const [state, setState] = useState('loading')
  const [issue, setIssue] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    let active = true
    fetch(`${import.meta.env.BASE_URL}data/zhejiang-track-candidates.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => {
        if (!active) return
        const quality = assessTrackSnapshot(data)
        if (!quality.valid) throw new Error(`轨迹索引未通过校验：${quality.issues.join('、')}`)
        setSnapshot(data); setState('ok')
      })
      .catch((error) => { if (active) { setState('unavailable'); setIssue(error.message) } })
    return () => { active = false }
  }, [])
  const matches = nearbyTracks(snapshot, city?.id)
  const selected = matches.find((track) => keyOf(track) === selectedKey) || matches[0]
  const displayed = showAll ? matches : matches.slice(0, 7)
  return <section className="zo-card zh-track-panel"><div className="zh-track-heading"><div><small>HISTORICAL / 最佳路径</small><h2>浙江邻近台风轨迹候选</h2></div><span>历史记录 · 非预报</span></div>
    <p>NOAA IBTrACS 最近三年归档；按轨迹中心距{city ? city.name : '任一研究城市'}中心不超过 500 km 筛选。接近不等于发生降雨或内涝；最近年份可能是临时路径。</p>
    {state === 'loading' && <div className="zh-track-empty">轨迹索引读取中…</div>}
    {state === 'unavailable' && <div className="zh-track-empty">轨迹索引不可用。{issue}</div>}
    {state === 'ok' && <><div className="zh-track-meta"><span>{matches.length} 条候选路径</span><span>来源更新时间 {snapshot.source_last_modified ? date(snapshot.source_last_modified) : '未提供'}</span><span>抓取 {date(snapshot.retrieved_at)}</span><a href={snapshot.source.documentation_url} target="_blank" rel="noreferrer">NOAA 来源 ↗</a></div>
      <div className="zh-track-layout"><div className="zh-track-list" aria-label="历史路径候选列表">{displayed.map((track) => <button type="button" key={keyOf(track)} aria-pressed={selected && keyOf(selected) === keyOf(track)} className={selected && keyOf(selected) === keyOf(track) ? 'active' : ''} onClick={() => setSelectedKey(keyOf(track))}><span>{date(track.first_nearby_at)} · {track.track_type}</span><strong>{track.name === 'UNNAMED' ? '未命名' : track.name}</strong><small>SID {track.sid} · 最近 {distanceFor(track, city).toFixed(0)} km</small></button>)}{matches.length > 7 && <button type="button" className="zh-track-more" onClick={() => setShowAll((value) => !value)}>{showAll ? '收起列表' : `显示其余 ${matches.length - 7} 条`}</button>}{!matches.length && <div className="zh-track-empty">此城筛选范围内暂无路径；不表示没有降雨内涝事件。</div>}</div>
      <div className="zh-track-map-shell">{selected ? <><div className="zh-track-map" role="img" aria-label={`${selected.name} 历史最佳路径和浙江四城中心示意地图`}><MapContainer center={[29.3, 121]} zoom={6} scrollWheelZoom={false}><TrackViewport track={selected}/><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>{trackSegments(selected.points).map((segment, index) => segment.length > 1 ? <Polyline key={index} positions={segment} pathOptions={{ color: '#a9e8d2', weight: 3, opacity: .9 }}/> : null)}{ZHEJIANG_CITIES.map((item) => <CircleMarker key={item.id} center={item.center} radius={5} pathOptions={{ color: '#e4f3ee', weight: 1, fillColor: item.accent, fillOpacity: 1 }}><Tooltip>{item.name} · 城市中心示意</Tooltip></CircleMarker>)}</MapContainer></div><div className="zh-track-caption"><strong>{selected.name === 'UNNAMED' ? '未命名' : selected.name}</strong><span>{selected.points.length} 个邻近路径点 · {date(selected.first_nearby_at)} — {date(selected.last_nearby_at)}</span></div></> : <div className="zh-track-empty">请选择一条路径</div>}</div></div>
      <p className="zh-track-boundary">版本 {snapshot.source.name} · EPSG:4326 · UTC；单条路径当时实际可获得时间未知（available_at = null）。数据来源与引用见 <a href={snapshot.source.documentation_url} target="_blank" rel="noreferrer">NOAA NCEI</a>。这是事后最佳路径，不能作为当时可获得的预报或积水真值；是否影响城市须与降雨、水位和事件记录交叉核验。</p>
    </>}
  </section>
}
