import { useEffect, useState } from 'react'
import { assessHistoricalRain } from './zhejiangHistoricalRain.js'
import SynopticRainPanel from './SynopticRainPanel.jsx'
import './historicalRainPanel.css'

const NAME = { ningbo: '宁波', taizhou: '台州', wenzhou: '温州', hangzhou: '杭州' }

export default function HistoricalRainPanel({ city }) {
  const [snapshot, setSnapshot] = useState(null)
  const [state, setState] = useState('loading')
  const [issue, setIssue] = useState('')
  const [selectedId, setSelectedId] = useState('')
  useEffect(() => {
    let active = true
    fetch(`${import.meta.env.BASE_URL}data/zhejiang-historical-rain-2021.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => {
        if (!active) return
        const assessment = assessHistoricalRain(data)
        if (!assessment.valid) throw new Error(`快照未通过校验：${assessment.issues.join('、')}`)
        setSnapshot(data); setState('ok')
      })
      .catch((error) => { if (active) { setState('unavailable'); setIssue(error.message) } })
    return () => { active = false }
  }, [])
  const stations = (snapshot?.stations || []).filter((item) => !city || item.city_id === city.id)
  const selected = stations.find((item) => item.station_id === selectedId) || stations[0]
  const max = selected ? Math.max(10, ...selected.daily.map((day) => day.precip_mm ?? 0)) : 10
  return <><section className="zo-card zh-rain-panel">
    <div className="zh-rain-heading"><div><small>HISTORICAL / 降雨资料切片</small><h2>2021 年 7 月 20—28 日 · 浙江站点</h2></div><span>历史</span></div>
    {state === 'loading' && <div className="zh-rain-empty">历史降雨读取中…</div>}
    {state === 'unavailable' && <div className="zh-rain-empty">历史降雨不可用：{issue}</div>}
    {state === 'ok' && <><div className="zh-rain-tabs" aria-label="选择历史降雨站点">{stations.map((item) => <button key={item.station_id} type="button" aria-pressed={selected?.station_id === item.station_id} className={selected?.station_id === item.station_id ? 'active' : ''} onClick={() => setSelectedId(item.station_id)}><strong>{NAME[item.city_id]} · {item.station_name}</strong><span>{item.coverage_days} / 9 日</span></button>)}</div>
      {selected && <><div className="zh-rain-station"><strong>{selected.station_name} · {selected.station_id}</strong><span>{selected.coverage_days} / 9 日</span></div>
        <div className="zh-rain-chart" role="img" aria-label={`${NAME[selected.city_id]}所用${selected.station_name}站 2021 年 7 月 20 至 28 日逐日降雨柱状图，缺失以空柱标示`}>
          {selected.daily.map((day) => <div className="zh-rain-day" key={day.date}><div className="zh-rain-value">{day.precip_mm == null ? '缺失' : `${day.precip_mm} mm`}</div><div className="zh-rain-track"><span className={day.precip_mm == null ? 'missing' : ''} style={{ height: day.precip_mm == null ? '3px' : `${Math.max(3, day.precip_mm / max * 100)}%` }}/></div><small>{day.date.slice(-2)}</small></div>)}
        </div><div className="zh-rain-axis">单位 mm</div></>}
    </>}
  </section><SynopticRainPanel city={city}/></>
}
