import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { activeFloodPointCount, assessRealEventSnapshot } from '../src/realEventEvidence.js'
import { cityDemoData, validateDemoDataset } from '../src/zhejiangDemoData.js'

const dataset = JSON.parse(await readFile(new URL('../public/data/zhejiang-demo-snapshot.json', import.meta.url), 'utf8'))

test('demo dataset is valid and covers the four Zhejiang cities with explicit synthetic provenance', () => {
  assert.deepEqual(validateDemoDataset(dataset), { valid: true, errors: [] })
  assert.equal(dataset.dataset_type, 'simulated_demo')
  assert.equal(dataset.label, '演示模拟数据 · 非真实观测')
  for (const key of ['timeline', 'points', 'resident_impacts', 'department_responses']) {
    assert.ok(dataset[key].length > 0)
    assert.ok(dataset[key].every((row) => row.evidence_type === 'simulated_scenario' && row.source_id === 'synthetic-rules-v1'))
  }
  assert.deepEqual(dataset.cities.map((row) => row.city_id), ['ningbo', 'taizhou', 'wenzhou', 'hangzhou'])
})

test('city selector returns isolated city timeline, locations, impact assumptions, and response suggestions', () => {
  const city = cityDemoData(dataset, 'wenzhou')
  assert.equal(city.points.length, 2)
  assert.equal(city.timeline.at(-1).rainfall_mm, 153)
  assert.equal(city.residentImpacts[0].population_exposed, 5400)
  assert.ok(city.departmentResponses.length > 0)
  assert.equal(cityDemoData(dataset, 'shanghai'), null)
})

test('demo records cannot be interpreted as real event observations', () => {
  const contaminated = {
    schema_version: 1, state: 'ok', retrieved_at: '2026-10-21T00:00:00Z',
    sources: [{ id: 'synthetic-rules-v1', name: '演示合成器', url: 'https://example.invalid', license: 'synthetic demo' }],
    flood_points: [{
      id: 'demo', city_id: 'ningbo', event_id: null, evidence_type: 'simulated_scenario', source_id: 'synthetic-rules-v1', quality: 'source_recorded',
      observed_at: '2026-10-20T23:00:00Z', available_at: null, retrieved_at: '2026-10-21T00:00:00Z', place_name: '演示点位', coordinates: [121.55, 29.87], water_depth_cm: 5, status: 'waterlogged',
    }], resident_impacts: [], department_responses: [],
  }
  assert.equal(assessRealEventSnapshot(contaminated).valid, false)
  assert.equal(activeFloodPointCount(contaminated, 'ningbo'), 0)
})

test('validator rejects weakened or relabeled simulation data', () => {
  const bad = structuredClone(dataset)
  bad.points[0].evidence_type = 'observation'
  assert.equal(validateDemoDataset(bad).valid, false)
  bad.points[0].evidence_type = 'simulated_scenario'
  bad.label = '真实实时数据'
  assert.equal(validateDemoDataset(bad).valid, false)
})
