import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assessForecastSnapshot, cityForecast, forecastDisplayStatus, forecastRainWindow } from '../src/zhejiangForecast.js'

const path = new URL('../public/data/zhejiang-weather-forecast.json', import.meta.url)
const sample = async () => JSON.parse(await readFile(path, 'utf8'))

test('ECMWF sample is four-city weather-model evidence with five valid times', async () => {
  const snapshot = await sample()
  const quality = assessForecastSnapshot(snapshot)
  assert.deepEqual(quality.issues, [])
  assert.equal(quality.coverage, 4)
  assert.equal(snapshot.issued_at, null)
  assert.equal(snapshot.available_at, snapshot.retrieved_at)
  assert.equal(cityForecast(snapshot, 'ningbo').values[2].lead_hours, 24)
  assert.equal(forecastDisplayStatus(snapshot, Date.parse(snapshot.available_at) + 60_000), 'current')
  assert.equal(forecastDisplayStatus(snapshot, Date.parse(snapshot.available_at) - 60_000), 'stale')
  assert.equal(forecastDisplayStatus(snapshot, Date.parse(snapshot.model_run_at) + 25 * 3_600_000), 'stale')
})

test('missing or reclassified fields suppress numerical display', async () => {
  const snapshot = await sample()
  snapshot.evidence_type = 'real_observation'
  snapshot.cities[0].values[1].cumulative_precip_mm = -1
  const quality = assessForecastSnapshot(snapshot)
  assert.equal(quality.valid, false)
  assert.ok(quality.issues.includes('classification_invalid'))
  assert.ok(quality.issues.includes('precip_invalid'))
  assert.equal(forecastDisplayStatus(snapshot), 'unavailable')
})

test('future 24-hour rain window is cumulative difference, not a 48-hour total', async () => {
  const snapshot = await sample()
  const now = Date.parse(snapshot.model_run_at) + 20 * 3_600_000
  const window = forecastRainWindow(snapshot, 'ningbo', 48, now)
  const city = cityForecast(snapshot, 'ningbo')
  assert.ok(window)
  assert.equal(window.rawRainMm24, Number((city.values[3].cumulative_precip_mm - city.values[2].cumulative_precip_mm).toFixed(3)))
  assert.equal(window.rainMm24, Number(window.rawRainMm24.toFixed(1)))
  assert.equal(window.evidenceType, 'model_inference')
  assert.equal(forecastRainWindow(snapshot, 'ningbo', 24, now), null)
  assert.equal(forecastRainWindow(snapshot, 'ningbo', 48, Date.parse(snapshot.model_run_at) + 25 * 3_600_000), null)
})
