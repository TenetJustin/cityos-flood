import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { activeFloodPointCount, assessRealEventSnapshot } from '../src/realEventEvidence.js'
import { estimateResidentScenario } from '../src/demoFloodModel.js'
import { cityDemoData, demoCityAtHour, demoPointAdvice, demoPointDepth, demoRainfallGridAtHour, demoRankedPoints, demoResidentAtHour, demoTimeLabel, validateDemoDataset } from '../src/zhejiangDemoData.js'

const dataset = JSON.parse(await readFile(new URL('../public/data/zhejiang-demo-snapshot.json', import.meta.url), 'utf8'))
const gisLayer = JSON.parse(await readFile(new URL('../public/data/zhejiang-demo-peak.geojson', import.meta.url), 'utf8'))

test('actual SWMM outputs drive every hourly point and cannot silently fall back on missing solver results', () => {
  assert.equal(dataset.model.engine, 'epa_swmm')
  const p = dataset.points[0]
  assert.equal(demoPointDepth(p, 48, dataset), dataset.hydraulics.cities[p.city_id].depth_cm_by_point[p.id][48])
  const broken = structuredClone(dataset)
  delete broken.hydraulics.cities[p.city_id].depth_cm_by_point[p.id]
  assert.equal(validateDemoDataset(broken).valid, false)
  assert.equal(demoPointDepth(p, 48, broken), null)
  const promoted = structuredClone(dataset)
  promoted.hydraulics.public_warning_ready = true
  assert.equal(validateDemoDataset(promoted).valid, false)
})

test('hourly typhoon demo covers four cities, spatial rain cells and flood screening points with explicit synthetic provenance', () => {
  assert.deepEqual(validateDemoDataset(dataset), { valid: true, errors: [] })
  assert.equal(dataset.dataset_type, 'simulated_demo')
  assert.equal(dataset.label, '模拟台风演示 · 非实时数据')
  assert.equal(dataset.scenario.duration_hours, 72)
  assert.equal(dataset.scenario.landfall_hour, 24)
  assert.equal(dataset.scenario.time_step_hours, 1)
  assert.equal(dataset.scenario.forecast_update_interval_hours, 6)
  assert.equal(dataset.scenario.default_hour, 48)
  for (const key of ['timeline', 'points', 'storm_track', 'department_responses']) {
    assert.ok(dataset[key].length > 0)
    assert.ok(dataset[key].every((row) => row.evidence_type === 'simulated_scenario' && row.source_id === 'synthetic-typhoon-v3'))
  }
  assert.deepEqual(dataset.cities.map((row) => row.city_id), ['ningbo', 'taizhou', 'wenzhou', 'hangzhou'])
  assert.equal(dataset.timeline.length, 4 * 73)
  assert.equal(dataset.points.length, 100)
  assert.equal(dataset.point_impacts, undefined)
  assert.equal(dataset.rainfall_grid, undefined)
  assert.equal(dataset.resident_impacts, undefined)
  assert.equal(dataset.resident_point_impacts, undefined)
  assert.equal(dataset.storm_track.length, 73)
  for (const cityId of ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']) {
    const rows = dataset.timeline.filter((row) => row.city_id === cityId)
    assert.deepEqual(rows.map((row) => row.hour), Array.from({ length: 73 }, (_, hour) => hour))
    assert.deepEqual(rows.filter((row) => row.is_forecast_update).map((row) => row.hour), Array.from({ length: 13 }, (_, cycle) => cycle * 6))
  }
  assert.equal(demoTimeLabel(0), 'T−24 h')
  assert.equal(demoTimeLabel(24), '登陆时刻 T0')
  assert.equal(demoTimeLabel(48), 'T+24 h')
})

test('GIS export is RFC 7946-shaped GeoJSON with separate synthetic rain and flood-screening layers', () => {
  assert.equal(gisLayer.type, 'FeatureCollection')
  assert.equal(gisLayer.features.length, 200)
  const layers = new Set(gisLayer.features.map((feature) => feature.properties.layer))
  assert.deepEqual([...layers].sort(), ['synthetic_flood_screening', 'synthetic_rainfall_grid'])
  assert.ok(gisLayer.features.every((feature) => feature.type === 'Feature' && feature.geometry.type === 'Point'))
  assert.ok(gisLayer.features.every((feature) => feature.properties.evidence_type === 'simulated_scenario'))
})

test('city selector returns isolated hourly timeline, point states, resident scenario, and six-hour suggestions', () => {
  const city = cityDemoData(dataset, 'wenzhou')
  assert.equal(city.points.length, 25)
  assert.equal(city.timeline.length, 73)
  assert.equal(city.pointImpacts, undefined)
  assert.equal(city.residentImpacts, undefined)
  assert.equal(city.rainfallGrid, undefined)
  assert.equal(city.residentPointImpacts, undefined)
  assert.equal(city.departmentResponses.length, 13)
  assert.equal(city.stormTrack.length, 73)
  assert.equal(cityDemoData(dataset, 'shanghai'), null)
})

test('point depth and city status change by selected hour and never exceed synthetic point maxima', () => {
  for (const cityId of ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']) {
    const city = cityDemoData(dataset, cityId)
    assert.equal(city.points.length, 25)
    assert.equal(new Set(city.points.map((point) => point.coordinates.join(','))).size, 25)
    assert.equal(new Set(city.points.map((point) => point.label)).size, 25)
    for (const point of city.points) {
      if (point.onset_hour > 0) assert.ok(demoPointDepth(point, point.onset_hour - 1, dataset) < 8)
      for (let hour = 0; hour <= 72; hour += 1) {
        const depth = demoPointDepth(point, hour, dataset)
        assert.ok(depth <= point.depth_cm)
        const ranked = demoRankedPoints(dataset, [cityId], hour).find((item) => item.point_id === point.id)
        assert.equal(ranked.priority_tier === 'P1', depth >= 60)
      }
    }
  }
  assert.equal(new Set(dataset.points.map((point) => point.label)).size, 100)
  assert.match(demoPointAdvice({ depth_cm: 68 }), /交通管控与绕行/)
  assert.match(demoPointAdvice({ depth_cm: 42 }), /泵站及相邻道路/)
  assert.match(demoPointAdvice({ depth_cm: 18 }), /核对积水是否持续发展/)
  const early = demoCityAtHour(dataset, 'wenzhou', 24)
  const peak = demoCityAtHour(dataset, 'wenzhou', 48)
  const recession = demoCityAtHour(dataset, 'wenzhou', 68)
  assert.equal(early.activePoints.length, 0)
  assert.ok(peak.activePoints.length > 0)
  assert.ok(peak.peak_depth_cm > recession.peak_depth_cm)
  assert.equal(peak.severity, 'severe')
  assert.equal(demoRankedPoints(dataset, ['wenzhou'], 48).length, 25)
  assert.equal(demoRainfallGridAtHour(dataset, ['wenzhou'], 48).length, 25)
  const ranked = demoRankedPoints(dataset, ['wenzhou'], 48)
  assert.ok(ranked[0].priority_tier.localeCompare(ranked[1].priority_tier) <= 0)
  if (ranked[0].priority_tier === ranked[1].priority_tier) assert.ok(ranked[0].priority_score >= ranked[1].priority_score)
})

test('resident response values are hourly scenario assumptions, not actual behavior', () => {
  const early = demoResidentAtHour(dataset, 'ningbo', 24)
  const peak = demoResidentAtHour(dataset, 'ningbo', 48)
  assert.equal(early.exposed, early.stay + early.self + early.assist)
  assert.equal(peak.exposed, peak.stay + peak.self + peak.assist)
  assert.ok(peak.exposed > early.exposed)
  assert.ok(peak.shelter <= peak.exposed)
  const summedByPoint = dataset.points.filter((point) => point.city_id === 'ningbo').reduce((sum, point) => sum + estimateResidentScenario(point, demoPointDepth(point, 48, dataset)).exposed, 0)
  assert.equal(summedByPoint, peak.exposed)
})

test('six-hour department recommendations rank current flood points and name only reviewable resource types', () => {
  const recommendation = dataset.department_responses.find((row) => row.city_id === 'ningbo' && row.hour === 48)
  const point = dataset.points.find((candidate) => candidate.id === recommendation.point_id)
  assert.ok(point)
  assert.match(recommendation.action, new RegExp(point.label))
  assert.equal(recommendation.status, '待人工复核')
  assert.equal(recommendation.action_type, 'recommendation_only')
  assert.ok(recommendation.resource_types.length > 0)
  assert.ok(recommendation.ranked_point_ids.length <= 5)
})

test('demo records cannot be interpreted as real event observations', () => {
  const contaminated = {
    schema_version: 1, state: 'ok', retrieved_at: '2026-10-21T00:00:00Z',
    sources: [{ id: 'synthetic-typhoon-v2', name: '演示合成器', url: 'https://example.invalid', license: 'synthetic demo' }],
    flood_points: [{
      id: 'demo', city_id: 'ningbo', event_id: null, evidence_type: 'simulated_scenario', source_id: 'synthetic-typhoon-v2', quality: 'source_recorded',
      observed_at: '2026-10-20T23:00:00Z', available_at: null, retrieved_at: '2026-10-21T00:00:00Z', place_name: '演示点位', coordinates: [121.55, 29.87], water_depth_cm: 5, status: 'waterlogged',
    }], resident_impacts: [], department_responses: [],
  }
  assert.equal(assessRealEventSnapshot(contaminated).valid, false)
  assert.equal(activeFloodPointCount(contaminated, 'ningbo'), 0)
})

test('validator rejects weakened provenance, the wrong refresh cadence, and false real-data labels', () => {
  const bad = structuredClone(dataset)
  bad.points[0].evidence_type = 'observation'
  assert.equal(validateDemoDataset(bad).valid, false)
  bad.points[0].evidence_type = 'simulated_scenario'
  bad.timeline[0].forecast_cycle_hour = 1
  assert.equal(validateDemoDataset(bad).valid, false)
  bad.timeline[0].forecast_cycle_hour = 0
  bad.label = '真实实时数据'
  assert.equal(validateDemoDataset(bad).valid, false)
})
