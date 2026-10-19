import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarioAssessment, ZHEJIANG_CITIES, ZHEJIANG_SOURCES } from '../src/zhejiangData.js'
import { normalizeZhejiangMetars, unavailableZhejiangSnapshot } from '../src/zhejiangObservations.js'

test('Zhejiang scope contains four distinct cities and source leads retain access status', () => {
  assert.deepEqual(ZHEJIANG_CITIES.map(({ id }) => id), ['ningbo', 'taizhou', 'wenzhou', 'hangzhou'])
  assert.equal(new Set(ZHEJIANG_CITIES.map(({ id }) => id)).size, 4)
  assert.ok(ZHEJIANG_SOURCES.every((source) => source.url && source.publisher && source.access && source.license))
  assert.equal(ZHEJIANG_SOURCES.filter((source) => source.access === '已接入公开快照').length, 1)
})

test('scenario rule responds to compound assumptions without returning a flood probability', () => {
  assert.equal(scenarioAssessment({ rain: 0, tide: 'normal', river: 'normal', drainage: 'normal' }).label, '常规核查')
  assert.equal(scenarioAssessment({ rain: 100, tide: 'normal', river: 'normal', drainage: 'normal' }).label, '加强核查')
  const compound = scenarioAssessment({ rain: 100, tide: 'high', river: 'high', drainage: 'reduced' })
  assert.equal(compound.label, '优先核查')
  assert.equal('probability' in compound, false)
})

test('four-city airport adapter preserves missing stations and observation time', () => {
  const fetchedAt = '2026-10-20T00:00:00.000Z'
  const snapshot = normalizeZhejiangMetars([
    { icaoId: 'ZSNB', obsTime: Date.parse('2026-10-19T23:00:00.000Z') / 1000, temp: 21, altim: 1012, wspd: 7 },
    { icaoId: 'ZSHC', obsTime: Date.parse('2026-10-19T22:00:00.000Z') / 1000, temp: 20, altim: 1011, wspd: 5 },
  ], fetchedAt)
  assert.equal(snapshot.stations.length, 4)
  assert.deepEqual(snapshot.stations.map(({ city, status }) => [city, status]), [['ningbo', 'current'], ['taizhou', 'missing'], ['wenzhou', 'missing'], ['hangzhou', 'current']])
  assert.equal(snapshot.stations[0].latest.observed_at, '2026-10-19T23:00:00.000Z')
  assert.equal(snapshot.stations[0].latest.available_at, null)
  assert.equal(snapshot.stations[1].latest, null)
  assert.equal(unavailableZhejiangSnapshot(fetchedAt).stations.every((station) => station.latest === null), true)
})
