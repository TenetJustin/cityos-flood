import { useEffect, useMemo, useState } from 'react'
import { CITY_CHECKS } from './zhejiangData.js'
import { evaluateScenario, HAZARD_LABELS, LEVEL_LABELS, SCENARIO_DEFAULTS, SCENARIO_MODEL_VERSION, scenarioComparisonRows, scenarioPlanMarkdown, validBeijingLocal } from './scenarioWorkbench.js'
import { assessForecastSnapshot, forecastRainWindow } from './zhejiangForecast.js'
import './scenarioStudio.css'

const SCENARIO_KEY = 'cityos-zhejiang-scenarios-v1'
const DRAFT_KEY = 'cityos-zhejiang-plan-drafts-v1'
const beijingLocalNow = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16)
const beijingLocalFromIso = (value) => new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 16)
const beijingDisplay = (value) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))

function readStored(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

function setStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
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
    <p>示意图按假设人群与透明规则分流；线宽仅表示相对人数。不是对真实居民行为的观测或经过验证的预测。</p>
  </div>
}

export function ResidentBehaviorPanel({ city }) {
  const [inputs, setInputs] = useState({ ...SCENARIO_DEFAULTS })
  const result = useMemo(() => evaluateScenario(inputs), [inputs])
  const change = (key, value) => setInputs((current) => ({ ...current, [key]: Math.max(0, Math.min(key === 'exposedPeople' || key === 'shelterCapacity' ? 200000 : key === 'warningLeadHours' ? 72 : 100, Number(value) || 0)) }))
  return <div className="zs-stack">
    <section className="zo-card"><div className="zs-heading"><div><small>BEHAVIOUR / 规则假设</small><h2>{city.name} · 居民行为规则示意</h2></div><span className="zs-tag">模拟情景</span></div>
      <p className="zs-muted">先设置假设人群和响应条件，再观察流向变化。四城共用同一未校准规则；当前没有真实人口暴露图层、问卷或避险记录作为校准依据。</p>
      <div className="zs-grid"><Field label="假设人群" unit="人" value={inputs.exposedPeople} min="0" max="200000" onChange={(v) => change('exposedPeople', v)}/><Field label="预警提前量" unit="小时" value={inputs.warningLeadHours} min="0" max="72" onChange={(v) => change('warningLeadHours', v)}/><Field label="道路可用比例" unit="%" value={inputs.roadOpenPct} min="0" max="100" onChange={(v) => change('roadOpenPct', v)}/><Field label="避险点假设容量" unit="人" value={inputs.shelterCapacity} min="0" max="200000" onChange={(v) => change('shelterCapacity', v)}/><Field label="需协助比例假设" unit="%" value={inputs.assistanceNeedPct} min="0" max="100" onChange={(v) => change('assistanceNeedPct', v)}/></div>
      <BehaviorFlow result={result}/>
    </section>
    <section className="zo-card"><div className="zs-heading"><div><small>BOUNDARY / 解释边界</small><h2>还需哪些证据</h2></div></div><div className="zs-evidence-grid"><div><b>人口与建筑</b><span>人口格网、楼层、脆弱人群分布</span></div><div><b>道路与避险点</b><span>通行状态、容量、可达性和开放时间</span></div><div><b>真实响应</b><span>匿名调查、求助、转移与避险记录</span></div></div><p className="zs-muted">目前结果只适合桌面推演，不可写成“实际受影响人数”。</p></section>
  </div>
}

function loadScenarios() {
  const value = readStored(SCENARIO_KEY)
  return Array.isArray(value) ? value.filter((item) => item && typeof item.cityId === 'string' && item.input).slice(-48) : []
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

function ScenarioCompare({ current, comparison }) {
  if (!comparison) return <p className="zs-muted">保存多个同城条件后，可比对输入、核查压力与假设避险容量缺口。</p>
  return <><div className="zs-compare"><div><span>当前</span><strong>{current.priority}</strong><small>{current.pressure}/{current.pressureMax} 压力指标</small></div><div><span>对照 · {comparison.entry.name}</span><strong>{comparison.result.priority}</strong><small>{comparison.result.pressure}/{comparison.result.pressureMax} 压力指标</small></div></div><div className="zs-table-scroll"><table className="zs-table"><thead><tr><th>维度</th><th>当前</th><th>对照</th></tr></thead><tbody>{scenarioComparisonRows(current, comparison.result).map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.current}</td><td>{row.baseline}</td></tr>)}</tbody></table></div></>
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
  return <div className="zs-forecast-driver"><div><strong>公开天气模式作为降雨输入</strong><span>只导入一个完整未来 24 小时窗口；潮位、河网、排水与居民条件仍需人工设置。</span></div>
    {state === 'ok' && chosen ? <div className="zs-forecast-controls"><label className="zs-field"><span>选择未来 24 小时窗口 · 北京时间</span><select value={chosen.endingLeadHours} onChange={(event) => setEndingLead(Number(event.target.value))}>{windows.map((item) => <option key={item.endingLeadHours} value={item.endingLeadHours}>{beijingDisplay(item.startAt)}—{beijingDisplay(item.endAt)} · {item.rawRainMm24.toFixed(1)} mm</option>)}</select></label><button type="button" className="zs-secondary" onClick={importChosen}>导入格点降雨</button></div> : <span className="zs-forecast-missing">{state === 'loading' ? '天气模式快照读取中…' : '当前没有完整的未来 24 小时格点窗口可导入；请人工填写假设雨量。'}</span>}
    {chosen && <div className="zs-forecast-provenance">起报 {beijingDisplay(chosen.modelRunAt)} · 本系统首次取得 {beijingDisplay(chosen.availableAt)} · 格点距中心 {chosen.gridDistanceKm} km · <a href={chosen.sourceUrl} target="_blank" rel="noreferrer">ECMWF 来源 ↗</a></div>}
    <small>ECMWF 模型推断 · 0.25° 格点 · 非城区实测或内涝预测；不提供 1 小时峰值，导入后须人工填写。</small>
  </div>
}

export function ScenarioStudio({ city }) {
  const [input, setInput] = useState({ ...SCENARIO_DEFAULTS })
  const [name, setName] = useState('复合降雨桌面推演')
  const [startBjt, setStartBjt] = useState(beijingLocalNow)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(loadScenarios)
  const [compareId, setCompareId] = useState('')
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState('')
  const [storageWarning, setStorageWarning] = useState('')
  const [weatherDriver, setWeatherDriver] = useState(null)
  const [importNote, setImportNote] = useState('')
  useEffect(() => { setInput({ ...SCENARIO_DEFAULTS }); setStartBjt(beijingLocalNow()); setResult(null); setCompareId(''); setDraft(''); setWeatherDriver(null); setImportNote(''); setNotes(readStored(DRAFT_KEY)?.[city.id] || '') }, [city.id])
  const citySaved = saved.filter((item) => item.cityId === city.id && item.modelVersion === SCENARIO_MODEL_VERSION)
  const comparison = useMemo(() => {
    const entry = citySaved.find((item) => item.id === compareId)
    if (!entry) return null
    try { return { entry, result: evaluateScenario(entry.input) } } catch { return null }
  }, [saved, compareId, city.id])
  const change = (key, value) => { setInput((current) => ({ ...current, [key]: value })); if (key === 'rainMm24') { setWeatherDriver(null); setImportNote('手动修改雨量后，已解除 ECMWF 来源绑定。') } setResult(null); setDraft(''); setError('') }
  const importForecast = (window) => {
    setInput((current) => ({ ...current, hazard: 'other_rain', horizonHours: 24, rainMm24: String(window.rainMm24), peakMmHour: '' }))
    setStartBjt(beijingLocalFromIso(window.startAt)); setWeatherDriver(window); setResult(null); setDraft(''); setError('')
    setImportNote(`已导入 ${beijingDisplay(window.startAt)}—${beijingDisplay(window.endAt)} 的 24 小时模式降雨 ${window.rawRainMm24.toFixed(3)} mm（规则输入保留 0.1 mm 为 ${window.rainMm24} mm）。1 小时峰值未知，必须由人工另填假设。`)
  }
  const run = () => {
    try {
      if (!validBeijingLocal(startBjt)) throw new RangeError('推演起算时间无效')
      if (weatherDriver && (Date.now() >= Date.parse(weatherDriver.startAt) || Date.now() - Date.parse(weatherDriver.modelRunAt) > 24 * 3_600_000)) throw new RangeError('导入的天气窗口已开始或起报过期，请重新导入')
      setResult(evaluateScenario(input)); setError(''); setDraft('')
    }
    catch (issue) { setResult(null); setError(issue.message) }
  }
  const save = () => {
    if (!result) return
    const record = { id: crypto.randomUUID(), cityId: city.id, name: name.trim().slice(0, 80) || '未命名情景', startBjt, modelVersion: result.modelVersion, input: result.input, weatherDriver, createdAt: new Date().toISOString() }
    const next = [...saved.filter((item) => item.cityId !== city.id), ...saved.filter((item) => item.cityId === city.id).slice(-11), record].slice(-48)
    if (!setStored(SCENARIO_KEY, next)) { setStorageWarning('浏览器无法保存；仍可下载预案草案。'); return }
    setSaved(next); setCompareId(record.id); setStorageWarning('')
  }
  const generate = () => {
    if (!result) return
    const text = scenarioPlanMarkdown({ cityName: city.name, name: name.trim(), startBjt, result, weatherDriver, comparison: comparison ? { name: comparison.entry.name, startBjt: comparison.entry.startBjt, result: comparison.result, weatherDriver: comparison.entry.weatherDriver || null } : null, reviewNotes: notes.trim(), checks: CITY_CHECKS[city.id], createdAt: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date()) })
    setDraft(text)
    const stored = readStored(DRAFT_KEY)
    if (!setStored(DRAFT_KEY, { ...stored, [city.id]: notes.trim() })) setStorageWarning('浏览器无法保存备注；请下载草案留存。')
  }
  const number = (key, value) => change(key, value)
  return <div className="zs-stack">
    <section className="zo-card"><div className="zs-heading"><div><small>SCENARIO / 复合条件</small><h2>{city.name}情景推演台</h2></div><span className="zs-tag">模拟情景 · 非内涝预测</span></div>
      <p className="zs-muted">除可选 ECMWF 模式格点降雨外，其他条件均为人工假设；四城共用未校准规则。这里演练的是核查压力与居民行为，不输出未经验证的内涝概率。事件类型仅用于预案标注，不由天气格点判定；时间窗约束假设准备提前量，不代表逐时预报。</p>
      <ForecastDriverPicker cityId={city.id} onImport={importForecast}/>{importNote && <p className="zs-forecast-note" role="status">{importNote}</p>}
      <div className="zs-grid zs-grid-top"><label className="zs-field"><span>情景名称</span><input value={name} maxLength="80" onChange={(event) => { setName(event.target.value); setDraft('') }}/></label><label className="zs-field"><span>推演起算 · 北京时间</span><input type="datetime-local" value={startBjt} onChange={(event) => { setStartBjt(event.target.value); setWeatherDriver(null); setImportNote('手动修改起算时间后，已解除 ECMWF 来源绑定。'); setResult(null); setDraft(''); setError('') }}/></label><SelectField label="事件类型" value={input.hazard} onChange={(v) => change('hazard', v)} options={Object.entries(HAZARD_LABELS)}/><SelectField label="推演时间窗" value={input.horizonHours} onChange={(v) => change('horizonHours', Number(v))} options={[[6, '6 小时'], [12, '12 小时'], [24, '24 小时'], [48, '48 小时'], [72, '72 小时']]}/></div>
      <div className="zs-subhead">环境驱动</div><div className="zs-grid"><Field label="假设 24 小时雨量" unit="mm" min="0" max="400" step="0.1" value={input.rainMm24} onChange={(v) => number('rainMm24', v)}/><Field label="假设 1 小时峰值" unit="mm" min="0" max="120" step="0.1" value={input.peakMmHour} onChange={(v) => number('peakMmHour', v)}/><SelectField label="潮位状态" value={input.tideState} onChange={(v) => change('tideState', v)} options={Object.entries(LEVEL_LABELS)}/><SelectField label="河网水位" value={input.riverState} onChange={(v) => change('riverState', v)} options={Object.entries(LEVEL_LABELS)}/><Field label="排水能力假设" unit="%" min="0" max="100" value={input.drainagePct} onChange={(v) => number('drainagePct', v)}/></div>
      <div className="zs-subhead">居民与资源假设</div><div className="zs-grid"><Field label="假设暴露人群" unit="人" min="0" max="200000" value={input.exposedPeople} onChange={(v) => number('exposedPeople', v)}/><Field label="预警提前量" unit="小时" min="0" max="72" value={input.warningLeadHours} onChange={(v) => number('warningLeadHours', v)}/><Field label="道路可用比例" unit="%" min="0" max="100" value={input.roadOpenPct} onChange={(v) => number('roadOpenPct', v)}/><Field label="避险点假设容量" unit="人" min="0" max="200000" value={input.shelterCapacity} onChange={(v) => number('shelterCapacity', v)}/><Field label="需协助比例假设" unit="%" min="0" max="100" value={input.assistanceNeedPct} onChange={(v) => number('assistanceNeedPct', v)}/></div>
      <div className="zs-actions"><button type="button" className="zo-primary" onClick={run}>运行桌面推演 ↗</button><button type="button" className="zs-secondary" onClick={() => { setInput({ ...SCENARIO_DEFAULTS }); setWeatherDriver(null); setImportNote(''); setResult(null); setDraft(''); setError('') }}>重置参数</button></div>{error && <p className="zs-error" role="alert">输入无效：{error}</p>}
    </section>
    {result && <><div className="zs-result-grid"><section className="zo-card"><div className="zs-heading"><div><small>RULE OUTPUT / 核查压力</small><h2>{result.priority}</h2></div><span className="zs-tag">规则版本 {result.modelVersion}</span></div><p className="zs-muted">压力指标 {result.pressure} / {result.pressureMax}，只用于同类桌面情景比较；不是内涝概率或四级风险等级。24 小时雨量来源：{weatherDriver ? `ECMWF 模型格点（${weatherDriver.rawRainMm24.toFixed(3)} mm，输入精度 0.1 mm）` : '人工假设'}；其他驱动仍为假设。</p>{result.drivers.map((driver) => <div className="zs-driver" key={driver.name}><span>{driver.name}</span><div className="zs-track"><i style={{ width: `${driver.points / driver.max * 100}%` }}/></div><b>{driver.points}/{driver.max}</b></div>)}</section><section className="zo-card"><div className="zs-heading"><div><small>COMPARE / 保存与对照</small><h2>同城情景比较</h2></div></div><button type="button" className="zs-secondary" onClick={save}>保存当前情景到本机</button><label className="zs-field zs-compare-select"><span>选择一个已保存情景</span><select value={compareId} onChange={(event) => { setCompareId(event.target.value); setDraft('') }}><option value="">暂不比较</option>{citySaved.map((item) => <option key={item.id} value={item.id}>{item.name} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</option>)}</select></label><ScenarioCompare current={result} comparison={comparison}/>{storageWarning && <p className="zs-error" role="status">{storageWarning}</p>}<p className="zs-muted">保存在当前浏览器，不同步、不构成正式历史事件。</p></section></div>
      <section className="zo-card"><div className="zs-heading"><div><small>BEHAVIOUR / 可视化</small><h2>假设居民流向</h2></div><span className="zs-tag">非真实人数</span></div><BehaviorFlow result={result}/>{comparison && <p className="zs-muted">对照情景：进入避险点 {comparison.result.behaviour.find((item) => item.id === 'refuge').count} 人；当前情景 {result.behaviour.find((item) => item.id === 'refuge').count} 人。均为规则假设。</p>}{(result.capacityGap > 0 || result.accessGap > 0) && <p className="zs-callout">假设容量缺口 {result.capacityGap} 人、道路可达缺口 {result.accessGap} 人；需核对真实容量、开放状态及路网。</p>}</section>
      <section className="zo-card"><div className="zs-heading"><div><small>PLAN / 人工编制</small><h2>预案草案</h2></div><span className="zs-tag">待复核</span></div><p className="zs-muted">结果可写入可编辑的桌面推演草案并下载 Markdown；不写入任何部门系统，也不自动成为正式预案。</p><label className="zs-field"><span>编制备注、责任人和现场核查记录</span><textarea rows="4" value={notes} onChange={(event) => { setNotes(event.target.value); setDraft('') }} placeholder="填写需核验的点位、来源和责任人；不要录入个人敏感信息。"/></label><div className="zs-actions"><button type="button" className="zo-primary" onClick={generate}>生成预案草案 ↗</button>{draft && <button type="button" className="zs-secondary" onClick={() => saveMarkdown(`${city.name}-${name}`, draft)}>下载 .md</button>}</div>{draft && <textarea className="zs-plan-preview" aria-label="预案草案正文，可复制" rows="18" value={draft} onChange={(event) => setDraft(event.target.value)}/>}</section>
    </>}
  </div>
}
