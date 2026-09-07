import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl } from 'react-leaflet'
import {
  getHumanImpactHazards,
  getHumanImpactPopulation,
  getHumanImpactTimeline,
  getHumanImpactDetail,
} from '../api'

/**
 * HumanImpactPage — 居民影响与行为层
 * 灾害→人口暴露→影响→行为→级联→恢复 全链可视化
 */
const HAZARD_COLORS = {
  pluvial_flood: '#3b82f6', typhoon: '#6366f1', earthquake: '#ef4444',
  heatwave: '#f97316', landslide: '#84cc16', storm_surge: '#06b6d4',
  flash_flood: '#a855f7',
}
const BEHAVIOR_LABEL = {
  stay: '原地等待', stay_home: '居家避险', normal_trip: '正常出行',
  cancel_trip: '取消出行', reroute: '绕行', switch_transport: '换乘其他交通',
  evacuate: '撤离', seek_shelter: '前往避难', seek_medical_help: '就医',
  wait: '等待', return_home: '返家',
}
const SCORE_LABEL = {
  exposure_score: '人口暴露', mobility_loss_score: '出行受阻',
  service_loss_score: '服务缺失', health_risk_score: '健康风险',
  evacuation_pressure_score: '疏散压力',
}

function scoreColor(v) {
  if (v <= 5) return '#1e3a5f'
  if (v <= 20) return '#2563eb'
  if (v <= 45) return '#f59e0b'
  if (v <= 70) return '#f97316'
  return '#dc2626'
}

export default function HumanImpactPage() {
  const [hazards, setHazards] = useState(null)
  const [popGrid, setPopGrid] = useState(null)
  const [hazard, setHazard] = useState('pluvial_flood')
  const [timeline, setTimeline] = useState(null)
  const [tIndex, setTIndex] = useState(3) // default T+6
  const [detail, setDetail] = useState(null)
  const [err, setErr] = useState(null)
  const [mag, setMag] = useState(6.5)
  const [rain, setRain] = useState(260)
  const [windMs, setWindMs] = useState(30)
  const [tApp, setTApp] = useState(39)
  const [surge, setSurge] = useState(1.4)

  useEffect(() => {
    Promise.all([getHumanImpactHazards(), getHumanImpactPopulation()])
      .then(([h, p]) => { setHazards(h); setPopGrid(p) })
      .catch((e) => setErr(e.message))
  }, [])

  const params = useMemo(() => {
    const p = {}
    if (hazard === 'earthquake') { p.mag = mag; p.lat = 22.545; p.lon = 114.06 }
    if (hazard === 'pluvial_flood') p.rain48hMm = rain
    if (hazard === 'typhoon') p.windMs = windMs
    if (hazard === 'heatwave') p.tApparentC = tApp
    if (hazard === 'storm_surge') p.surgePeakM = surge
    return p
  }, [hazard, mag, rain, windMs, tApp, surge])

  useEffect(() => {
    if (!hazards) return
    getHumanImpactTimeline(hazard, params)
      .then((t) => { setTimeline(t); setTIndex(Math.min(tIndex, t.frames.length - 1)) })
      .catch((e) => setErr(e.message))
  }, [hazard, JSON.stringify(params)])

  useEffect(() => {
    if (!timeline) return
    const f = timeline.frames[tIndex]
    if (!f) return
    getHumanImpactDetail(hazard, { hourOffset: f.t_h, ...params })
      .then(setDetail)
      .catch((e) => setErr(e.message))
  }, [timeline, tIndex])

  if (err) return <div className="card"><div className="err-box">⚠ {err}</div></div>
  if (!hazards || !popGrid || !detail || !timeline) {
    return <div className="card"><div className="loading">加载居民影响引擎…</div></div>
  }

  const labels = hazards.labels || {}
  const city = detail.aggregate?.city || {}
  const frame = timeline.frames[tIndex] || {}
  const behavior = detail.behavior || {}
  const records = detail.records || []
  const districts = detail.aggregate?.districts || []
  const topDist = districts[0] || {}
  const comps = city.score_components || {}
  const weightKey = ['exposure_score', 'mobility_loss_score', 'service_loss_score', 'health_risk_score', 'evacuation_pressure_score']
  const cellsById = {}
  ;(popGrid.cells || []).forEach((c) => { cellsById[c.grid_id] = c })
  const popByGrid = {}
  records.forEach((r) => { popByGrid[r.grid_id] = r })

  return (
    <div className="surge-page">
      <div className="page-head">
        <h2>🧍 居民影响与行为（Human Impact）</h2>
        <p className="page-desc">
          自然灾害 → 人口暴露 → 居民影响 → 行为变化 → 交通/医疗/避难级联 → 恢复。
          人口底座 GHS-POP 2020 真实栅格（≈1697 万）· 行为为规则+概率模型 · 阈值/权重见 human_config（assumed 标注）。
        </p>
      </div>

      {/* 灾害选择 + 情景参数 */}
      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {Object.keys(hazards.hazards).map((h) => (
            <button
              key={h}
              onClick={() => setHazard(h)}
              style={{
                padding: '4px 12px', borderRadius: 14, fontSize: 12.5, cursor: 'pointer',
                border: `1px solid ${hazard === h ? HAZARD_COLORS[h] : 'var(--line-soft)'}`,
                background: hazard === h ? `${HAZARD_COLORS[h]}22` : 'transparent',
                color: hazard === h ? HAZARD_COLORS[h] : 'var(--ink-2)',
                fontWeight: hazard === h ? 700 : 400,
              }}
            >
              {labels[h] || h}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
          {hazard === 'earthquake' && (<>
            <span style={{ color: 'var(--ink-2)' }}>情景震级</span>
            <input type="range" min="5" max="8" step="0.5" value={mag} onChange={(e) => setMag(Number(e.target.value))} style={{ width: 160 }} />
            <b>M{mag.toFixed(1)}（深圳中心）</b>
          </>)}
          {hazard === 'pluvial_flood' && (<>
            <span style={{ color: 'var(--ink-2)' }}>48h 降雨情景</span>
            <input type="range" min="80" max="400" step="10" value={rain} onChange={(e) => setRain(Number(e.target.value))} style={{ width: 160 }} />
            <b>{rain} mm（合成情景，用于推演演示）</b>
          </>)}
          {hazard === 'typhoon' && (<>
            <span style={{ color: 'var(--ink-2)' }}>最大风速</span>
            <input type="range" min="17" max="45" step="1" value={windMs} onChange={(e) => setWindMs(Number(e.target.value))} style={{ width: 160 }} />
            <b>{windMs} m/s</b>
          </>)}
          {hazard === 'heatwave' && (<>
            <span style={{ color: 'var(--ink-2)' }}>午后体感温度</span>
            <input type="range" min="33" max="42" step="0.5" value={tApp} onChange={(e) => setTApp(Number(e.target.value))} style={{ width: 160 }} />
            <b>{tApp.toFixed(1)} °C</b>
          </>)}
          {hazard === 'storm_surge' && (<>
            <span style={{ color: 'var(--ink-2)' }}>风暴增水</span>
            <input type="range" min="0.5" max="2.5" step="0.1" value={surge} onChange={(e) => setSurge(Number(e.target.value))} style={{ width: 160 }} />
            <b>{surge.toFixed(1)} m</b>
          </>)}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
            {detail.records?.[0]?.hazard && `当前帧 ${frame.phase}`}
          </span>
        </div>
      </div>

      {/* 时间线 */}
      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {timeline.frames.map((f, i) => (
            <button
              key={f.t_h}
              onClick={() => setTIndex(i)}
              style={{
                padding: '6px 10px', borderRadius: 10, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${i === tIndex ? HAZARD_COLORS[hazard] : 'var(--line-soft)'}`,
                background: i === tIndex ? `${HAZARD_COLORS[hazard]}22` : 'transparent',
                color: i === tIndex ? 'var(--ink)' : 'var(--ink-3)',
              }}
            >
              T{f.t_h === 0 ? '0' : `+${f.t_h}h`}<br />
              <span style={{ fontSize: 10 }}>{f.phase}</span>
            </button>
          ))}
          <div style={{ marginLeft: 12, fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            受影响 {fmt(city.affected_population)} 人 →
            主导行为 <b style={{ color: HAZARD_COLORS[hazard] }}>{BEHAVIOR_LABEL[behavior.dominant] || behavior.dominant}</b><br />
            恢复状态 <b>{fRec(frame)}</b> · 预计恢复 {city.estimated_recovery_time_h}h
          </div>
        </div>
      </div>

      {/* 四核心指标 */}
      <div className="hazard-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="hazard-card" style={{ border: '1px solid var(--line-soft)' }}>
          <div className="hc-head">受影响人口</div>
          <div className="hc-big">{fmt(city.affected_population)}</div>
          <div className="hc-sub">占全市 {pct(city.affected_population, city.total_population)}</div>
        </div>
        <div className="hazard-card" style={{ border: '1px solid var(--line-soft)' }}>
          <div className="hc-head">出行受阻人口</div>
          <div className="hc-big">{fmt(city.mobility_disrupted_population)}</div>
          <div className="hc-sub">被困 {fmt(city.stranded_population)} · 均延 {delayText(records)}</div>
        </div>
        <div className="hazard-card" style={{ border: '1px solid var(--line-soft)' }}>
          <div className="hc-head">关键服务受损人口</div>
          <div className="hc-big">{fmt(city.critical_service_loss_population)}</div>
          <div className="hc-sub">医疗风险 {fmt(city.medical_risk_population)}</div>
        </div>
        <div className="hazard-card" style={{ border: '1px solid var(--line-soft)' }}>
          <div className="hc-head">预计恢复时间</div>
          <div className="hc-big">{city.estimated_recovery_time_h}h</div>
          <div className="hc-sub">瓶颈 {city.recovery_bottleneck || '—'} · 疏散 {fmt(city.evacuation_population)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 10, marginTop: 10 }}>
        {/* 地图热图 */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 520 }}>
          <MapContainer center={[22.6, 114.15]} zoom={10} style={{ height: 520 }} zoomControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OSM" />
            {records.map((r) => {
              const pop = cellsById[r.grid_id]
              if (!pop) return null
              const sc = r.human_impact_score || 0
              const sz = 4 + Math.min(16, Math.sqrt(pop.night_population || 0) * 0.06)
              return (
                <CircleMarker
                  key={r.grid_id}
                  center={[pop.lat, pop.lon]}
                  radius={sz}
                  pathOptions={{
                    color: '#fff', weight: 0.6,
                    fillColor: scoreColor(sc), fillOpacity: sc > 0 ? 0.85 : 0.18,
                  }}
                >
                  <Tooltip sticky className="grid-tooltip" opacity={1}>
                    <div className="grid-tip-head">{pop.district} · HI {sc}/100</div>
                    <div><span>灾害强度</span><b>{r.intensity} {r.intensity_unit}</b></div>
                    <div><span>当前人口</span><b>{fmt(pop.current_population ?? pop.night_population)}</b></div>
                    <div><span>受影响</span><b>{fmt(r.affected_population)}（{pct(r.affected_population, r.current_population)}）</b></div>
                    <div style={{ marginTop: 4, fontSize: 10 }}>
                      <span>Mobility </span><b>{r.mobility_disrupted_population ? fmt(r.mobility_disrupted_population) : '—'}</b>
                      {' · Medical '}<b>{r.medical_risk_population ? fmt(r.medical_risk_population) : '—'}</b>
                      {' · Shelter '}<b>{r.shelter_demand ? fmt(r.shelter_demand) : '—'}</b>
                    </div>
                    {(r.reasons || []).slice(0, 2).map((rs, i) => (
                      <div key={i} style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>· {rs}</div>
                    ))}
                  </Tooltip>
                </CircleMarker>
              )
            })}
            <ZoomControl position="bottomright" />
          </MapContainer>
          <div style={{ padding: '6px 10px', fontSize: 10.5, color: 'var(--ink-3)', display: 'flex', gap: 10 }}>
            <span>热图 = human_impact_score（人口加权）</span>
            {[[0, '无影响'], [20, '低'], [45, '中'], [70, '高'], [100, '严重']].map(([v, l]) => (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: scoreColor(v), display: 'inline-block' }} />{l}
              </span>
            ))}
          </div>
        </div>

        {/* 右栏：行为 + 评分 + 主要影响 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto' }}>
          <div className="card" style={{ padding: 12 }}>
            <div className="map-legend-title"><span>居民行为分布</span><small>规则+概率模型</small></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: HAZARD_COLORS[hazard] }}>
              {BEHAVIOR_LABEL[behavior.dominant] || behavior.dominant}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 6 }}>主导行为 · 影响人口合计 {fmt(city.total_population)}</div>
            {Object.entries(behavior.by_action_pct || {}).slice(0, 6).map(([a, p]) => (
              <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 11 }}>
                <span style={{ width: 76, color: 'var(--ink-2)' }}>{BEHAVIOR_LABEL[a] || a}</span>
                <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--bg-deep)', overflow: 'hidden' }}>
                  <div style={{ width: `${p}%`, height: '100%', background: HAZARD_COLORS[hazard] }} />
                </div>
                <b style={{ width: 40, textAlign: 'right' }}>{p}%</b>
              </div>
            ))}
            {behavior.distribution && (
              <div style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 4 }}>
                单格期望行为占比例（顶格）：{Object.entries(behavior.distribution).slice(0, 3).map(([a, p]) => `${BEHAVIOR_LABEL[a] || a} ${p}%`).join(' / ')}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="map-legend-title"><span>Human Impact 分解</span><small>为什么高</small></div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{city.weighted_impact}<span style={{ fontSize: 13, color: 'var(--ink-3)' }}>/100</span></div>
            {weightKey.map((k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2.5px 0', fontSize: 11 }}>
                <span style={{ width: 84, color: 'var(--ink-2)' }}>{SCORE_LABEL[k]}</span>
                <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--bg-deep)', overflow: 'hidden' }}>
                  <div style={{ width: `${comps[k] || 0}%`, height: '100%', background: scoreColor(comps[k] || 0) }} />
                </div>
                <b style={{ width: 34, textAlign: 'right' }}>{Math.round(comps[k] || 0)}</b>
              </div>
            ))}
            <div style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 5 }}>exposure+mobility+service+health+evacuation 加权（权重 human_config.SCORE_WEIGHTS）</div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="map-legend-title"><span>区级排名</span><small>按受影响人口</small></div>
            {districts.slice(0, 6).map((d) => (
              <div key={d.district_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2.5px 0', fontSize: 11.5 }}>
                <span style={{ width: 56, color: 'var(--ink-2)' }}>{d.district}</span>
                <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--bg-deep)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${pctNum(d.affected_population, d.population)}%`, height: '100%',
                    background: d.affected_population > 0 ? HAZARD_COLORS[hazard] : '#333',
                  }} />
                </div>
                <b style={{ width: 70, textAlign: 'right', fontSize: 10.5 }}>{fmt(d.affected_population)}</b>
              </div>
            ))}
            <div style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 5 }}>
              最高区：{topDist.district || '—'} 受影响 {fmt(topDist.affected_population || 0)} · 被困 {fmt(topDist.stranded_population || 0)} · 隔离格 {topDist.isolated_cells || 0}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 10, marginTop: 10, fontSize: 10.5, color: 'var(--ink-3)' }}>
        数据底座：{popGrid.provenance?.population}。行为/级联/恢复阈值均为 human_config 集中 assumed 参数（来源清单见 backend/app/human_config.py PROVENANCE）。
        地震/滑坡/风暴潮等使用真实模块状态（USGS 目录/300 隐患点/验潮站增水），合成降雨情景仅用于内涝推演演示并已标注。
      </div>
    </div>
  )
}

function fmt(v) {
  const n = Number(v || 0)
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString()
}
function pct(a, b) {
  const v = Number(a || 0) / (Number(b) || 1)
  return `${(v * 100).toFixed(0)}%`
}
function pctNum(a, b) {
  return Math.min(100, (Number(a || 0) / (Number(b) || 1)) * 100)
}
function delayText(records) {
  const ds = records.filter((r) => r.average_travel_delay_min > 0).map((r) => r.average_travel_delay_min)
  if (!ds.length) return '—'
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length
  return `+${avg.toFixed(0)}min`
}
function fRec(frame) {
  const labels = { 0: '正常', 1: '受影响', 2: '应急', 3: '恢复中', 4: '已恢复' }
  return labels[frame.recovery_state] || frame.recovery_state
}
