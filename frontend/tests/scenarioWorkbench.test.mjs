import test from 'node:test'
import assert from 'node:assert/strict'
import { behaviorSensitivityCases, evaluateScenario, normalizeScenario, SCENARIO_DEFAULTS, scenarioComparisonRows, scenarioPlanMarkdown, validBeijingLocal } from '../src/scenarioWorkbench.js'

test('scenario validates all numeric boundaries and disallows impossible peak rain', () => {
  assert.throws(() => normalizeScenario({ rainMm24: 10, peakMmHour: 20 }), /cannot exceed/)
  assert.throws(() => normalizeScenario({ drainagePct: 101 }), /drainagePct/)
  assert.throws(() => normalizeScenario({ horizonHours: 13 }), /Unsupported horizon/)
  assert.throws(() => normalizeScenario({ tideState: 'unknown' }), /Invalid tideState/)
  assert.throws(() => normalizeScenario({ rainMm24: '' }), /rainMm24 is required/)
  assert.throws(() => normalizeScenario({ exposedPeople: null }), /exposedPeople is required/)
  assert.throws(() => normalizeScenario({ drainagePct: 50.5 }), /integer/)
  assert.equal(normalizeScenario({ rainMm24: 1.2, peakMmHour: 0.7 }).rainMm24, 1.2)
  assert.throws(() => normalizeScenario({ rainMm24: 1.23 }), /0.1-mm/)
})

test('Beijing-local start time must be a real calendar minute', () => {
  assert.equal(validBeijingLocal('2026-10-20T12:30'), true)
  assert.equal(validBeijingLocal('2026-02-30T12:30'), false)
  assert.equal(validBeijingLocal('2026-10-20T25:30'), false)
  assert.equal(validBeijingLocal(''), false)
})

test('resident pathways sum to the stated hypothetical population', () => {
  for (const exposedPeople of [0, 1, 1000, 200000]) {
    const result = evaluateScenario({ ...SCENARIO_DEFAULTS, exposedPeople })
    assert.equal(result.behaviour.reduce((sum, item) => sum + item.count, 0), exposedPeople)
    assert.ok(result.behaviour.every((item) => item.count >= 0))
    assert.equal(result.evidenceType, 'simulated_scenario')
    assert.equal('probability' in result, false)
  }
})

test('response sensitivity varies only declared assumptions and remains an illustrative stress test', () => {
  const base = evaluateScenario(SCENARIO_DEFAULTS)
  const cases = behaviorSensitivityCases(base)
  assert.deepEqual(cases.map((item) => item.id), ['constrained', 'configured', 'supported'])
  assert.deepEqual(cases.map((item) => [item.input.warningLeadHours, item.input.roadOpenPct, item.input.shelterCapacity]), [[3, 50, 375], [6, 70, 500], [9, 90, 625]])
  for (const item of cases) {
    assert.equal(item.input.rainMm24, base.input.rainMm24)
    assert.equal(item.input.exposedPeople, base.input.exposedPeople)
    assert.equal(item.result.behaviour.reduce((sum, part) => sum + part.count, 0), base.input.exposedPeople)
    assert.equal(item.result.evidenceType, 'simulated_scenario')
    assert.equal('probability' in item.result, false)
  }
  assert.equal(cases[1].result, base)
  const edge = behaviorSensitivityCases(evaluateScenario({ ...SCENARIO_DEFAULTS, exposedPeople: 0, warningLeadHours: 0, roadOpenPct: 100, shelterCapacity: 200000 }))
  assert.ok(edge.every((item) => item.input.warningLeadHours >= 0 && item.input.roadOpenPct <= 100 && item.input.shelterCapacity <= 200000))
  assert.ok(edge.every((item) => item.result.behaviour.every((part) => part.count === 0)))
})

test('stronger compound assumptions raise the review pressure, not a claimed flood probability', () => {
  const mild = evaluateScenario({ ...SCENARIO_DEFAULTS, rainMm24: 25, peakMmHour: 10, tideState: 'normal', riverState: 'normal', drainagePct: 100 })
  const severe = evaluateScenario({ ...SCENARIO_DEFAULTS, rainMm24: 250, peakMmHour: 100, tideState: 'extreme', riverState: 'extreme', drainagePct: 20 })
  assert.ok(severe.pressure > mild.pressure)
  assert.equal(severe.priority, '优先核查')
  assert.equal(mild.priority, '常规核查')
})

test('draft plan carries assumptions, provenance boundary and approval gates', () => {
  const result = evaluateScenario(SCENARIO_DEFAULTS)
  const baseline = evaluateScenario({ ...SCENARIO_DEFAULTS, rainMm24: 20, peakMmHour: 10 })
  const rows = scenarioComparisonRows(result, baseline)
  assert.ok(rows.some((row) => row.label === '24 小时雨量' && row.current === '80 mm' && row.baseline === '20 mm'))
  assert.ok(rows.some((row) => row.label === '事件类型'))
  assert.ok(rows.some((row) => row.label === '预警提前量'))
  assert.ok(rows.some((row) => row.label === '需协助比例'))
  const markdown = scenarioPlanMarkdown({ cityName: '宁波', name: '测试推演', result, comparison: { name: '基线', startBjt: '2026-10-20T12:00', result: baseline }, reviewNotes: '现场核查待安排', checks: ['核查下穿通道'], createdAt: '2026-10-20 12:00' })
  assert.match(markdown, /宁波 · 测试推演预案草案/)
  assert.match(markdown, /模拟情景；非真实观测/)
  assert.match(markdown, /核查下穿通道/)
  assert.match(markdown, /责任人审批/)
  assert.match(markdown, /现场核查待安排/)
  assert.match(markdown, /## 情景对照/)
  assert.match(markdown, /当前 80 mm；对照 20 mm/)
  assert.match(markdown, /对照起算：2026-10-20 12:00 Asia\/Shanghai/)
  assert.match(markdown, /## 居民响应条件敏感性（非统计置信区间）/)
  assert.match(markdown, /响应受限：提前 3 小时、道路 50%、容量 375 人/)
  assert.match(markdown, /尚无居民调查、行为校准或点位影响真值/)
})

test('draft plan records every selected scenario in a multi-case comparison set', () => {
  const current = evaluateScenario({ ...SCENARIO_DEFAULTS, rainMm24: 120, peakMmHour: 30 })
  const dry = evaluateScenario({ ...SCENARIO_DEFAULTS, rainMm24: 25, peakMmHour: 10, tideState: 'normal' })
  const compound = evaluateScenario({ ...SCENARIO_DEFAULTS, rainMm24: 220, peakMmHour: 75, tideState: 'high', riverState: 'elevated' })
  const markdown = scenarioPlanMarkdown({
    cityName: '宁波', name: '三案方案集', result: current,
    comparisons: [
      { name: '低雨量基线', startBjt: '2026-10-20T12:00', result: dry },
      { name: '潮河复合高值', startBjt: '2026-10-20T12:00', result: compound },
    ],
    createdAt: '2026-10-20 12:00',
  })
  assert.match(markdown, /## 多情景对照（各方案均为模拟情景）/)
  assert.match(markdown, /### 低雨量基线/)
  assert.match(markdown, /### 潮河复合高值/)
  assert.match(markdown, /当前方案 120 mm；本方案 25 mm/)
  assert.match(markdown, /当前方案 120 mm；本方案 220 mm/)
})

test('imported ECMWF driver remains distinct from human peak and flood-model claims in plan', () => {
  const driver = { rawRainMm24: 2.4, rainMm24: 2.4, startAt: '2026-10-20T06:00:00Z', endAt: '2026-10-21T06:00:00Z', modelRunAt: '2026-10-19T06:00:00Z', availableAt: '2026-10-19T19:31:00Z', gridDistanceKm: 5, sourceSha256: 'a'.repeat(64), sourceUrl: 'https://www.ecmwf.int/en/forecasts/datasets/open-data' }
  const result = evaluateScenario({ ...SCENARIO_DEFAULTS, rainMm24: 2.4, peakMmHour: 1 })
  const markdown = scenarioPlanMarkdown({ cityName: '温州', name: '格点驱动', result, weatherDriver: driver, createdAt: '2026-10-20 12:00' })
  assert.match(markdown, /外部降雨驱动（模型推断）/)
  assert.match(markdown, /起报：2026-10-19T06:00:00Z/)
  assert.match(markdown, /本次快照取得：2026-10-19T19:31:00Z/)
  assert.match(markdown, /1 小时峰值仍由人工假设/)
  assert.match(markdown, /非真实观测、非已验证预测/)
})
