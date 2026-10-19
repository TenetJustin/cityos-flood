import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogCheckedAt, cities, event, evidenceTypes, labModules, sources } from '../src/workbenchData.js'

test('public catalogue covers exactly the five research cities', () => {
  assert.deepEqual(cities.map(({ id }) => id), ['shanghai', 'ningbo', 'fuzhou', 'shenzhen', 'haikou'])
  assert.equal(new Set(cities.map(({ id }) => id)).size, 5)
  assert.equal(cities.filter(({ status }) => status === '研究原型').length, 1)
})

test('every source is a candidate or portal lead, not an approved live feed', () => {
  assert.equal(sources.length, 7)
  for (const source of sources) {
    assert.ok(cities.some(({ id }) => id === source.city))
    assert.ok(['数据集候选', '门户线索'].includes(source.type))
    assert.notEqual(source.mapping, '已验证')
    assert.ok(source.gaps.length > 0)
    assert.ok(source.url.startsWith('https://'))
  }
})

test('the event is a historical candidate with explicit replay blockers', () => {
  assert.equal(event.id, 'shenzhen-2023-09-07')
  assert.equal(event.city, 'shenzhen')
  assert.ok(event.records.every(({ source, fact, url }) => source && fact && url.startsWith('https://')))
  assert.ok(event.gaps.some((gap) => gap.includes('available_at')))
  assert.ok(event.gaps.some((gap) => gap.includes('真值')))
})

test('evidence taxonomy and lab index remain explicit', () => {
  assert.deepEqual(evidenceTypes.map(({ id }) => id), ['observation', 'historical_record', 'model_inference', 'simulation_scenario', 'missing'])
  assert.ok(labModules.some(({ id }) => id === 'wam'))
  assert.match(catalogCheckedAt, /^\d{4}-\d{2}-\d{2}$/)
})
