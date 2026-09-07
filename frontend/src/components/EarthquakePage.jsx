import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl } from 'react-leaflet'
import {
  getEarthquakeCatalog,
  getEarthquakeFaults,
  getEarthquakeScenario,
  getEarthquakeRisk,
} from '../api'

/**
 * EarthquakePage — 地震灾害页
 * 断裂带 + 历史目录 + 情景烈度快速评估 + 区级风险分级
 * 数据：USGS 真实目录（1970–2026, 华南沿海 98 条）+ 公开文献断裂带（示意）
 */
const MMI_COLORS = {
  8: '#7f1d1d', 7: '#b91c1c', 6: '#ea580c', 5: '#d97706', 4: '#eab308', 3: '#84cc16',
}
const FAULT_COLORS = { '活动断裂（海域）': '#0ea5e9', 活动断裂: '#ef4444' }
const LEVEL_COLORS = { high: '#dc2626', medium: '#f59e0b', low: '#10b981' }

export default function EarthquakePage() {
  const [catalog, setCatalog] = useState(null)
  const [faults, setFaults] = useState(null)
  const [risk, setRisk] = useState(null)
  const [scenario, setScenario] = useState(null)
  const [mag, setMag] = useState(6.0)
  const [err, setErr] = useState(null)

  useEffect(() => {
    Promise.all([
      getEarthquakeCatalog(4.5, 400, 120),
      getEarthquakeFaults(),
      getEarthquakeRisk(),
      getEarthquakeScenario({ mag: 6.0, name: '滨海断裂带 M6.0 情景' }),
    ])
      .then(([c, f, r, s]) => { setCatalog(c); setFaults(f); setRisk(r); setScenario(s) })
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (scenario == null) return
    getEarthquakeScenario({ mag, name: `${mag.toFixed(1)} 级情景` })
      .then(setScenario).catch(() => {})
  }, [mag])

  if (err) return <div className="card"><div className="err-box">⚠ {err}</div></div>
  if (!scenario) return <div className="card"><div className="loading">加载地震数据…</div></div>

  const epic = scenario.hypocenter
  const epicCenter = [epic.lat, epic.lon]
  const ringKm = scenario.radius_km?.['破坏(≥Ⅵ)'] || 0

  return (
    <div className="surge-page">
      <div className="page-head">
        <h2>🌍 地震灾害</h2>
        <p className="page-desc">
          华南沿海地震带：深圳主城区 1970 年以来无破坏性地震记录，风险主要来自
          邻区（河源新丰江震区 M6.1/1962、滨海断裂带）与近场断裂。
          历史目录为 <b>USGS 真实数据</b>；烈度评估为经验衰减近似，非官方预警。
        </p>
      </div>

      {/* 情景烈度滑块 */}
      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>情景震级</span>
          <input
            type="range" min="4" max="8" step="0.5" value={mag}
            onChange={(e) => setMag(Number(e.target.value))}
            style={{ width: 220 }}
          />
          <b style={{ fontSize: 15 }}>M{mag.toFixed(1)}</b>
          <span className="hc-chip">震中烈度 {scenario.epicentral_mmi_label}</span>
          <span className="hc-chip">有感半径 {scenario.radius_km?.['有感(≥Ⅲ)']} km</span>
          <span className="hc-chip">破坏半径 ≥Ⅵ：{ringKm} km</span>
          <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{scenario.method}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 10 }}>
        {/* 左：断裂带 + 情景烈度地图 */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 480 }}>
          <MapContainer
            center={[22.62, 114.15]} zoom={9}
            style={{ height: 480, background: 'var(--bg-deep)' }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="© OSM"
            />
            {faults?.faults?.map((f) => (
              <Polyline
                key={f.id}
                positions={f.coordinates.map(([lon, lat]) => [lat, lon])}
                pathOptions={{
                  color: FAULT_COLORS[f.type] || '#8b5cf6',
                  weight: f.type.includes('活动') ? 2.6 : 1.6,
                  dashArray: f.type.includes('海域') ? null : '4 3',
                  opacity: 0.9,
                }}
              >
                <Tooltip sticky className="grid-tooltip" opacity={1}>
                  <div className="grid-tip-head">{f.name}</div>
                  <div><span>性质</span><b>{f.type}</b></div>
                  <div><span>长度</span><b>{f.length_km} km</b></div>
                  <div style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{f.note}</div>
                </Tooltip>
              </Polyline>
            ))}
            {scenario.districts?.map((d) => {
              const color = MMI_COLORS[Math.min(8, Math.max(3, Math.floor(d.mmi)))] || '#a3a3a3'
              return (
                <CircleMarker
                  key={d.district_id}
                  center={(() => {
                    const map = { futian: [22.538, 114.058], luohu: [22.555, 114.135], nanshan: [22.53, 113.93], baoan: [22.555, 113.88], longgang: [22.72, 114.21], yantian: [22.56, 114.23], longhua: [22.68, 114.04], pingshan: [22.69, 114.33], guangming: [22.75, 113.95], dapeng: [22.61, 114.5] }
                    return map[d.district_id] || [22.545, 114.06]
                  })()}
                  radius={6 + d.mmi * 1.6}
                  pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 0.85, weight: 1.2 }}
                >
                  <Tooltip direction="top" className="grid-tooltip" opacity={1}>
                    <div className="grid-tip-head">{d.district_name}</div>
                    <div><span>烈度</span><b>{d.mmi.toFixed(1)} · {d.mmi_label}</b></div>
                    <div><span>震中距</span><b>{d.distance_km} km</b></div>
                    <div style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{d.impact}</div>
                  </Tooltip>
                </CircleMarker>
              )
            })}
            {ringKm > 0 && (
              <CircleMarker
                center={epicCenter}
                radius={ringKm * 60}
                pathOptions={{ color: '#dc2626', weight: 1.4, fillColor: '#dc2626', fillOpacity: 0.12, dashArray: '6 4' }}
              >
                <Tooltip className="grid-tooltip" opacity={1}>破坏影响半径 ≈ {ringKm} km</Tooltip>
              </CircleMarker>
            )}
            <ZoomControl position="bottomright" />
          </MapContainer>
        </div>

        {/* 右：区级烈度 + 风险 */}
        <div className="card" style={{ padding: 12, overflowY: 'auto', maxHeight: 480 }}>
          <div className="map-legend-title"><span>情景烈度（M{mag.toFixed(1)}）</span></div>
          {scenario.districts?.slice(0, 8).map((d) => (
            <div key={d.district_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
              <span style={{ width: 52, color: 'var(--ink-2)' }}>{d.district_name}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-deep)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, d.mmi / 9 * 100)}%`, height: '100%', background: MMI_COLORS[Math.min(8, Math.max(3, Math.floor(d.mmi)))] }} />
              </div>
              <b style={{ width: 108, textAlign: 'right' }}>{d.mmi_label}</b>
            </div>
          ))}
          <div className="map-legend-title" style={{ marginTop: 10 }}><span>区级地震风险分级</span><small>断裂邻近+历史+暴露</small></div>
          {risk?.districts?.slice(0, 10).map((d) => (
            <div key={d.district_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2.5px 0', fontSize: 11.5 }}>
              <span style={{ width: 52, color: 'var(--ink-2)' }}>{d.district_name}</span>
              <span style={{ fontSize: 10.5, color: 'var(--ink-3)', flex: 1 }}>
                最近断裂 {d.nearest_fault_km}km · 历史 {d.historic_max_mag_120km}级
              </span>
              <span style={{ color: LEVEL_COLORS[d.level], fontWeight: 700, width: 34, textAlign: 'right' }}>
                {d.score}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 8 }}>{risk?.note}</div>
        </div>
      </div>

      {/* 历史目录 */}
      <div className="card" style={{ padding: 12, marginTop: 10 }}>
        <div className="map-legend-title"><span>历史地震目录（华南沿海 · USGS 真实）</span>
          <small>{catalog?.total_in_region} 条 M≥4（1970–2026），展示 {catalog?.shown} 条</small>
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--ink-3)', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px' }}>时间</th>
                <th>震级</th>
                <th>位置</th>
                <th>距深圳</th>
                <th>深度</th>
              </tr>
            </thead>
            <tbody>
              {(catalog?.events || []).slice(-40).reverse().map((e) => (
                <tr key={e.id || `${e.time}-${e.lat}`} style={{ borderTop: '1px solid var(--line-soft)' }}>
                  <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{(e.time || '').replace('T', ' ').slice(0, 16)}</td>
                  <td><b style={{ color: e.mag >= 5 ? '#ef4444' : 'var(--ink)' }}>M{e.mag}</b></td>
                  <td style={{ color: 'var(--ink-2)' }}>{e.place}</td>
                  <td>{e.distance_km} km</td>
                  <td>{e.depth_km} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 6 }}>
          来源：USGS FDSN（真实目录）；断裂带位置为公开文献示意（非实测）。本页为指挥参考，非官方地震预警。
        </div>
      </div>
    </div>
  )
}
