import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl } from 'react-leaflet'
import {
  getReservoirsInventory,
  getReservoirsPreRelease,
  getReservoirsRiverWarning,
  getReservoirsSummary,
} from '../api'

/**
 * ReservoirPanel — 水库调度页
 * 蓄洪余量 + 预泄调度方案 + 下游河道/山洪沟道联合预警
 * 库容参数公开资料；水位/雨量为真实台账；降雨为 Open-Meteo 预报
 */
const LEVEL_COLORS = { green: '#10b981', yellow: '#eab308', red: '#dc2626' }
const GULLY_COLORS = { green: '#10b981', yellow: '#eab308', orange: '#f97316', red: '#dc2626' }
const LEVEL_LABEL = { green: '正常', yellow: '建议预泄', red: '强制预泄' }

export default function ReservoirPanel() {
  const [inv, setInv] = useState(null)
  const [rel, setRel] = useState(null)
  const [rw, setRw] = useState(null)
  const [rain, setRain] = useState(150)
  const [err, setErr] = useState(null)

  useEffect(() => {
    Promise.all([
      getReservoirsInventory(),
      getReservoirsPreRelease(),
      getReservoirsRiverWarning(0),
      getReservoirsSummary(),
    ])
      .then(([i, r, w]) => { setInv(i); setRel(r); setRw(w) })
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (inv == null) return
    setRel(null); setRw(null)
    Promise.all([
      getReservoirsPreRelease(rain),
      getReservoirsRiverWarning(60, rain),
    ]).then(([r, w]) => { setRel(r); setRw(w) }).catch(() => {})
  }, [rain])

  if (err) return <div className="card"><div className="err-box">⚠ {err}</div></div>
  if (!inv || !rel || !rw) return <div className="card"><div className="loading">加载水库调度数据…</div></div>

  const level = rel.city_level
  const rainLabel = rel.forecast

  return (
    <div className="surge-page">
      <div className="page-head">
        <h2>🏞️ 水库调度与山洪预警</h2>
        <p className="page-desc">
          蓄洪余量 = 库容参数（公开资料）× 蓄水率假设；预泄方案 = 48h 预报降雨 → 入库水量 vs 余量（简化工程估算）。
          河道为集总参数模型，山洪沟道按雨强×坡度经验分级。数据与规则均为近似，指挥参考。
        </p>
      </div>

      {/* 预泄调度卡 */}
      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>48h 预报降雨</span>
          <input type="range" min="0" max="400" step="10" value={rain}
            onChange={(e) => setRain(Number(e.target.value))} style={{ width: 200 }} />
          <b>{rain} mm</b>
          <span className="hc-chip" style={{
            background: `${LEVEL_COLORS[level]}22`, color: LEVEL_COLORS[level],
            border: `1px solid ${LEVEL_COLORS[level]}55`, fontWeight: 700,
          }}>
            全市调度等级：{level === 'red' ? '🔴 强制预泄' : level === 'yellow' ? '🟡 建议预泄' : '🟢 无需预泄'}
          </span>
          <span className="hc-chip">入库总量估算 {rel.total_suggested_release_m3_s} m³/s</span>
          <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>预报 48h {rainLabel.rain_48h_mm}mm · 峰 {rainLabel.peak_mm_h}mm/h</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 10 }}>
        {/* 左：山洪沟道地图 */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 420 }}>
          <MapContainer center={[22.62, 114.15]} zoom={10} style={{ height: 420 }} zoomControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OSM" />
            {rw.gullies?.map((g) => (
              <CircleMarker
                key={g.id}
                center={[g.lat, g.lon]}
                radius={g.level === 'red' ? 9 : g.level === 'orange' ? 7 : g.level === 'yellow' ? 5 : 4}
                pathOptions={{
                  color: '#fff', fillColor: GULLY_COLORS[g.level], fillOpacity: 0.9, weight: 1.3,
                }}
              >
                <Tooltip direction="top" className="grid-tooltip" opacity={1}>
                  <div className="grid-tip-head">{g.name}</div>
                  <div><span>风险</span><b style={{ color: GULLY_COLORS[g.level] }}>{g.label}</b></div>
                  <div><span>坡度</span><b>{g.slope} · {g.type}</b></div>
                  <div><span>峰值雨强</span><b>{g.rain_peak_mm_h} mm/h · 24h {g.rain_24h_mm}mm</b></div>
                  <div><span>影响</span><b>{g.downstream}</b></div>
                </Tooltip>
              </CircleMarker>
            ))}
            {inv.reservoirs?.map((r) => (
              <CircleMarker
                key={r.name}
                center={[r.lat, r.lon]}
                radius={5}
                pathOptions={{ color: '#1e3a8a', fillColor: '#3b82f6', fillOpacity: 0.85, weight: 1.2 }}
              >
                <Tooltip direction="top" className="grid-tooltip" opacity={1}>
                  <div className="grid-tip-head">{r.name}（{r.district}）</div>
                  <div><span>总库容</span><b>{(r.total_capacity_10k_m3 / 1000).toFixed(2)} 亿 m³</b></div>
                  <div><span>蓄洪余量</span><b>{r.flood_margin_10k_m3.toLocaleString()} 万 m³</b></div>
                  <div><span>实时雨强</span><b>{r.current_rainfall_mm_h ?? '—'} mm/h</b></div>
                </Tooltip>
              </CircleMarker>
            ))}
            <ZoomControl position="bottomright" />
          </MapContainer>
          <div style={{ padding: '6px 10px', fontSize: 10.5, color: 'var(--ink-3)', display: 'flex', gap: 12 }}>
            <span>🔵 水库（12 座）</span>
            {Object.entries(GULLY_COLORS).map(([k, c]) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
                {k === 'orange' ? '高风险' : k === 'yellow' ? '关注' : k === 'red' ? '极高' : '正常'}
              </span>
            ))}
          </div>
        </div>

        {/* 右：水库预泄表 */}
        <div className="card" style={{ padding: 12, overflowY: 'auto', maxHeight: 470 }}>
          <div className="map-legend-title"><span>水库预泄方案（{rel.releases.length} 座）</span>
            <small>蓄洪余量合计 {inv.total_flood_margin_10k_m3.toLocaleString()} 万 m³</small>
          </div>
          {rel.releases.map((r) => (
            <div key={r.name} style={{ padding: '6px 0', borderTop: '1px solid var(--line-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <b style={{ width: 88 }}>{r.name}</b>
                <span style={{
                  fontSize: 10.5, padding: '1px 7px', borderRadius: 8,
                  color: LEVEL_COLORS[r.level], background: `${LEVEL_COLORS[r.level]}1e`,
                  border: `1px solid ${LEVEL_COLORS[r.level]}44`,
                }}>
                  {r.level === 'red' ? '强制预泄' : r.level === 'yellow' ? '建议预泄' : '正常'}
                </span>
                <span style={{ color: 'var(--ink-3)', fontSize: 10.5, flex: 1 }}>
                  入库 {r.inflow_48h_10k_m3.toLocaleString()}万 / 余量 {r.flood_margin_10k_m3.toLocaleString()}万
                </span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2, display: 'flex', gap: 10 }}>
                <span>集雨 {r.catchment_km2}km² · 48h 雨 {r.rain_48h_mm}mm</span>
                {r.suggested_release_m3_s > 0 && (
                  <b style={{ color: LEVEL_COLORS[r.level] }}>建议泄量 {r.suggested_release_m3_s} m³/s</b>
                )}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 6 }}>{inv.provenance}</div>
        </div>
      </div>

      {/* 下游河道 + 山洪联合预警 */}
      <div className="card" style={{ padding: 12, marginTop: 10 }}>
        <div className="map-legend-title"><span>下游河道 + 山洪沟道联合预警</span>
          <small>河道：集总参数模型（5 河段）· 山洪：雨强×坡度分级</small>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', marginBottom: 4 }}>河段流量 vs 警戒</div>
            {rw.reaches.map((r) => (
              <div key={r.reach_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2.5px 0', fontSize: 11.5 }}>
                <span style={{ width: 90, color: 'var(--ink-2)' }}>{r.reach_id}</span>
                <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--bg-deep)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, r.flow_ratio * 100)}%`, height: '100%',
                    background: r.status === '超警溢流' ? '#dc2626' : r.status === '接近警戒' ? '#eab308' : '#10b981',
                  }} />
                </div>
                <span style={{ width: 130, textAlign: 'right', fontSize: 10.5, color: 'var(--ink-2)' }}>
                  {r.flow_m3_s}/{r.bankfull_m3_s} m³/s
                </span>
                <b style={{ width: 70, textAlign: 'right', fontSize: 11 }}>{r.status}</b>
              </div>
            ))}
            <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 5 }}>
              联合：水库预泄 {rw.joint.release_m3_s} m³/s + 区间降雨 → 下游河道
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', marginBottom: 4 }}>山洪沟道（{rw.gullies.length} 条）</div>
            {rw.gullies.map((g) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2.5px 0', fontSize: 11.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: GULLY_COLORS[g.level], display: 'inline-block' }} />
                <span style={{ width: 150, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                <span style={{ flex: 1, fontSize: 10, color: 'var(--ink-3)' }}>{g.slope} · 影响 {g.downstream}</span>
                <b style={{ color: GULLY_COLORS[g.level], width: 48, textAlign: 'right' }}>{g.label}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
