import { useState } from 'react'
import { postDispatch, getAlerts, levelColor } from '../api'

export default function DispatchPanel({ sim, loading }) {
  const [recorded, setRecorded] = useState(null)
  const [history, setHistory] = useState([])
  const alerts = sim?.alerts || []

  async function saveAdvisories() {
    const res = await postDispatch({
      simulation_run_id: sim.simulation_run_id,
    })
    setRecorded(res)
    const a = await getAlerts()
    setHistory(a.alerts)
  }

  return (
    <div className="card dispatch">
      <div className="card-h">
        研究情景 · 处置建议草案
        <span className="hint">{alerts.length} 条可保存</span>
      </div>

      {alerts.length === 0 && (
        <div className="empty">当前情景无达到预警级别（高/极高）的片区。</div>
      )}

      <div className="alerts">
        {alerts.map((a, i) => (
          <div className="alert-item" key={i} style={{ borderLeftColor: levelColor(a.severity) }}>
            <div className="ai-head">
              <span className="sev" style={{ background: levelColor(a.severity) }}>
                {a.severity_label}
              </span>
              {a.district}
              <span className="ai-time">{a.time}</span>
            </div>
            <div className="ai-msg">{a.message}</div>
            <div className="ai-channels">输出范围：{(a.channels || []).join(' / ') || '研究界面'}，不对外发送</div>
            <ul className="ai-actions">
              {(a.actions || []).map((ac, j) => (
                <li key={j}>{ac}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <button className="push-btn" disabled={loading} onClick={saveAdvisories}>
          保存研究建议（仅本地记录）
        </button>
      )}

      {recorded && (
        <div className="push-ok">
          已保存 {recorded.recorded} 条研究建议；未对外发送。
          {recorded.record_failed > 0 ? ` ${recorded.record_failed} 条本地记录失败。` : ''}
        </div>
      )}

      {history.length > 0 && (
        <div className="hist">
          <div className="hist-h">研究建议记录（最近 5 条）</div>
          {history.slice(-5).reverse().map((h, i) => (
            <div key={i} className="hist-item">
              {h.district} · {h.severity_label} · {h.time}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
