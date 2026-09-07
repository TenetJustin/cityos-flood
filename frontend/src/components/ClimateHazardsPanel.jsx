import { useEffect, useState } from 'react'
import { getClimateHazards } from '../api'

/**
 * ClimateHazardsPanel — 高温热浪 / 大雾 / 雷电 10 区实时监测
 * Open-Meteo 逐时预报 + 深圳气象台阈值约定（近似映射）
 */
const LEVEL_STYLE = {
  none: { color: 'var(--ink-3)', bg: 'var(--bg-deep)' },
  watch: { color: '#eab308', bg: '#eab30814' },
  yellow: { color: '#eab308', bg: '#eab3081e' },
  orange: { color: '#f97316', bg: '#f973161e' },
  red: { color: '#dc2626', bg: '#dc26261e' },
  heatwave: { color: '#dc2626', bg: '#dc26261e' },
}

const HAZARD_META = {
  heat: { icon: '🔥', label: '高温热浪' },
  fog: { icon: '🌫️', label: '大雾' },
  storm: { icon: '⛈️', label: '雷电' },
}

export default function ClimateHazardsPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getClimateHazards().then(setData).catch((e) => setErr(e.message))
  }, [])

  if (err) return null
  if (!data || data.error) return null

  const districts = data.districts || []
  const alert = data.city_alert || {}

  const Card = ({ keyName }) => {
    const m = HAZARD_META[keyName]
    const items = districts.map((d) => d[keyName]).filter((x) => x)
    const active = items.filter((x) => x.level !== 'none' && x.level !== 'watch')
    const top = [...items].sort((a, b) => b.tmax_c - a.tmax_c)[0] || items[0]
    const level = active.length > 0 ? (active.some((x) => x.level === 'red' || x.level === 'orange') ? 'orange' : 'yellow') : 'none'
    const st = LEVEL_STYLE[level]
    const sub = keyName === 'heat'
      ? (top ? `最高 ${top.tmax_c}°C${top.consecutive_hot_days >= 2 ? ` · 连续${top.consecutive_hot_days}天` : ''}` : '—')
      : keyName === 'fog'
        ? (top ? `最低能见度 ${top.min_visibility_m}m` : '—')
        : (top ? `雷暴时次 ${top.storm_hours_48h}h/48h${top.hail ? ' · 含冰雹' : ''}` : '—')
    const n = active.length
    return (
      <div className="hazard-card" style={{ background: st.bg, border: `1px solid ${st.color}33` }}>
        <div className="hc-head">{m.icon} {m.label}
          <span className="hc-chip" style={{ marginLeft: 6, color: st.color }}>{active.length} 区</span>
        </div>
        <div className="hc-big" style={{ color: st.color }}>{n === 0 ? '无预警' : `${n} 区预警`}</div>
        <div className="hc-sub">{sub}</div>
        <div className="hc-meta">
          {alert[keyName === 'heat' ? 'heatwave' : keyName === 'fog' ? 'dense_fog' : 'thunderstorm']?.districts?.slice(0, 3).map((dn) => (
            <span key={dn} className="hc-chip">{dn}</span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="card">
      <div className="panel-title">
        <span>🌡️ 高温 · 大雾 · 雷电</span>
        <small>Open-Meteo 逐时预报 · 深圳气象台阈值约定（近似）</small>
      </div>
      <div className="hazard-cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Card keyName="heat" />
        <Card keyName="fog" />
        <Card keyName="storm" />
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-3)', padding: '6px 12px 10px' }}>
        阈值：高温 ≥35/37/40°C（连续3天为热浪）· 大雾 &lt;500/200m · 雷电天气码 95–99（含冰雹）。非官方预警信号。
      </div>
    </section>
  )
}
