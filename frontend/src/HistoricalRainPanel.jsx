import { useEffect, useState } from 'react'
import { assessHistoricalRain } from './zhejiangHistoricalRain.js'
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
  return <section className="zo-card zh-rain-panel">
    <div className="zh-rain-heading"><div><small>HISTORICAL / 降雨资料切片</small><h2>2021 年 7 月 20—28 日 · 浙江站点</h2></div><span>历史记录 · 逐日报文汇总</span></div>
    <p className="zh-rain-intro">NOAA GHCN-Daily 的站点降水。杭州有本地站日值；定海、大陈岛、瑞安分别仅作宁波、台州、温州的区域参照。温州本地站在此时段缺失。不是城区积水或居民影响真值。</p>
    {state === 'loading' && <div className="zh-rain-empty">历史降雨读取中…</div>}
    {state === 'unavailable' && <div className="zh-rain-empty">历史降雨不可用：{issue}</div>}
    {state === 'ok' && <><div className="zh-rain-tabs" aria-label="选择历史降雨站点">{stations.map((item) => <button key={item.station_id} type="button" aria-pressed={selected?.station_id === item.station_id} className={selected?.station_id === item.station_id ? 'active' : ''} onClick={() => setSelectedId(item.station_id)}><strong>{NAME[item.city_id]} · {item.station_name}</strong><span>{item.coverage_days} / 9 日</span></button>)}</div>
      {selected && <><div className="zh-rain-station"><strong>{selected.station_name} · {selected.station_id}</strong><span>{selected.relation === 'regional_proxy' ? '区域参照站' : '城市站'} · 距示意中心 {selected.distance_to_city_centre_km} km · EPSG:4326</span></div>
        <div className="zh-rain-chart" role="img" aria-label={`${NAME[selected.city_id]}所用${selected.station_name}站 2021 年 7 月 20 至 28 日逐日降雨柱状图，缺失以空柱标示`}>
          {selected.daily.map((day) => <div className="zh-rain-day" key={day.date}><div className="zh-rain-value">{day.precip_mm == null ? '缺失' : `${day.precip_mm} mm`}</div><div className="zh-rain-track"><span className={day.precip_mm == null ? 'missing' : ''} style={{ height: day.precip_mm == null ? '3px' : `${Math.max(3, day.precip_mm / max * 100)}%` }}/></div><small>{day.date.slice(-2)}</small></div>)}
        </div><div className="zh-rain-axis">日期为 GHCN 日标签；精确本地累计时间窗未核实 · 单位 mm</div>
        <div className="zh-rain-source"><a href={selected.source_url} target="_blank" rel="noreferrer">原始站点文件 ↗</a><a href={snapshot.source.documentation_url} target="_blank" rel="noreferrer">字段与质量说明 ↗</a><span>文件 SHA-256 {selected.source_sha256.slice(0, 12)}…</span></div></>}
      <p className="zh-rain-boundary">来源标记 S：由逐时天气报文汇总，NOAA 提醒降雨值可能与真实逐日值显著不同。单条记录当时可获得时间未知（available_at = null）；不可用于 as-of 预测回测。无城区积水和实际行动记录。{snapshot.source.citation_url && <a href={snapshot.source.citation_url} target="_blank" rel="noreferrer">GHCN-Daily 引用 ↗</a>}</p>
    </>}
  </section>
}
