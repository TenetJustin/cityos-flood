import { useEffect, useState } from 'react'
import { getHumanImpactOverview } from '../api'

/**
 * HumanImpactPanel — 总览页居民影响小卡
 * 四核心指标（受影响/出行受阻/关键服务/恢复）+ 主导行为
 */
const HZ = { pluvial_flood: '#3b82f6', typhoon: '#6366f1', earthquake: '#ef4444', heatwave: '#f97316' }
const BEHAVIOR_LABEL = {
  stay: '原地等待', stay_home: '居家避险', normal_trip: '正常出行',
  cancel_trip: '取消出行', reroute: '绕行', switch_transport: '换乘',
  evacuate: '撤离', seek_shelter: '避难', wait: '等待', return_home: '返家',
}

export default function HumanImpactPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    getHumanImpactOverview('pluvial_flood').then(setData).catch((e) => setErr(e.message))
  }, [])
  if (err || !data || data.error) return null
  const city = data.aggregate?.city || {}
  const bh = data.aggregate?.dominant_behavior
  const color = HZ.pluvial_flood
  const none = city.affected_population <= 0
  return (
    <section className="card">
      <div className="panel-title">
        <span>🧍 居民影响（暴雨内涝实时）</span>
        <small>GHS 人口底座 · 规则行为 · 级联反馈</small>
      </div>
      {none ? (
        <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-3)' }}>
          当前无内涝积水，居民出行正常。切至「居民影响」页可选暴雨/台风/地震等情景推演 T0→T+24h 的居民行为与级联。
        </div>
      ) : (
        <div className="hazard-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {[
            ['受影响人口', city.affected_population],
            ['出行受阻', city.mobility_disrupted_population],
            ['关键服务受损', city.critical_service_loss_population],
            ['恢复时间', `${city.estimated_recovery_time_h}h`],
          ].map(([k, v]) => (
            <div key={k} className="hazard-card" style={{ border: '1px solid var(--line-soft)' }}>
              <div className="hc-head">{k}</div>
              <div className="hc-big" style={{ fontSize: 16 }}>
                {typeof v === 'number' ? (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString()) : v}
              </div>
            </div>
          ))}
        </div>
      )}
      {bh && !none && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', padding: '4px 12px 8px' }}>
          主导行为：<b style={{ color }}>{BEHAVIOR_LABEL[bh] || bh}</b> · 医疗风险 {fmt(city.medical_risk_population)} · 疏散 {fmt(city.evacuation_population)} · 无医院可达 {fmt(city.population_without_access_to_hospital)}
        </div>
      )}
    </section>
  )
}
function fmt(v) {
  const n = Number(v || 0)
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString()
}
