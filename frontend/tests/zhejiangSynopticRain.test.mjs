import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assessSynopticRain } from '../src/zhejiangSynopticRain.js'

const snapshot = async () => JSON.parse(await readFile(new URL('../public/data/zhejiang-synoptic-rain-2021.json', import.meta.url), 'utf8'))

test('NOAA GHCNh evidence preserves QC and all four-city missingness', async () => {
  const data = await snapshot()
  assert.deepEqual(assessSynopticRain(data).issues, [])
  assert.deepEqual(data.city_coverage, { hangzhou: 70, ningbo: 66, taizhou: 0, wenzhou: 68 })
  assert.equal(data.available_at, null)
  assert.ok(Number.isFinite(Date.parse(data.retrieved_at)))
  assert.equal(data.period_hours, 6)
  assert.equal(data.report_grid_hours, 3)
  assert.equal(data.stations.find((station) => station.station_id === 'CHI0000ZSNB').coverage_slots, 0)
  assert.equal(data.stations.find((station) => station.station_id === 'CHM00058659').coverage_slots, 0)
  assert.equal(data.stations.find((station) => station.station_id === 'CHM00058477').relation, 'regional_proxy')
})

test('suspect values and fabricated time availability fail closed', async () => {
  const data = await snapshot()
  const slot = data.stations[0].slots.find((item) => item.status === 'historical_record')
  slot.quality_code = '2'
  slot.available_at = '2021-07-20T00:01:00Z'
  data.available_at = '2021-07-20T00:01:00Z'
  const result = assessSynopticRain(data)
  assert.equal(result.valid, false)
  assert.ok(result.issues.includes('quality_invalid'))
  assert.ok(result.issues.includes('slot_time_invalid'))
  assert.ok(result.issues.includes('basis_invalid'))
})

test('fabricated local coverage fails closed', async () => {
  const data = await snapshot()
  data.city_coverage.taizhou = 72
  data.stations[2].relation = 'city_station'
  const result = assessSynopticRain(data)
  assert.equal(result.valid, false)
  assert.ok(result.issues.includes('identity_invalid'))
  assert.ok(result.issues.includes('city_coverage_invalid'))
})
