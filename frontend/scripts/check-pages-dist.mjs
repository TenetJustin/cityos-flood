// Verify the actual static output, not just source modules or Vite compilation.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ZHEJIANG_CITIES } from '../src/zhejiangData.js'
import { assessZhejiangSnapshot } from '../src/zhejiangObservations.js'
import { assessForecastSnapshot } from '../src/zhejiangForecast.js'
import { assessHistoricalRain } from '../src/zhejiangHistoricalRain.js'
import { assessSynopticRain } from '../src/zhejiangSynopticRain.js'
import { assessTrackSnapshot } from '../src/historicalTracks.js'
import { assessRealEventSnapshot } from '../src/realEventEvidence.js'
import { assessEvidenceManifest, EVIDENCE_FILES } from './evidence-manifest.mjs'

const dist = new URL('../dist/', import.meta.url)
const read = (path) => readFile(new URL(path, dist), 'utf8')
const json = async (path) => JSON.parse(await read(`data/${path}`))

const html = await read('index.html')
assert.match(html, /CityOS · 浙江台风与城市内涝世界模型/)
assert.match(html, /\/cityos-flood\/assets\//)
assert.equal(await read('404.html'), html)

const sections = ['points', 'impact', 'decision', 'events', 'scenario', 'data']
for (const city of ZHEJIANG_CITIES) {
  for (const route of [`workbench/${city.id}`, ...sections.map((section) => `workbench/${city.id}/${section}`)]) {
    assert.equal(await read(`${route}/index.html`), html, `${route} deep link differs from root`)
  }
}
for (const route of ['workbench', 'about', 'about/product', 'welcome']) assert.equal(await read(`${route}/index.html`), html)

const observations = await json('zhejiang-observations.json')
assert.equal(assessZhejiangSnapshot(observations).valid, true, 'airport snapshot malformed')
assert.equal(assessRealEventSnapshot(await json('zhejiang-real-events.json')).valid, true, 'real event snapshot malformed')
const forecast = await json('zhejiang-weather-forecast.json')
if (forecast.state === 'ok') assert.equal(assessForecastSnapshot(forecast).valid, true, 'forecast snapshot malformed')
else {
  assert.equal(forecast.state, 'unavailable')
  assert.equal(forecast.evidence_type, 'missing_data')
  assert.equal(forecast.forecast_kind, 'weather_only')
  assert.deepEqual(forecast.cities, [])
  assert.ok(Number.isFinite(Date.parse(forecast.attempted_at || '')))
}
assert.equal(assessHistoricalRain(await json('zhejiang-historical-rain-2021.json')).valid, true, 'historical rainfall malformed')
assert.equal(assessSynopticRain(await json('zhejiang-synoptic-rain-2021.json')).valid, true, 'synoptic rainfall malformed')
assert.equal(assessTrackSnapshot(await json('zhejiang-track-candidates.json')).valid, true, 'track index malformed')
const manifest = await json('zhejiang-evidence-manifest.json')
const evidenceBytes = Object.fromEntries(await Promise.all(EVIDENCE_FILES.map(async (path) => [path, await readFile(new URL(`data/${path}`, dist))])))
assert.deepEqual(assessEvidenceManifest(manifest, evidenceBytes), { valid: true, issues: [] }, 'evidence hashes differ from deployed files')
console.log(`Static Pages routes, ${EVIDENCE_FILES.length} evidence snapshots and exact-file hashes verified.`)
