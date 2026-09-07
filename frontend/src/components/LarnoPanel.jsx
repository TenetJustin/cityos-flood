import { useEffect, useState } from 'react'
import { getLarnoSummary } from '../api'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ZAxis, ReferenceLine, Cell,
} from 'recharts'

/**
 * LarnoPanel — 福田物理基准（LarNO · MIKE+ 80 场事件）
 *
 * 数据：HuggingFace holmescao/LarNO-dataset（MIT），福田 ~100km²、20m/5min，
 * 标签由 MIKE+ 含真实管网的物理求解器生成（管网保密未发布，但其效应体现在水深场中）。
 *
 * 本面板回答用户的核心问题：福田是否「内涝严重但排水非常快」？
 * - 严重度 = 事件峰值水深（m）与 >15cm 淹没占比
 * - 退水速率 = 雨停后 >15cm 淹没面积每 5 分钟缩减百分比（窗口受限，只报速率不外推）
 */
const TIP = { background: 'var(--chart-tip-bg)', border: '1px solid var(--chart-tip-border)', borderRadius: 8, fontSize: 12, color: 'var(--ink)' }
const AXIS = { stroke: 'var(--chart-text)', fontSize: 11 }

function EventTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const e = payload[0].payload
  return (
    <div style={TIP}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{e.event}</div>
      <div>峰值水深 <b>{e.peak_depth_m}m</b></div>
      <div>&gt;15cm 淹没 <b>{e.actionable_pct}%</b></div>
      <div>雨量 <b>{e.rain_total_mm}mm</b>（峰值 {e.rain_peak_mm_h}mm/h）</div>
      <div>退水速率 <b>{e.decay ?? '窗口不足'}{e.decay != null ? '%/5min' : ''}</b></div>
    </div>
  )
}

export default function LarnoPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getLarnoSummary().then(setData).catch((e) => setErr(e.message))
  }, [])

  if (err) return null
  if (!data) return null

  const events = (data.events || []).map((e) => ({
    event: e.event,
    peak_depth_m: e.severity.peak_depth_m,
    actionable_pct: e.severity.peak_actionable_pct,
    rain_total_mm: e.rainfall.total_mm,
    rain_peak_mm_h: e.rainfall.peak_mm_h,
    decay: e.recession.actionable_area_decay_pct_per_5min,
    observable: e.recession.observable,
  })).filter((e) => e.peak_depth_m > 0)

  if (!events.length) return null

  const svr = data.severity_vs_recession
  const chartData = events.filter((e) => e.observable)

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-h">
        🧪 福田物理基准 · 严重度 × 退水速率（LarNO / MIKE+）
        <span className="hint">{data.events_available}/{data.events_total} 场事件 · 20m/5min · MIT · 管网保密但效应在模拟中</span>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--line-soft)' }}>
        <span className="chip" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)' }}>
          中位峰值水深 {svr.median_peak_depth_m}m（最大 {svr.max_peak_depth_m}m）
        </span>
        <span className="chip">
          &gt;15cm 淹没中位 {svr.median_actionable_pct}%
        </span>
        <span className="chip ok">
          雨后退水速率中位 {svr.median_decay_pct_per_5min}%/5min
        </span>
        <span className="chip" style={{ color: 'var(--accent-2)', borderColor: 'color-mix(in srgb, var(--accent-2) 40%, transparent)' }}>
          {svr.observable_event_count} 场可测退水
        </span>
      </div>

      {/* 结论卡 */}
      <div style={{ padding: '10px 14px', background: 'var(--panel-2)', fontSize: 12.5, lineHeight: 1.7, borderBottom: '1px solid var(--line-soft)' }}>
        <b style={{ color: 'var(--accent-2)' }}>福田模式（物理模拟证实）：</b>
        {data.futian_pattern.statement}。
        该结论来自含<b>真实福田排水管网</b>的 MIKE+ 水动力模拟，是物理基准而非经验参数化——
        直接支持现场「内涝严重但排水非常快」的经验观察。
      </div>

      {/* 散点图：峰值水深 vs 退水速率 */}
      <div style={{ height: 260, padding: '8px 12px' }}>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 20, bottom: 4, left: -8 }}>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
              <XAxis
                type="number" dataKey="peak_depth_m" name="峰值水深" unit="m"
                {...AXIS} tickLine={false} axisLine={false}
                label={{ value: '事件峰值水深 (m)', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--ink-4)' }}
              />
              <YAxis
                type="number" dataKey="decay" name="退水速率" unit="%/5min"
                {...AXIS} tickLine={false} axisLine={false} width={52}
                label={{ value: '退水速率 (%/5min)', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--ink-4)' }}
              />
              <ZAxis type="number" dataKey="rain_total_mm" range={[40, 220]} name="总雨量" />
              <Tooltip content={<EventTooltip />} />
              <ReferenceLine
                y={svr.median_decay_pct_per_5min}
                stroke="var(--accent-2)" strokeDasharray="4 3"
                label={{ value: '中位', fontSize: 9, fill: 'var(--accent-2)', position: 'right' }}
              />
              <Scatter data={chartData}>
                {chartData.map((e, i) => (
                  <Cell
                    key={i}
                    fill={e.peak_depth_m >= 2.0 ? '#d6452a' : e.peak_depth_m >= 1.0 ? '#e08a1e' : '#2dd4bf'}
                    fillOpacity={0.72}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="footnote" style={{ padding: 14 }}>
            可测退水事件不足（模拟窗口在雨停后很快结束）；事件仍在批量下载中，稍后刷新。
          </div>
        )}
      </div>

      <div style={{ padding: '0 14px 12px' }}>
        <p className="footnote">
          每点=1 场事件，点大小=总雨量，颜色=严重度（红≥2m / 橙≥1m / 青&lt;1m）。
          标签为 MIKE+ 物理模拟输出（含真实管网效应），非实测水位；
          6h 模拟窗口在雨停后 ~35min 结束，故退水以<b>速率</b>报告、不外推完全退干时间。
          管网几何本身保密未随数据集发布（LarNO, J. Hydrology 2026, MIT）。
        </p>
      </div>
    </div>
  )
}
