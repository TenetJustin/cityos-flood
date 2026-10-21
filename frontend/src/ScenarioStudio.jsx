import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import { Link } from 'react-router-dom'
import { CITY_CHECKS } from './zhejiangData.js'
import { behaviorSensitivityCases, evaluateScenario, HAZARD_LABELS, LEVEL_LABELS, SCENARIO_DEFAULTS, SCENARIO_MODEL_VERSION, scenarioComparisonRows, scenarioPlanMarkdown, validBeijingLocal, weatherDriverIssue } from './scenarioWorkbench.js'
import { assessForecastSnapshot, forecastRainWindow } from './zhejiangForecast.js'
import { persistDrafts, persistScenarios, readDraftState, readScenarioState, upsertDraft } from './scenarioDrafts.js'
import './scenarioStudio.css'

const DRAFT_KEY = 'cityos-zhejiang-plan-drafts-v1' // Legacy notes only; never overwrite this storage key.
const beijingLocalNow = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16)
const beijingLocalFromIso = (value) => new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 16)
const beijingDisplay = (value) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))

function readStored(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

function Field({ label, unit, value, onChange, min, max, step = 1 }) {
  return <label className="zs-field"><span>{label}</span><div className="zs-number"><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} /><small>{unit}</small></div></label>
}

function SelectField({ label, value, onChange, options }) {
  return <label className="zs-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
}

export function BehaviorFlow({ result }) {
  const total = result.input.exposedPeople
  const colours = result.behaviour.map((item) => item.color)
  return <div className="zs-flow-wrap">
    <svg className="zs-flow" viewBox="0 0 700 300" role="img" aria-label={`假设人群 ${total} 人的规则分流图：${result.behaviour.map((item) => `${item.label}${item.count}人`).join('，')}`}>
      <defs><linearGradient id="zs-source" x2="1" y2="1"><stop stopColor="#243f48"/><stop offset="1" stopColor="#142831"/></linearGradient></defs>
      <rect x="14" y="103" width="180" height="92" rx="14" fill="url(#zs-source)" stroke="#a5dbc7" strokeOpacity=".45"/>
      <text x="34" y="135" fill="#a5c5bd" fontSize="13">假设人群</text><text x="34" y="173" fill="#ebf7f1" fontSize="29" fontWeight="700">{total.toLocaleString('zh-CN')} <tspan fontSize="13">人</tspan></text>
      {result.behaviour.map((item, index) => {
        const y = 20 + index * 72
        const width = total > 0 ? 3 + (item.count / total) * 28 : 3
        return <g key={item.id}>
          {item.count > 0 && <path d={`M 195 149 C 300 149, 340 ${y + 23}, 448 ${y + 23}`} stroke={colours[index]} strokeWidth={width} strokeOpacity=".36" fill="none"/>}
          <rect x="446" y={y} width="239" height="50" rx="9" fill="#172d35" stroke={colours[index]} strokeOpacity=".45"/>
          <rect x="446" y={y} width="5" height="50" rx="2" fill={colours[index]}/>
          <text x="464" y={y + 22} fill="#c4dcd7" fontSize="12">{item.label}</text>
          <text x="464" y={y + 39} fill="#eff9f4" fontSize="13" fontWeight="700">{item.count.toLocaleString('zh-CN')} 人</text>
        </g>
      })}
    </svg>
  </div>
}

export function BehaviorSensitivity({ result }) {
  const cases = behaviorSensitivityCases(result)
  const total = result.input.exposedPeople
  return <div className="zs-sensitivity">
    <h3>响应条件敏感性</h3>
    <div className="zs-sensitivity-legend">{result.behaviour.map((item) => <span key={item.id}><i style={{ backgroundColor: item.color }}/>{item.label}</span>)}</div>
    {cases.map((item) => <div className="zs-sensitivity-case" key={item.id}>
      <div className="zs-sensitivity-case-heading"><strong>{item.label}</strong><span>提前 {item.input.warningLeadHours} h · 道路 {item.input.roadOpenPct}% · 容量 {item.input.shelterCapacity} 人</span></div>
      <div className="zs-sensitivity-bar" role="img" aria-label={`${item.label}：${item.result.behaviour.map((part) => `${part.label} ${part.count} 人`).join('，')}`}>
        {item.result.behaviour.map((part) => <span key={part.id} style={{ width: `${total ? part.count / total * 100 : 0}%`, backgroundColor: part.color }}/>)}</div>
      <small>{item.result.behaviour.map((part) => `${part.label} ${part.count} 人`).join(' · ')}</small>
    </div>)}
  </div>
}

function ScenarioCityMap({ city, result }) {
  const ratio = result.pressure / Math.max(1, result.pressureMax)
  const tone = ratio >= .75 ? '#b46f78' : ratio >= .5 ? '#d19a58' : ratio >= .25 ? '#7fa6c9' : '#6b9b8f'
  const radius = 18 + Math.round(ratio * 18)
  return <section className="zo-card zs-city-map-card"><div className="zs-heading"><div><small>SCENARIO MAP / 二维情景图</small><h2>{city.name}核查压力示意</h2></div><span className="zs-tag">演示</span></div><div className="zs-city-map" aria-label={`${city.name}市域定位及核查压力示意，规则压力 ${result.pressure} / ${result.pressureMax}`}><MapContainer center={city.center} zoom={8} scrollWheelZoom zoomControl><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'/><CircleMarker center={city.center} radius={radius} pathOptions={{ color: tone, weight: 3, fillColor: tone, fillOpacity: .2 }}><Tooltip>{city.name} · {result.priority} · 规则压力 {result.pressure}/{result.pressureMax}</Tooltip></CircleMarker><CircleMarker center={city.center} radius={5} pathOptions={{ color: '#fff', weight: 2, fillColor: '#4f6d8a', fillOpacity: 1 }}><Tooltip>{city.name}城市定位点</Tooltip></CircleMarker></MapContainer><span className="zs-map-label">{city.name} · {result.priority}</span></div></section>
}

export function ResidentBehaviorPanel({ city }) {
  const [inputs, setInputs] = useState({ ...SCENARIO_DEFAULTS })
  const result = useMemo(() => evaluateScenario(inputs), [inputs])
  const change = (key, value) => setInputs((current) => ({ ...current, [key]: Math.max(0, Math.min(key === 'exposedPeople' || key === 'shelterCapacity' ? 200000 : key === 'warningLeadHours' ? 72 : 100, Number(value) || 0)) }))
  return <div className="zs-stack">
    <section className="zo-card"><div className="zs-heading"><div><small>BEHAVIOUR / 规则假设</small><h2>{city.name} · 居民行为规则示意</h2></div><span className="zs-tag">演示</span></div>
      <div className="zs-grid"><Field label="假设人群" unit="人" value={inputs.exposedPeople} min="0" max="200000" onChange={(v) => change('exposedPeople', v)}/><Field label="预警提前量" unit="小时" value={inputs.warningLeadHours} min="0" max="72" onChange={(v) => change('warningLeadHours', v)}/><Field label="道路可用比例" unit="%" value={inputs.roadOpenPct} min="0" max="100" onChange={(v) => change('roadOpenPct', v)}/><Field label="避险点假设容量" unit="人" value={inputs.shelterCapacity} min="0" max="200000" onChange={(v) => change('shelterCapacity', v)}/><Field label="需协助比例假设" unit="%" value={inputs.assistanceNeedPct} min="0" max="100" onChange={(v) => change('assistanceNeedPct', v)}/></div>
      <BehaviorFlow result={result}/><BehaviorSensitivity result={result}/>
    </section>
  </div>
}

function saveMarkdown(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `CityOS-${name.replace(/[^\p{L}\p{N}-]+/gu, '-')}-预案草案.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ScenarioCompare({ current, comparisons }) {
  if (!comparisons.length) return <p className="zs-muted">暂无对照方案</p>
  const rows = scenarioComparisonRows(current, comparisons[0].result).map((row, index) => ({ label: row.label, values: [row.current, ...comparisons.map((item) => scenarioComparisonRows(current, item.result)[index].baseline)] }))
  const cases = [{ name: '当前方案', result: current }, ...comparisons.map((item) => ({ name: item.entry.name, result: item.result }))]
  const populationScale = Math.max(1, ...cases.map((item) => item.result.input.exposedPeople))
  return <><div className="zs-compare"><div><span>当前方案</span><strong>{current.priority}</strong><small>{current.pressure}/{current.pressureMax} 压力指标</small></div>{comparisons.map((item) => <div key={item.entry.id}><span>{item.entry.name}</span><strong>{item.result.priority}</strong><small>{item.result.pressure}/{item.result.pressureMax} 压力指标</small></div>)}</div>
    <div className="zs-table-scroll"><table className="zs-table"><thead><tr><th>维度</th>{cases.map((item, index) => <th key={`${item.name}-${index}`}>{item.name}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${index}`}>{value}</td>)}</tr>)}</tbody></table></div>
    <div className="zs-matrix-flow"><strong>居民规则分流 · 多方案同尺度对照</strong><div className="zs-matrix-legend">{current.behaviour.map((item) => <span key={item.id}><i style={{ backgroundColor: item.color }}/>{item.label}</span>)}</div>{cases.map((item, index) => <div className="zs-matrix-row" key={`${item.name}-${index}`}><span>{item.name}</span><div className="zs-sensitivity-bar" role="img" aria-label={`${item.name}：${item.result.behaviour.map((part) => `${part.label} ${part.count} 人`).join('，')}`}>{item.result.behaviour.map((part) => <i key={part.id} style={{ width: `${part.count / populationScale * 100}%`, backgroundColor: part.color }}/>)}</div><small>{item.result.behaviour.map((part) => `${part.label} ${part.count}`).join(' · ')}</small></div>)}</div>
  </>
}

function ForecastDriverPicker({ cityId, onImport }) {
  const [snapshot, setSnapshot] = useState(null)
  const [state, setState] = useState('loading')
  const [endingLead, setEndingLead] = useState(48)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let active = true
    const load = () => fetch(`${import.meta.env.BASE_URL}data/zhejiang-weather-forecast.json`, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then((data) => { if (active) { const assessment = assessForecastSnapshot(data); setSnapshot(assessment.valid ? data : null); setState(assessment.valid ? 'ok' : 'invalid'); setNow(Date.now()) } })
      .catch(() => { if (active) { setSnapshot(null); setState('unavailable') } })
    load()
    const refresh = setInterval(load, 15 * 60_000)
    const clock = setInterval(() => setNow(Date.now()), 5 * 60_000)
    return () => { active = false; clearInterval(refresh); clearInterval(clock) }
  }, [])
  const windows = [24, 48, 72].map((lead) => forecastRainWindow(snapshot, cityId, lead, now)).filter(Boolean)
  const chosen = windows.find((item) => item.endingLeadHours === endingLead) || windows[0]
  const importChosen = () => {
    const fresh = chosen && forecastRainWindow(snapshot, cityId, chosen.endingLeadHours, Date.now())
    if (!fresh) { setNow(Date.now()); return }
    onImport(fresh)
  }
  return <div className="zs-forecast-driver"><div><strong>降雨预报输入</strong></div>
    {state === 'ok' && chosen ? <div className="zs-forecast-controls"><label className="zs-field"><span>选择未来 24 小时窗口 · 北京时间</span><select value={chosen.endingLeadHours} onChange={(event) => setEndingLead(Number(event.target.value))}>{windows.map((item) => <option key={item.endingLeadHours} value={item.endingLeadHours}>{beijingDisplay(item.startAt)}—{beijingDisplay(item.endAt)} · {item.rawRainMm24.toFixed(1)} mm</option>)}</select></label><button type="button" className="zs-secondary" onClick={importChosen}>导入格点降雨</button></div> : <span className="zs-forecast-missing">{state === 'loading' ? '天气模式快照读取中…' : '当前没有完整的未来 24 小时格点窗口可导入；请人工填写假设雨量。'}</span>}
  </div>
}

export function ScenarioStudio({ city }) {
  const [input, setInput] = useState({ ...SCENARIO_DEFAULTS })
  const [name, setName] = useState('复合降雨桌面推演')
  const [startBjt, setStartBjt] = useState(beijingLocalNow)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [scenarioStore, setScenarioStore] = useState(() => readScenarioState(localStorage))
  const saved = scenarioStore.records
  const [compareIds, setCompareIds] = useState([])
  const [notes, setNotes] = useState('')
  const [draftStore, setDraftStore] = useState(() => readDraftState(localStorage))
  const [draftId, setDraftId] = useState('')
  const [storageWarning, setStorageWarning] = useState('')
  const [weatherDriver, setWeatherDriver] = useState(null)
  const [importNote, setImportNote] = useState('')
  const [clock, setClock] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer) }, [])
  useEffect(() => { setInput({ ...SCENARIO_DEFAULTS }); setStartBjt(beijingLocalNow()); setResult(null); setCompareIds([]); setDraftId(''); setWeatherDriver(null); setImportNote(''); setNotes(readStored(DRAFT_KEY)?.[city.id] || '') }, [city.id])
  const citySaved = saved.filter((item) => item.cityId === city.id && item.modelVersion === SCENARIO_MODEL_VERSION)
  const comparisonChoices = citySaved.slice(-5)
  const cityDrafts = draftStore.records.filter((item) => item.cityId === city.id)
  const draftRecord = cityDrafts.find((item) => item.id === draftId) || cityDrafts.at(-1)
  const draft = draftRecord?.markdown || ''
  const activeWeatherIssue = weatherDriverIssue(weatherDriver, city.id, input, startBjt, clock)
  const comparisons = useMemo(() => comparisonChoices.filter((item) => compareIds.includes(item.id)).flatMap((entry) => {
    try { return [{ entry, result: evaluateScenario(entry.input) }] } catch { return [] }
  }), [saved, compareIds, city.id])
  const change = (key, value) => { setInput((current) => ({ ...current, [key]: value })); if (key === 'rainMm24' || key === 'horizonHours') { setWeatherDriver(null); setImportNote('修改降雨或时间窗后，请重新导入降雨。') } setResult(null); setError('') }
  const importForecast = (window) => {
    setInput((current) => ({ ...current, hazard: 'other_rain', horizonHours: 24, rainMm24: String(window.rainMm24), peakMmHour: '' }))
    setStartBjt(beijingLocalFromIso(window.startAt)); setWeatherDriver(window); setResult(null); setError('')
    setImportNote(`已导入 ${beijingDisplay(window.startAt)}—${beijingDisplay(window.endAt)} 的 24 小时降雨 ${window.rawRainMm24.toFixed(3)} mm（规则输入保留 0.1 mm 为 ${window.rainMm24} mm）。1 小时峰值需人工填写。`)
  }
  const run = () => {
    try {
      if (!validBeijingLocal(startBjt)) throw new RangeError('推演起算时间无效')
      const provenanceIssue = weatherDriverIssue(weatherDriver, city.id, input, startBjt, Date.now())
      if (provenanceIssue) throw new RangeError(provenanceIssue)
      setResult(evaluateScenario(input)); setError('')
    }
    catch (issue) { setResult(null); setError(issue.message) }
  }
  const save = () => {
    if (!result) return
    const provenanceIssue = weatherDriverIssue(weatherDriver, city.id, result.input, startBjt, Date.now())
    if (provenanceIssue) { setError(provenanceIssue); return }
    const record = { id: crypto.randomUUID(), cityId: city.id, name: name.trim().slice(0, 80) || '未命名情景', startBjt, modelVersion: result.modelVersion, input: result.input, weatherDriver, createdAt: new Date().toISOString() }
    const next = [...saved, record]
    setScenarioStore({ ...scenarioStore, records: next })
    if (compareIds.length === 0 && citySaved.length) setCompareIds([citySaved.at(-1).id])
    setStorageWarning(scenarioStore.writable && persistScenarios(localStorage, next) ? '' : scenarioStore.issue || '浏览器无法持久保存情景；本次会话仍可比较并下载草案。')
  }
  const generate = () => {
    if (!result) return
    const provenanceIssue = weatherDriverIssue(weatherDriver, city.id, result.input, startBjt, Date.now())
    if (provenanceIssue) { setError(provenanceIssue); return }
    const text = scenarioPlanMarkdown({ cityName: city.name, name: name.trim(), startBjt, result, weatherDriver, comparisons: comparisons.map((item) => ({ name: item.entry.name, startBjt: item.entry.startBjt, result: item.result, weatherDriver: item.entry.weatherDriver || null })), reviewNotes: notes.trim(), checks: CITY_CHECKS[city.id], createdAt: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date()) })
    const now = new Date().toISOString()
    const record = { id: crypto.randomUUID(), cityId: city.id, name: name.trim().slice(0, 80) || '未命名情景', startBjt, modelVersion: result.modelVersion, evidenceType: 'simulated_scenario', input: result.input, markdown: text, createdAt: now, updatedAt: now }
    const next = upsertDraft(draftStore.records, record)
    setDraftStore({ ...draftStore, records: next }); setDraftId(record.id)
    setStorageWarning(draftStore.writable && persistDrafts(localStorage, next) ? '' : draftStore.issue || '浏览器无法持久保存草案；请下载 .md 留存。')
  }
  const editDraft = (value) => {
    if (!draftRecord) return
    const updated = { ...draftRecord, markdown: value.slice(0, 100_000), updatedAt: new Date().toISOString() }
    const next = upsertDraft(draftStore.records, updated)
    setDraftStore({ ...draftStore, records: next })
    setStorageWarning(draftStore.writable && persistDrafts(localStorage, next) ? '' : draftStore.issue || '浏览器无法持久保存草案；请下载 .md 留存。')
  }
  const number = (key, value) => change(key, value)
  return <div className="zs-stack">
    <section className="zo-card"><div className="zs-heading"><div><small>SCENARIO / 复合条件</small><h2>{city.name}情景推演台</h2></div><span className="zs-tag">演示</span></div>
      <ForecastDriverPicker cityId={city.id} onImport={importForecast}/>{importNote && <p className="zs-forecast-note" role="status">{importNote}</p>}
      <div className="zs-grid zs-grid-top"><label className="zs-field"><span>情景名称</span><input value={name} maxLength="80" onChange={(event) => setName(event.target.value)}/></label><label className="zs-field"><span>推演起算 · 北京时间</span><input type="datetime-local" value={startBjt} onChange={(event) => { setStartBjt(event.target.value); setWeatherDriver(null); setImportNote('手动修改起算时间后，请重新导入降雨。'); setResult(null); setError('') }}/></label><SelectField label="事件类型" value={input.hazard} onChange={(v) => change('hazard', v)} options={Object.entries(HAZARD_LABELS)}/><SelectField label="推演时间窗" value={input.horizonHours} onChange={(v) => change('horizonHours', Number(v))} options={[[6, '6 小时'], [12, '12 小时'], [24, '24 小时'], [48, '48 小时'], [72, '72 小时']]}/></div>
      <div className="zs-subhead">环境驱动</div><div className="zs-grid"><Field label="假设 24 小时雨量" unit="mm" min="0" max="400" step="0.1" value={input.rainMm24} onChange={(v) => number('rainMm24', v)}/><Field label="假设 1 小时峰值" unit="mm" min="0" max="120" step="0.1" value={input.peakMmHour} onChange={(v) => number('peakMmHour', v)}/><SelectField label="潮位状态" value={input.tideState} onChange={(v) => change('tideState', v)} options={Object.entries(LEVEL_LABELS)}/><SelectField label="河网水位" value={input.riverState} onChange={(v) => change('riverState', v)} options={Object.entries(LEVEL_LABELS)}/><Field label="排水能力假设" unit="%" min="0" max="100" value={input.drainagePct} onChange={(v) => number('drainagePct', v)}/></div>
      <div className="zs-subhead">居民与资源假设</div><div className="zs-grid"><Field label="假设暴露人群" unit="人" min="0" max="200000" value={input.exposedPeople} onChange={(v) => number('exposedPeople', v)}/><Field label="预警提前量" unit="小时" min="0" max="72" value={input.warningLeadHours} onChange={(v) => number('warningLeadHours', v)}/><Field label="道路可用比例" unit="%" min="0" max="100" value={input.roadOpenPct} onChange={(v) => number('roadOpenPct', v)}/><Field label="避险点假设容量" unit="人" min="0" max="200000" value={input.shelterCapacity} onChange={(v) => number('shelterCapacity', v)}/><Field label="需协助比例假设" unit="%" min="0" max="100" value={input.assistanceNeedPct} onChange={(v) => number('assistanceNeedPct', v)}/></div>
      <div className="zs-actions"><button type="button" className="zo-primary" onClick={run}>运行桌面推演 ↗</button><button type="button" className="zs-secondary" onClick={() => { setInput({ ...SCENARIO_DEFAULTS }); setWeatherDriver(null); setImportNote(''); setResult(null); setError('') }}>重置参数</button></div>{error && <p className="zs-error" role="alert">输入无效：{error}</p>}{activeWeatherIssue && <p className="zs-error" role="status">已导入降雨不能继续使用：{activeWeatherIssue}</p>}
    </section>
    {result && <><ScenarioCityMap city={city} result={result}/><div className="zs-result-grid"><section className="zo-card"><div className="zs-heading"><div><small>RULE OUTPUT / 核查压力</small><h2>{result.priority}</h2></div><span className="zs-tag">规则版本 {result.modelVersion}</span></div><p className="zs-muted">压力指标 {result.pressure} / {result.pressureMax} · 降雨输入：{weatherDriver ? `${weatherDriver.rawRainMm24.toFixed(1)} mm` : '人工假设'}</p>{result.drivers.map((driver) => <div className="zs-driver" key={driver.name}><span>{driver.name}</span><div className="zs-track"><i style={{ width: `${driver.points / driver.max * 100}%` }}/></div><b>{driver.points}/{driver.max}</b></div>)}</section><section className="zo-card"><div className="zs-heading"><div><small>COMPARE / 保存与对照</small><h2>方案集比较</h2></div></div><button type="button" className="zs-secondary" disabled={Boolean(activeWeatherIssue)} onClick={save}>保存当前情景到本机</button><div className="zs-saved-choices"><span>加入本轮方案集（最多 5 个已保存方案）</span>{citySaved.length ? citySaved.slice(-5).map((item) => <label key={item.id}><input type="checkbox" checked={compareIds.includes(item.id)} onChange={(event) => setCompareIds((ids) => event.target.checked ? [...ids.filter((id) => id !== item.id), item.id].slice(-5) : ids.filter((id) => id !== item.id))}/><span>{item.name}<small>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</small></span></label>) : <small>暂无已保存情景。</small>}</div><ScenarioCompare current={result} comparisons={comparisons}/>{(storageWarning || scenarioStore.issue) && <p className="zs-error" role="status">{storageWarning || scenarioStore.issue}</p>}</section></div>
      <section className="zo-card"><div className="zs-heading"><div><small>BEHAVIOUR / 可视化</small><h2>假设居民流向</h2></div><span className="zs-tag">演示</span></div><BehaviorFlow result={result}/><BehaviorSensitivity result={result}/>{(result.capacityGap > 0 || result.accessGap > 0) && <p className="zs-callout">容量缺口 {result.capacityGap} 人、道路可达缺口 {result.accessGap} 人。</p>}</section>
    </>}
    <section className="zo-card"><div className="zs-heading"><div><small>PLAN / 人工编制</small><h2>预案草案</h2></div><span className="zs-tag">待复核</span></div><label className="zs-field"><span>编制备注、责任人和现场核查记录</span><textarea rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="填写点位、责任人和核查记录"/></label><div className="zs-actions"><button type="button" className="zo-primary" disabled={!result || Boolean(activeWeatherIssue)} onClick={generate}>生成新草案 ↗</button>{draftRecord && <button type="button" className="zs-secondary" onClick={() => saveMarkdown(`${city.name}-${draftRecord.name}`, draft)}>下载 .md</button>}</div>{cityDrafts.length > 0 && <label className="zs-field zs-compare-select"><span>本机草案存档</span><select value={draftRecord?.id || ''} onChange={(event) => setDraftId(event.target.value)}>{cityDrafts.map((item) => <option key={item.id} value={item.id}>{item.name} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</option>)}</select></label>}{draftRecord && <><p className="zs-muted">规则版本 {draftRecord.modelVersion} · 更新 {beijingDisplay(draftRecord.updatedAt)}</p><textarea className="zs-plan-preview" aria-label="预案草案正文，可编辑并保存在本机" rows="18" maxLength="100000" value={draft} onChange={(event) => editDraft(event.target.value)}/></>}{(storageWarning || draftStore.issue) && <p className="zs-error" role="status">{storageWarning || draftStore.issue}</p>}</section>
  </div>
}
