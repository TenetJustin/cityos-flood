import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMetars, stationDisplayStatus, unavailableSnapshot } from '../src/publicObservations.js'

const fetchedAt = '2026-10-19T15:12:00.000Z'
test('normalizes five-city airport observations and preserves two source times', () => {
  const result = normalizeMetars([{ icaoId: 'ZSPD', obsTime: 1792422000, receiptTime: '2026-10-19T15:06:38Z', temp: 23, altim: 1017, wspd: 2, qcField: 0 }], fetchedAt)
  assert.equal(result.stations.length, 5)
  assert.equal(result.stations[0].latest.temperature_c, 23)
  assert.equal(result.stations[0].latest.source_received_at, '2026-10-19T15:06:38.000Z')
  assert.equal(result.stations[0].status, 'current')
  assert.equal(result.stations[1].status, 'missing')
  assert.equal(result.evidence_type, 'observation')
})

test('rejects future rows and implausible values; recomputes staleness at display time', () => {
  const result = normalizeMetars([{ icaoId: 'ZSPD', obsTime: 1792422000, temp: 999, altim: 0, wspd: -1 }, { icaoId: 'ZSNB', obsTime: 1792500000 }], fetchedAt)
  assert.equal(result.stations[0].latest.temperature_c, null)
  assert.equal(result.stations[0].latest.pressure_hpa, null)
  assert.equal(result.stations[0].latest.wind_kt, null)
  assert.equal(result.stations[1].status, 'missing')
  assert.equal(stationDisplayStatus(result.stations[0], new Date('2026-10-20T00:00:00Z')), 'stale')
})

test('outage snapshot never repeats stale values as live data', () => {
  const result = unavailableSnapshot(fetchedAt)
  assert.equal(result.state, 'unavailable')
  assert.ok(result.stations.every((station) => station.latest === null))
})
