import { useEffect, useState } from 'react'
import { ZHEJIANG_CITIES } from './zhejiangData.js'
import { assessForecastSnapshot, cityForecast, forecastDisplayStatus } from './zhejiangForecast.js'
import './zhejiangForecastPanel.css'

const bjt = (value) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'

export default function ZhejiangForecastPanel({ city }) {
  const [snapshot, setSnapshot] = useState(null)
  const [state, setState] = useState('loading')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let active = true
    const load = () => fetch(`${import.meta.env.BASE_URL}data/zhejiang-weather-forecast.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => { if (!active) return; const audit = assessForecastSnapshot(data); setSnapshot(audit.valid ? data : null); setState(audit.valid ? 'ok' : 'invalid') })
      .catch(() => { if (active) { setSnapshot(null); setState('unavailable') } })
    load()
    const refresh = setInterval(load, 15 * 60_000)
    const clock = setInterval(() => setNow(Date.now()), 5 * 60_000)
    return () => { active = false; clearInterval(refresh); clearInterval(clock) }
  }, [])
  const display = state === 'ok' ? forecastDisplayStatus(snapshot, now) : state
  const cities = city ? [city] : ZHEJIANG_CITIES
  return <section className="zo-card zf-panel"><div className="zf-heading"><div><small>WEATHER MODEL / 公开预报</small><h2>{city ? city.name : '四城'}降雨模式格点</h2></div><span className={`zf-state zf-state-${display}`}>{display === 'current' ? '可用 · 模型推断' : display === 'stale' ? '起报已过期' : display === 'loading' ? '读取中' : '不可用'}</span></div>
    {display === 'current' ? <><div className="zf-meta"><span>ECMWF IFS · 0.25°</span><span>起报 {bjt(snapshot.model_run_at)} 北京时间</span><span>本次快照取得 {bjt(snapshot.available_at)}</span><a href={snapshot.source.url} target="_blank" rel="noreferrer">来源与 CC BY 4.0 ↗</a></div><div className="zf-table-wrap"><table className="zf-table"><thead><tr><th>城市中心最近格点</th><th>+6 h</th><th>+12 h</th><th>+24 h</th><th>+48 h</th><th>+72 h</th></tr></thead><tbody>{cities.map((item) => { const record = cityForecast(snapshot, item.id); return <tr key={item.id}><th>{item.name}<small>距离 {record.grid_distance_km} km · 非城区精细值</small></th>{record.values.map((value) => { const expired = Date.parse(value.valid_at) <= now; return <td key={value.lead_hours} className={expired ? 'zf-expired' : ''}><strong>{expired ? '—' : value.cumulative_precip_mm.toFixed(1)}</strong><small>{expired ? '已过有效时刻' : `mm 累计至 ${bjt(value.valid_at)}`}</small></td> })}</tr> })}</tbody></table></div></> : <div className="zf-empty">{display === 'stale' ? `最近快照起报为 ${bjt(snapshot.model_run_at)}，超过 24 小时；旧预报数值已隐藏。` : display === 'loading' ? '正在读取公开天气模式快照…' : '公开天气模式快照未取得或未通过时序、空间、单位校验；不显示数值。'}</div>}
    <p className="zf-boundary">数值是同一次起报的累计降雨天气预报，不是雨量站观测、城区雨量实况或内涝预测。正式产品发布时间未核实；available_at 只表示本次快照取得时间，不是产品首次公开时间。不能据此发布公众预警。</p>
  </section>
}
