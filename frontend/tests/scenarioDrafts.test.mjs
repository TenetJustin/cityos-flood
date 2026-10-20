import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAN_DRAFTS_KEY, SCENARIOS_KEY, persistDrafts, persistScenarios, readDraftState, readScenarioState, upsertDraft, validDraftRecord, validSavedScenario } from '../src/scenarioDrafts.js'
import { SCENARIO_DEFAULTS, SCENARIO_MODEL_VERSION, weatherDriverIssue } from '../src/scenarioWorkbench.js'

const storage = (initial = {}) => {
  const values = new Map(Object.entries(initial))
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }
}
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const date = '2026-10-20T04:00:00Z'
const saved = (id = ID1) => ({ id, cityId: 'ningbo', name: '复合情景', startBjt: '2026-10-20T12:00', modelVersion: SCENARIO_MODEL_VERSION, input: { ...SCENARIO_DEFAULTS }, weatherDriver: null, createdAt: date })
const draft = (id = ID1) => ({ ...saved(id), evidenceType: 'simulated_scenario', markdown: '# 草案\n人工复核', updatedAt: date })

test('scenario and draft records round-trip without discarding prior versions or manual edits', () => {
  const store = storage()
  assert.equal(validSavedScenario(saved()), true)
  assert.equal(validDraftRecord(draft()), true)
  assert.equal(persistScenarios(store, [saved()]), true)
  assert.equal(persistDrafts(store, [draft()]), true)
  assert.deepEqual(readScenarioState(store).records, [saved()])
  const edited = { ...draft(), markdown: '人工改写\n不应因更改输入而清空', updatedAt: '2026-10-20T05:00:00Z' }
  const next = upsertDraft(readDraftState(store).records, edited)
  assert.equal(persistDrafts(store, next), true)
  assert.equal(readDraftState(store).records[0].markdown, edited.markdown)
  const two = upsertDraft(next, draft(ID2))
  assert.equal(two.length, 2)
  assert.equal(two[0].markdown, edited.markdown)
})

test('corrupt local data is fail-closed and never overwritten by persistence helper', () => {
  const store = storage({ [PLAN_DRAFTS_KEY]: '{broken', [SCENARIOS_KEY]: JSON.stringify([saved(), { ...saved(ID2), cityId: 'shenzhen' }]) })
  assert.equal(readDraftState(store).writable, false)
  assert.equal(readScenarioState(store).writable, false)
  assert.equal(store.values.get(PLAN_DRAFTS_KEY), '{broken')
  assert.equal(persistDrafts(store, [{ ...draft(), input: null }]), false)
  assert.equal(store.values.get(PLAN_DRAFTS_KEY), '{broken')
  assert.equal(validSavedScenario({ ...saved(), input: { ...SCENARIO_DEFAULTS, peakMmHour: 1000 } }), false)
})

test('expired or changed ECMWF model window cannot be saved as current evidence', () => {
  const driver = { cityId: 'ningbo', evidenceType: 'model_inference', publisher: 'ECMWF', sourceUrl: 'https://www.ecmwf.int/en/forecasts/datasets/open-data', sourceSha256: 'a'.repeat(64), modelRunAt: '2026-10-20T00:00:00Z', availableAt: '2026-10-20T03:00:00Z', startAt: '2026-10-20T06:00:00Z', endAt: '2026-10-21T06:00:00Z', rawRainMm24: 80, rainMm24: 80 }
  const startBjt = '2026-10-20T14:00'
  assert.equal(weatherDriverIssue(driver, 'ningbo', SCENARIO_DEFAULTS, startBjt, Date.parse('2026-10-20T04:00:00Z')), '')
  assert.match(weatherDriverIssue(driver, 'ningbo', SCENARIO_DEFAULTS, startBjt, Date.parse('2026-10-20T06:00:00Z')), /窗口已开始/)
  assert.match(weatherDriverIssue(driver, 'ningbo', { ...SCENARIO_DEFAULTS, horizonHours: 48 }, startBjt, Date.parse('2026-10-20T04:00:00Z')), /时间窗已改变/)
  assert.match(weatherDriverIssue({ ...driver, sourceSha256: 'invalid' }, 'ningbo', SCENARIO_DEFAULTS, startBjt, Date.parse('2026-10-20T04:00:00Z')), /来源身份不匹配/)
  assert.equal(validSavedScenario({ ...saved(), startBjt, input: SCENARIO_DEFAULTS, weatherDriver: driver }), true)
  assert.equal(validSavedScenario({ ...saved(), startBjt, input: SCENARIO_DEFAULTS, weatherDriver: { ...driver, cityId: 'taizhou' } }), false)
})
