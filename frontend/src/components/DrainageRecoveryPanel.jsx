import { useEffect, useState } from 'react'
import { getDrainageSummary } from '../api'

/**
 * DrainageRecoveryPanel — 排水恢复观测（严重度 × 退水速度分离）
 *
 * 数据来自 148 个积涝水情站的小时水位（深圳市水务局开放平台，observed-derived）。
 * 核心思想：积水严重度和退水速度是两个独立维度——
 * 福田区「内涝严重但排水非常快」可以同时成立，单一 drainage_design 标量无法表达。
 *
 * 严重度 = 观测峰值积水深度（peak_depth_m）
 * 恢复速度 = 峰值后降至 0.02m 以下的小时数（median_recession_hours）
 * 恢复评分 recovery_score = 1 / (1 + 中位退水小时 / 6h)，1 表示退水极快
 */
const DISTRICT_NAMES = {
  futian: '福田', luohu: '罗湖', nanshan: '南山', baoan: '宝安',
  longgang: '龙岗', yantian: '盐田', longhua: '龙华', pingshan: '坪山',
  guangming: '光明', dapeng: '大鹏',
}

const SEVERE_COLORS = ['#1f7a4d', '#c9b458', '#e08a1e', '#d6452a', '#b3122b']

function severityColor(depthM) {
  if (depthM >= 0.30) return SEVERE_COLORS[4]
  if (depthM >= 0.15) return SEVERE_COLORS[3]
  if (depthM >= 0.05) return SEVERE_COLORS[2]
  if (depthM >= 0.02) return SEVERE_COLORS[1]
  return SEVERE_COLORS[0]
}

function severityLabel(depthM) {
  if (depthM >= 0.30) return '重'
  if (depthM >= 0.15) return '较重'
  if (depthM >= 0.05) return '中'
  if (depthM >= 0.02) return '轻'
  return '无'
}

export default function DrainageRecoveryPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getDrainageSummary().then(setData).catch((e) => setErr(e.message))
  }, [])

  if (err) return null
  if (!data) return null

  const districts = Object.values(data.districts || {})
  if (!districts.length) return null

  // 按恢复速度排序（score 高在前；无观测排后）
  const sorted = [...districts].sort((a, b) => (b.recovery_score ?? -1) - (a.recovery_score ?? -1))
  const futian = data.districts?.futian

  // 全市统计
  const totalActive = districts.reduce((s, d) => s + d.active_station_count, 0)
  const withRecession = districts.filter((d) => d.recovery_score != null)
  const fastRecovery = withRecession.filter((d) => d.recovery_score >= 0.5).length
  // 删失事件统计（窗口末端未退净/缺测，退水未知）
  const censoredTotal = districts.reduce((s, d) => s + (d.episode_counts?.right_censored || 0) + (d.episode_counts?.gap_unresolved || 0), 0)

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-h">
        💧 排水恢复观测（严重度 × 退水速度）
        <span className="hint">148 积涝站小时水位 · 事件级删失语义 · 观测层（非管网容量）</span>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--line-soft)' }}>
        <span className="chip ok">积水活跃站 {totalActive} / 148</span>
        <span className="chip">退水观测覆盖 {withRecession.length} 区</span>
        <span className="chip ok">快速恢复区 {fastRecovery}</span>
        {censoredTotal > 0 && (
          <span className="chip warn" title="观测窗口末端仍在积水或因缺测无法判定退水的事件，不计入退水统计">
            未退净/缺测事件 {censoredTotal}（删失，退水未知）
          </span>
        )}
        {futian && futian.recovery_score != null && (
          <span className="chip" style={{ color: 'var(--accent-2)', borderColor: 'color-mix(in srgb, var(--accent-2) 40%, transparent)' }}>
            福田：峰值 {futian.peak_depth_m.toFixed(2)}m · 已退净事件中位 {futian.median_recession_hours}h · 评分 {futian.recovery_score}
          </span>
        )}
      </div>

      {/* 分区行：严重度 | 事件构成 | 退水中位（仅已完成事件） */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map((d) => {
          const name = DISTRICT_NAMES[d.district_id] || d.district_id
          const sc = severityColor(d.peak_depth_m)
          const hasObs = d.recovery_score != null
          const ec = d.episode_counts || {}
          const censored = (ec.right_censored || 0) + (ec.gap_unresolved || 0)
          return (
            <div key={d.district_id} style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr) 150px 76px', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{name}</span>

              {/* 严重度条：观测峰值 */}
              <div style={{ position: 'relative', height: 14, background: 'var(--panel-3)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', top: 1, bottom: 1, left: 0,
                  width: `${Math.min((d.peak_depth_m / 0.30) * 100, 100)}%`,
                  background: `color-mix(in srgb, ${sc} 55%, transparent)`,
                  borderRadius: 3,
                }} />
                {/* 活跃站标记 */}
                {d.active_station_count > 0 && (
                  <span style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 9, color: 'var(--ink-4)',
                  }}>{d.active_station_count} 站</span>
                )}
              </div>

              {/* 事件构成 + 退水中位 */}
              <div style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontWeight: 700, color: hasObs ? 'var(--accent-2)' : 'var(--ink-4)' }}>
                  {hasObs ? `${d.median_recession_hours}h` : '—'}
                </span>
                <span style={{ color: 'var(--ink-4)', fontSize: 10 }}>
                  事件 {ec.completed ?? 0}✓{censored > 0 ? ` ${censored}?` : ''}
                </span>
              </div>

              {/* 恢复评分 */}
              <span
                className="chip"
                style={{
                  fontSize: 10, padding: '1px 8px', justifyContent: 'center',
                  color: hasObs ? (d.recovery_score >= 0.5 ? 'var(--ok)' : 'var(--warn)') : 'var(--ink-4)',
                }}
              >
                {hasObs ? `恢复 ${d.recovery_score}` : '无事件'}
              </span>
            </div>
          )
        })}
      </div>

      {/* 福田删失事件说明 */}
      {futian?.censored_details?.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warn)' }}>⚠ 未退净/缺测事件（退水时间未知，不计入统计）</span>
          {futian.censored_details.map((c, i) => (
            <span key={i} style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
              {c.station_name}：峰值 {c.peak_depth_m}m · 末次观测 {c.last_depth_m}m（{(c.last_time || '').slice(5, 16)}）
              {c.status === 'right_censored' ? ' · 窗口末端仍有积水' : ' · 后续缺测'}
            </span>
          ))}
        </div>
      )}

      <div style={{ padding: '0 14px 12px' }}>
        <p className="footnote">
          严重度 = 观测峰值积水深度；退水 = 已退净（completed）事件中「峰值→降至 0.02m 以下」的小时数中位数。
          事件按站切分：✓ 已退净，? 未退净（窗口末端删失）或缺测，后者退水未知、绝不外推。
          两指标独立呈现：福田等高密度建成区常见「峰值明显但 1-2 小时内退净」的模式，同时个别点位可能在观测窗口末端仍在积水——naive 排名会把这类删失误判为"恢复最慢"。
          本面板为<b>观测层</b>，不含管网管径/坡度/泵曲线，不替代 SWMM 水力模型。
        </p>
      </div>
    </div>
  )
}
