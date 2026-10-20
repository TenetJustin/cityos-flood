import { useEffect, useState } from 'react'
import { assessSynopticRain } from './zhejiangSynopticRain.js'
import './synopticRainPanel.css'

const NAME = { hangzhou: '杭州', ningbo: '宁波', taizhou: '台州', wenzhou: '温州' }
const CLOCK = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export default function SynopticRainPanel({ city }) {
  const [snapshot, setSnapshot] = useState(null)
  const [state, setState] = useState('loading')
  const [issue, setIssue] = useState('')
  const [selectedId, setSelectedId] = useState('')
  useEffect(() => {
    let active = true
    fetch(`${import.meta.env.BASE_URL}data/zhejiang-synoptic-rain-2021.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => {
        if (!active) return
        const result = assessSynopticRain(data)
        if (!result.valid) throw new Error(`资料未通过校验：${result.issues.join('、')}`)
        setSnapshot(data); setState('ok')
      })
      .catch((error) => { if (active) { setState('unavailable'); setIssue(error.message) } })
    return () => { active = false }
  }, [])
  const stations = (snapshot?.stations || []).filter((item) => !city || item.city_id === city.id)
  const selected = stations.find((item) => item.station_id === selectedId) || stations.find((item) => item.coverage_slots > 0) || stations[0]
  const height = 110
  const max = selected ? Math.max(10, ...selected.slots.map((slot) => slot.precip_6h_mm ?? 0)) : 10
  return <section className="zo-card zh-synoptic-panel">
    <div className="zh-rain-heading"><div><small>HISTORICAL / 站点时序</small><h2>6 小时累计降雨 · 2021 年 7 月 20—28 日（UTC）</h2></div><span>事后档案 · 不代表实时</span></div>
    <p className="zh-rain-intro">NOAA GHCNh 的 FM12/SYNOP 报文，以 3 小时间隔显示有质量标记的 6 小时累计值。相邻时间窗重叠，不可相加或当作逐小时降雨。时间点按北京时间显示，原始时间为 UTC。</p>
    {state === 'loading' && <div className="zh-rain-empty">站点时序读取中…</div>}
    {state === 'unavailable' && <div className="zh-rain-empty">站点时序不可用：{issue}</div>}
    {state === 'ok' && <>
      {stations.length > 0 ? <><div className="zh-rain-tabs" aria-label="选择六小时降雨站点">{stations.map((item) => <button key={item.station_id} type="button" aria-pressed={selected?.station_id === item.station_id} className={selected?.station_id === item.station_id ? 'active' : ''} onClick={() => setSelectedId(item.station_id)}><strong>{NAME[item.city_id]} · {item.station_name}</strong><span>{item.coverage_slots} / 72 时点</span></button>)}</div>
        {selected && <><div className="zh-rain-station"><strong>{selected.station_name} · {selected.station_id}</strong><span>{selected.relation === 'regional_proxy' ? '区域参照站' : '城市站'} · 距示意中心 {selected.distance_to_city_centre_km} km · EPSG:4326</span></div>
          <div className="zh-synoptic-chart-scroll"><svg className="zh-synoptic-chart" viewBox="0 0 936 142" role="img" aria-label={`${NAME[selected.city_id]}${selected.station_name}站 72 个三小时间隔的六小时累计降雨值。质量可疑和无记录时点留空。`}>
            <line x1="0" y1="116" x2="936" y2="116" stroke="rgba(184,224,213,.35)" />
            {selected.slots.map((slot, index) => {
              const x = 5 + index * 13
              const value = slot.precip_6h_mm
              const bar = value === null ? 3 : Math.max(2, value / max * height)
              const label = `${CLOCK.format(new Date(slot.observed_at))} 北京时间：${value === null ? (slot.quality_code === '2' ? '质控可疑，数值屏蔽' : '无可用记录') : `${value} mm / 6 小时`}`
              return <rect key={slot.observed_at} x={x} y={116 - bar} width="8" height={bar} rx="1" fill={value === null ? '#977c73' : '#a7d8bd'}><title>{label}</title></rect>
            })}
            {selected.slots.filter((_, index) => index % 8 === 0).map((slot, index) => <text key={slot.observed_at} x={5 + index * 104} y="136" fill="#91aaa3" fontSize="10">{CLOCK.format(new Date(slot.observed_at)).slice(0, 5)}</text>)}
          </svg></div>
          <div className="zh-synoptic-meta"><span>有效 {selected.coverage_slots}/72</span><span>质控可疑 {selected.slots.filter((slot) => slot.quality_code === '2').length}</span><span>最大有效报文值 {Math.max(0, ...selected.slots.map((slot) => slot.precip_6h_mm ?? 0))} mm / 6h</span></div>
          <div className="zh-rain-source"><a href={selected.source_url} target="_blank" rel="noreferrer">原始站点文件 ↗</a><a href={snapshot.source.documentation_url} target="_blank" rel="noreferrer">NOAA 字段与质控 ↗</a><span>档案取得 {snapshot.retrieved_at} · SHA-256 {selected.source_sha256.slice(0, 12)}… · {snapshot.source.license}</span></div></>}
      </> : <div className="zh-rain-empty">{NAME[city?.id] || '当前城市'}在此时段没有已准入的 GHCNh 6 小时降雨站点；不可从其他城市补算。</div>}
      <p className="zh-rain-boundary">宁波本地 Lishe 站与温州本地站在该时间窗没有可用的 6 小时降雨值；定海、瑞安仅为区域参照。台州无已准入站点。单条报文在事件当时的可获得时间未知（available_at = null），不能用于 as-of 回测；没有城区积水或居民行动真值。</p>
    </>}
  </section>
}
