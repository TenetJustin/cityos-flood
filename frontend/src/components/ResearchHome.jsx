import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchJSON } from '../api'
import './research-home.css'

const PHENOMENA = [
  ['rainfall', '降雨'], ['tide_level', '潮位'], ['river_level', '河流水位'],
  ['flood_depth', '积水深度'], ['road_closure', '道路中断'],
]
const STATUS = { current: '近期记录', stale: '记录已过时', degraded: '覆盖不完整', unavailable: '缺失数据' }
const formatDate = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
const displayValue = item => item.phenomenon === 'road_closure'
  ? (item.maximum ? '有中断记录' : '无中断记录')
  : `${Number(item.mean).toFixed(2)} ${item.unit}`

export default function ResearchHome() {
  const [cities, setCities] = useState(null)
  const [sources, setSources] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [selected, setSelected] = useState('shanghai')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [cityData, sourceData, snapshotData] = await Promise.all([
        fetchJSON('/api/region/cities'),
        fetchJSON('/api/realtime/sources'),
        fetchJSON('/api/realtime/snapshot'),
      ])
      setCities(cityData)
      setSources(sourceData)
      setSnapshot(snapshotData)
      setError('')
    } catch (cause) {
      setError(`研究接口暂不可用：${cause.message}`)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  const city = cities?.cities?.find(item => item.id === selected)
  const citySources = sources?.sources?.filter(item => item.city_id === selected) || []
  const summaries = useMemo(() => snapshot?.summaries?.filter(item => item.city_id === selected) || [], [snapshot, selected])
  const byPhenomenon = Object.fromEntries(summaries.map(item => [item.phenomenon, item]))
  const covered = snapshot?.summaries?.length || 0
  const eligible = sources?.eligible_realtime_source_count || 0

  return <div className="research-home">
    <section className="research-hero">
      <div className="research-kicker">SOUTHEAST CHINA / URBAN FLOOD RESILIENCE</div>
      <div className="research-hero-row">
        <div>
          <h2>从证据出发，理解五城内涝。</h2>
          <p>汇集降雨、潮位、河流与积水记录，追踪它们何时被观测、何时真正可用。这里展示研究证据与缺口，不发布公众预警，也不自动调度。</p>
        </div>
        <button className="research-refresh" onClick={refresh} disabled={loading}>{loading ? '读取中…' : '↻ 刷新数据'}</button>
      </div>
      <div className="research-hero-metrics">
        <div><strong>05</strong><span>研究城市</span></div>
        <div><strong>{covered} / 25</strong><span>有描述性记录的城市 × 现象</span></div>
        <div><strong>{eligible}</strong><span>通过核验的实时来源</span></div>
        <div><strong>{snapshot?.stored_record_count ?? '—'}</strong><span>已接收记录</span></div>
      </div>
    </section>

    {error && <div className="research-error" role="alert">{error}。当前无法确认数据状态，请检查后端连接。</div>}
    <div className="research-grid">
      <section className="research-panel city-panel">
        <div className="research-section-label">01 / 研究区域</div>
        <h3>五座城市，不同的致涝背景</h3>
        <div className="research-city-list">
          {(cities?.cities || []).map((item, index) => {
            const status = snapshot?.city_status?.[item.id] || 'unavailable'
            return <button key={item.id} className={`research-city ${selected === item.id ? 'selected' : ''}`} onClick={() => setSelected(item.id)}>
              <span className="research-city-index">0{index + 1}</span>
              <span className="research-city-name"><b>{item.name}</b><small>{item.form}</small></span>
              <span className={`research-state ${status}`}>{STATUS[status] || status}</span>
            </button>
          })}
          {!cities && <p className="research-empty">城市目录尚未载入。</p>}
        </div>
      </section>

      <section className="research-panel evidence-panel">
        <div className="research-section-label">02 / 观测切片</div>
        <div className="research-evidence-head"><div><h3>{city?.name || '城市'} · 数据覆盖</h3><p>{city?.drivers?.join(' · ') || '等待城市目录'}</p></div><span className="research-mode">描述性分析</span></div>
        <div className="research-observation-list">
          {PHENOMENA.map(([key, label]) => {
            const item = byPhenomenon[key]
            return <div className="research-observation" key={key}>
              <div><span>{label}</span><small>{item ? `${item.station_count} 站点 · ${item.record_count} 记录` : '尚无可用观测'}</small></div>
              <div className="research-observation-value"><b>{item ? displayValue(item) : '缺失'}</b><small>{item ? `观测 ${formatDate(item.latest_observed_at)}` : '不以零值补齐'}</small></div>
            </div>
          })}
        </div>
        <p className="research-fineprint">统计值仅描述已接收记录，不代表全市情况；过时、疑似及未验证来源不可用于模型同化。</p>
      </section>
    </div>

    <div className="research-grid lower">
      <section className="research-panel">
        <div className="research-section-label">03 / 来源与可用性</div>
        <h3>数据来源审计</h3>
        <p className="research-intro">候选来源不等于已接入。只有访问、字段映射、许可、可获得时间与适配器均核验后，才可能升级为合格实时来源。</p>
        <div className="research-source-list">
          {citySources.map(source => <div className="research-source" key={source.source_id}>
            <div><b>{source.source_name}</b><small>{source.publisher} · {source.entry_type === 'portal_lead' ? '门户线索' : '数据集候选'}</small></div>
            <span>{source.realtime_observation_eligible ? '已核验' : '未核验'}</span>
          </div>)}
          {!citySources.length && <p className="research-empty">尚无该城市的来源记录。</p>}
        </div>
      </section>
      <section className="research-panel governance-panel">
        <div className="research-section-label">04 / 使用边界</div>
        <h3>研究产品，不是预警系统</h3>
        <div className="research-rule"><b>真实观测</b><span>必须保留来源、许可、空间基准、单位、质量和四类时间信息。</span></div>
        <div className="research-rule"><b>历史记录</b><span>仅用于事件复盘；证据不完整时回测不得标记通过。</span></div>
        <div className="research-rule"><b>模型推断 / 模拟情景</b><span>与实测数据分开展示；实验页面中的数值不能当作实时事实。</span></div>
        <div className="research-rule"><b>缺失数据</b><span>明确标注，不填零、不用演示值替代。</span></div>
        <p className="research-boundary">模型版本变更需回测、安全检查和人工批准。当前公众预警与自动调度能力均为关闭状态。</p>
      </section>
    </div>
    <section className="research-panel research-event">
      <div>
        <div className="research-section-label">05 / 历史事件复盘</div>
        <h3>深圳 2023 年“9·7”极端暴雨</h3>
        <p>目前是端到端候选事件，而非完成回测的样例。官方事后资料可用于核对事件背景；当时可获得的逐站观测、独立积水测量和原始预报版本尚未取得。</p>
      </div>
      <div className="research-event-gaps">
        <span>历史记录：已定位</span><span>独立观测真值：缺失</span><span>预报原始版本：缺失</span><span>居民行为样本：未收集</span>
      </div>
    </section>
    <footer className="research-footer">研究数据时区 Asia/Shanghai (UTC+08:00) · 视图时间 {formatDate(snapshot?.as_of)} · 数据类别：{snapshot?.intake_label === 'contributed_unverified' ? '外部提交，未独立核验' : '未接入'}</footer>
  </div>
}
