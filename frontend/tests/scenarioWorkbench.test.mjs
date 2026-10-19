import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateScenario, normalizeScenario, SCENARIO_DEFAULTS, scenarioComparisonRows, scenarioPlanMarkdown, validBeijingLocal } from '../src/scenarioWorkbench.js'

test('scenario validates all numeric boundaries and disallows impossible peak rain', () => {
  assert.throws(() => normalizeScenario({ rainMm24: 10, peakMmHour: 20 }), /cannot exceed/)
  assert.throws(() => normalizeScenario({ drainagePct: 101 }), /drainagePct/)
  assert.throws(() => normalizeScenario({ horizonHours: 13 }), /Unsupported horizon/)
  assert.throws(() => normalizeScenario({ tideState: 'unknown' }), /Invalid tideState/)
  assert.throws(() => normalizeScenario({ rainMm24: '' }), /rainMm24 is required/)
  assert.throws(() => normalizeScenario({ exposedPeople: null }), /exposedPeople is required/)
  assert.throws(() => normalizeScenario({ drainagePct: 50.5 }), /integer/)
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
})
