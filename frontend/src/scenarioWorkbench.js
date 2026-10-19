// Transparent tabletop rules. This is not a calibrated flood or behaviour model.
export const SCENARIO_MODEL_VERSION = 'tabletop-rules-v1'
export const SCENARIO_DEFAULTS = Object.freeze({
  hazard: 'typhoon', horizonHours: 24, rainMm24: 80, peakMmHour: 25,
  tideState: 'elevated', riverState: 'normal', drainagePct: 70,
  exposedPeople: 1000, warningLeadHours: 6, roadOpenPct: 70,
  shelterCapacity: 500, assistanceNeedPct: 12,
})

export const HAZARD_LABELS = { typhoon: '台风主体', rainband: '外围雨带', extreme_rain: '非台风强降雨' }
export const LEVEL_LABELS = { normal: '常态', elevated: '偏高', high: '高', extreme: '极端' }

const LIMITS = {
  horizonHours: [6, 72], rainMm24: [0, 400], peakMmHour: [0, 120], drainagePct: [0, 100],
  exposedPeople: [0, 200000], warningLeadHours: [0, 72], roadOpenPct: [0, 100],
  shelterCapacity: [0, 200000], assistanceNeedPct: [0, 100],
}

function boundedNumber(value, key) {
  if (value === '' || value === null || value === undefined) throw new RangeError(`${key} is required`)
  const number = Number(value)
  const [min, max] = LIMITS[key]
  if (!Number.isInteger(number) || number < min || number > max) throw new RangeError(`${key} must be an integer between ${min} and ${max}`)
  return number
}

export function validBeijingLocal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false
  const instant = Date.parse(`${value}+08:00`)
  return Number.isFinite(instant) && new Date(instant + 8 * 3_600_000).toISOString().slice(0, 16) === value
}

export function normalizeScenario(input) {
  const result = { ...SCENARIO_DEFAULTS, ...input }
  if (!Object.hasOwn(HAZARD_LABELS, result.hazard)) throw new RangeError('Invalid hazard')
  for (const field of ['tideState', 'riverState']) {
    if (!Object.hasOwn(LEVEL_LABELS, result[field])) throw new RangeError(`Invalid ${field}`)
  }
  for (const key of Object.keys(LIMITS)) result[key] = boundedNumber(result[key], key)
  if (![6, 12, 24, 48, 72].includes(result.horizonHours)) throw new RangeError('Unsupported horizon')
  if (result.peakMmHour > result.rainMm24) throw new RangeError('1-hour rainfall cannot exceed 24-hour rainfall')
  return result
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }

export function evaluateScenario(raw) {
  const input = normalizeScenario(raw)
  const stateScore = { normal: 0, elevated: 1, high: 2, extreme: 3 }
  const drivers = [
    { name: '24 小时降雨', points: input.rainMm24 >= 200 ? 3 : input.rainMm24 >= 100 ? 2 : input.rainMm24 >= 50 ? 1 : 0, max: 3 },
    { name: '1 小时峰值', points: input.peakMmHour >= 80 ? 2 : input.peakMmHour >= 40 ? 1 : 0, max: 2 },
    { name: '潮位假设', points: stateScore[input.tideState], max: 3 },
    { name: '河网假设', points: stateScore[input.riverState], max: 3 },
    { name: '排水能力', points: input.drainagePct < 40 ? 2 : input.drainagePct < 75 ? 1 : 0, max: 2 },
  ]
  const pressure = drivers.reduce((sum, item) => sum + item.points, 0)
  const pressureMax = drivers.reduce((sum, item) => sum + item.max, 0)
  const priority = pressure >= 9 ? '优先核查' : pressure >= 5 ? '加强核查' : '常规核查'
  const pressureRatio = pressure / pressureMax
  const n = input.exposedPeople
  const roads = input.roadOpenPct / 100
  const warning = Math.min(1, Math.min(input.warningLeadHours, input.horizonHours) / 12)
  const assistance = Math.min(n, Math.round(n * input.assistanceNeedPct / 100 * (0.55 + pressureRatio * 0.45)))
  const remaining = n - assistance
  const refugeDemand = Math.round(remaining * clamp(0.08 + pressureRatio * 0.32 + warning * 0.14, 0, 1))
  const refuge = Math.min(refugeDemand, input.shelterCapacity, Math.round(refugeDemand * roads))
  const afterRefuge = remaining - refuge
  const detour = Math.min(afterRefuge, Math.round(afterRefuge * clamp(0.06 + pressureRatio * 0.2, 0, 1) * roads))
  const stay = n - assistance - refuge - detour
  const behaviour = [
    { id: 'stay', label: '留在原处 / 待核查', count: stay, color: '#7799a2' },
    { id: 'detour', label: '改变出行路线', count: detour, color: '#83b9cf' },
    { id: 'refuge', label: '进入避险点', count: refuge, color: '#91d9bd' },
    { id: 'assistance', label: '需要协助', count: assistance, color: '#e4be86' },
  ]
  return {
    input, pressure, pressureMax, priority, drivers, behaviour,
    refugeDemand, capacityGap: Math.max(0, refugeDemand - input.shelterCapacity),
    accessGap: Math.max(0, Math.min(refugeDemand, input.shelterCapacity) - refuge),
    evidenceType: 'simulated_scenario', modelVersion: SCENARIO_MODEL_VERSION,
    limitation: '无点位积水真值或居民行为调查校准；人数只是输入的假设人群按规则分流，非真实人数、概率或业务预测。',
  }
}

export function scenarioComparisonRows(current, baseline) {
  const fields = [
    ['时间窗', 'horizonHours', '小时'], ['24 小时雨量', 'rainMm24', 'mm'],
    ['1 小时峰值', 'peakMmHour', 'mm'], ['排水能力', 'drainagePct', '%'],
    ['假设人群', 'exposedPeople', '人'], ['预警提前量', 'warningLeadHours', '小时'],
    ['道路可用', 'roadOpenPct', '%'], ['避险容量', 'shelterCapacity', '人'],
    ['需协助比例', 'assistanceNeedPct', '%'],
  ]
  return [
    { label: '事件类型', current: HAZARD_LABELS[current.input.hazard], baseline: HAZARD_LABELS[baseline.input.hazard] },
    ...fields.map(([label, key, unit]) => ({ label, current: `${current.input[key]} ${unit}`, baseline: `${baseline.input[key]} ${unit}` })),
    { label: '潮位 / 河网', current: `${LEVEL_LABELS[current.input.tideState]} / ${LEVEL_LABELS[current.input.riverState]}`, baseline: `${LEVEL_LABELS[baseline.input.tideState]} / ${LEVEL_LABELS[baseline.input.riverState]}` },
    { label: '压力指标', current: `${current.pressure}/${current.pressureMax}`, baseline: `${baseline.pressure}/${baseline.pressureMax}` },
    { label: '假设避险容量缺口', current: `${current.capacityGap} 人`, baseline: `${baseline.capacityGap} 人` },
    { label: '假设道路可达缺口', current: `${current.accessGap} 人`, baseline: `${baseline.accessGap} 人` },
  ]
}

export function scenarioPlanMarkdown({ cityName, name, result, comparison = null, reviewNotes = '', checks = [], createdAt, startBjt = '' }) {
  const { input, behaviour } = result
  const lines = [
    `# ${cityName} · ${name || '桌面推演'}预案草案`, '',
    `- 编制时间：${createdAt}`, '- 状态：草案 / 待人工复核',
    `- 推演起算：${startBjt ? `${startBjt.replace('T', ' ')} Asia/Shanghai` : '待填写'}`,
    '- 证据类型：模拟情景；非真实观测、非已验证预测、非官方预案',
    `- 规则版本：${result.modelVersion}`, '',
    '## 假设条件', '',
    `- 事件：${HAZARD_LABELS[input.hazard]}；时间窗：${input.horizonHours} 小时`,
    `- 降雨：24 小时 ${input.rainMm24} mm；1 小时峰值 ${input.peakMmHour} mm`,
    `- 潮位：${LEVEL_LABELS[input.tideState]}；河网：${LEVEL_LABELS[input.riverState]}；排水能力：${input.drainagePct}%`,
    `- 假设人群：${input.exposedPeople} 人；预警提前量：${input.warningLeadHours} 小时；道路可用：${input.roadOpenPct}%`,
    `- 避险点假设容量：${input.shelterCapacity} 人；需协助比例假设：${input.assistanceNeedPct}%`, '',
    '## 规则演练结果', '',
    `- 核查优先级：${result.priority}（压力指标 ${result.pressure}/${result.pressureMax}；非风险概率）`,
    ...behaviour.map((item) => `- ${item.label}：${item.count} 人（假设分流）`),
    `- 假设避险容量缺口：${result.capacityGap} 人；道路可达缺口：${result.accessGap} 人`, '',
    ...(comparison ? ['## 情景对照', '', `- 对照：${comparison.name}（同为模拟情景）`, `- 对照起算：${comparison.startBjt ? `${comparison.startBjt.replace('T', ' ')} Asia/Shanghai` : '未保存'}`, ...scenarioComparisonRows(result, comparison.result).map((row) => `- ${row.label}：当前 ${row.current}；对照 ${row.baseline}`), ''] : []),
    '## 待核查事项', '', ...checks.map((item) => `- [ ] ${item}`), '',
    '## 编制备注与审批', '', reviewNotes || '（待填写）', '',
    '- [ ] 核对真实雨量、潮位、河网和积水证据及时间戳',
    '- [ ] 核对点位、道路、人口与避险容量的真实台账',
    '- [ ] 完成模型回测、安全检查和责任人审批',
    '- [ ] 由主管部门决定是否纳入正式预案；本站不发布预警或执行调度', '',
    `> ${result.limitation}`, '',
  ]
  return lines.join('\n')
}
