import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { ZHEJIANG_CITIES } from './zhejiangData.js'
import { assessTrackSnapshot, tracksForYear, trackSegments } from './historicalTracks.js'
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

export default function HistoricalTrackPanel({ city, year }) {
  const [snapshot, setSnapshot] = useState(null)
  const [state, setState] = useState('loading')
  const [issue, setIssue] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [playIndex, setPlayIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
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
  const matches = tracksForYear(snapshot, city?.id, year)
  const selected = matches.find((track) => keyOf(track) === selectedKey) || matches[0]
  const activeIndex = selected ? Math.min(playIndex, selected.points.length - 1) : -1
  const activePoint = selected && activeIndex >= 0 ? selected.points[activeIndex] : null
  useEffect(() => { setPlayIndex(0); setPlaying(false) }, [selectedKey, year, city?.id])
  useEffect(() => {
    if (!playing || !selected) return undefined
    const timer = setInterval(() => setPlayIndex((index) => {
      return Math.min(index + 1, selected.points.length - 1)
    }), 650)
    return () => clearInterval(timer)
  }, [playing, selected])
  useEffect(() => {
    if (selected && playIndex >= selected.points.length - 1) setPlaying(false)
  }, [playIndex, selected])
  const displayed = showAll ? matches : matches.slice(0, 7)
  return <section className="zo-card zh-track-panel"><div className="zh-track-heading"><div><small>HISTORICAL / 动态路径回放</small><h2>{year ? `${year} 年` : ''}台风轨迹与四城位置</h2></div><span>历史记录 · 非预报</span></div>
    <p>按所选年份与城市筛选 NOAA IBTrACS 最近三年归档路径。若无匹配记录，显示缺失状态；路径接近不代表发生降雨或内涝。</p>
    {state === 'loading' && <div className="zh-track-empty">轨迹索引读取中…</div>}
    {state === 'unavailable' && <div className="zh-track-empty">轨迹索引不可用。{issue}</div>}
    {state === 'ok' && <><div className="zh-track-meta"><span>{matches.length} 条候选路径</span><span>来源更新时间 {snapshot.source_last_modified ? date(snapshot.source_last_modified) : '未提供'}</span><span>抓取 {date(snapshot.retrieved_at)}</span><a href={snapshot.source.documentation_url} target="_blank" rel="noreferrer">NOAA 来源 ↗</a></div>
      <div className="zh-track-layout"><div className="zh-track-list" aria-label="历史路径候选列表">{displayed.map((track) => <button type="button" key={keyOf(track)} aria-pressed={selected && keyOf(selected) === keyOf(track)} className={selected && keyOf(selected) === keyOf(track) ? 'active' : ''} onClick={() => setSelectedKey(keyOf(track))}><span>{date(track.first_nearby_at)} · {track.track_type}</span><strong>{track.name === 'UNNAMED' ? '未命名' : track.name}</strong><small>SID {track.sid} · 最近 {distanceFor(track, city).toFixed(0)} km</small></button>)}{matches.length > 7 && <button type="button" className="zh-track-more" onClick={() => setShowAll((value) => !value)}>{showAll ? '收起列表' : `显示其余 ${matches.length - 7} 条`}</button>}{!matches.length && <div className="zh-track-empty">{year ? `${year} 年轨迹不在当前“最近三年”快照中。` : '当前筛选范围内暂无路径。'}事件资料仍可查看；缺失不代表没有台风或内涝。</div>}</div>
      <div className="zh-track-map-shell"><div className="zh-track-map" aria-label={`${year || ''} 年台风历史轨迹地图`}><MapContainer center={city?.center || [29.3, 121]} zoom={city ? 7 : 6} scrollWheelZoom zoomControl><TrackViewport track={selected}/><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/>{selected && trackSegments(selected.points.slice(0, activeIndex + 1)).map((segment, index) => segment.length > 1 ? <Polyline key={index} positions={segment} pathOptions={{ color: '#7fa6c9', weight: 4, opacity: .9 }}/> : null)}{activePoint && <CircleMarker center={[activePoint.lat, activePoint.lon]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: '#4f6d8a', fillOpacity: 1 }}><Tooltip>{date(activePoint.time_utc)} UTC · {activePoint.lat.toFixed(2)}°N, {activePoint.lon.toFixed(2)}°E</Tooltip></CircleMarker>}{ZHEJIANG_CITIES.map((item) => <CircleMarker key={item.id} center={item.center} radius={5} pathOptions={{ color: '#fff', weight: 1, fillColor: item.accent, fillOpacity: 1 }}><Tooltip>{item.name} · 城市定位</Tooltip></CircleMarker>)}</MapContainer></div>{selected ? <><div className="zh-track-timeline"><button type="button" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>{playing ? '暂停' : '播放'}</button><input aria-label="台风路径时间点" type="range" min="0" max={Math.max(0, selected.points.length - 1)} value={Math.max(0, activeIndex)} onChange={(event) => { setPlaying(false); setPlayIndex(Number(event.target.value)) }}/><span>{activePoint ? `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(activePoint.time_utc))} 北京时间` : '—'}</span></div><div className="zh-track-caption"><strong>{selected.name === 'UNNAMED' ? '未命名' : selected.name}</strong><span>{selected.points.length} 个路径点 · {date(selected.first_nearby_at)} — {date(selected.last_nearby_at)}</span></div></> : <div className="zh-track-caption">当前事件年份缺少对应轨迹记录；地图保留四城定位。</div>}</div></div>
      <p className="zh-track-boundary">版本 {snapshot.source.name} · EPSG:4326 · UTC；路径当时实际可获得时间未知。数据来源与引用见 <a href={snapshot.source.documentation_url} target="_blank" rel="noreferrer">NOAA NCEI</a>。这是事后最佳路径，不能作为当时可获得的预报或积水真值；当前快照覆盖最近三年，早期事件路径显示为缺失。</p>
    </>}
  </section>
}
