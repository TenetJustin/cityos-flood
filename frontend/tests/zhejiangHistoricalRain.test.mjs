import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assessHistoricalRain } from '../src/zhejiangHistoricalRain.js'

const snapshot = async () => JSON.parse(await readFile(new URL('../public/data/zhejiang-historical-rain-2021.json', import.meta.url), 'utf8'))

test('NOAA historical rain sample preserves four covered stations and Wenzhou local missingness', async () => {
  const data = await snapshot()
  assert.deepEqual(assessHistoricalRain(data).issues, [])
  assert.equal(data.available_at, null)
  assert.equal(data.slice.timezone, null)
  assert.deepEqual(Object.fromEntries(data.stations.map((station) => [station.station_id, station.coverage_days])), {
    CHM00058457: 9, CHM00058477: 9, CHM00058666: 9, CHM00058659: 0, CHM00058752: 9,
  })
  assert.equal(data.stations.find((station) => station.city_id === 'ningbo').relation, 'regional_proxy')
  assert.equal(data.stations.find((station) => station.city_id === 'wenzhou').daily[0].precip_mm, null)
  assert.equal(data.stations.find((station) => station.station_id === 'CHM00058752').relation, 'regional_proxy')
})

test('misclassified or quality-invalid rain is suppressed', async () => {
  const data = await snapshot()
  data.evidence_type = 'real_observation'
  data.stations[0].daily[0].quality_flag = 'X'
  data.stations[0].source_url = 'https://example.invalid/csv.gz'
  const result = assessHistoricalRain(data)
  assert.equal(result.valid, false)
  assert.ok(result.issues.includes('classification_invalid'))
  assert.ok(result.issues.includes('daily_quality_invalid'))
  assert.ok(result.issues.includes('identity_invalid'))
})
