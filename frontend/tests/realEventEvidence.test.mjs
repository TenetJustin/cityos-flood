import test from 'node:test'
import assert from 'node:assert/strict'
import { activeFloodPointCount, assessRealEventSnapshot, currentCityEvidence } from '../src/realEventEvidence.js'

const retrievedAt = '2026-10-20T12:00:00Z'
const now = Date.parse('2026-10-20T12:15:00Z')
const base = () => ({
  schema_version: 1, state: 'ok', retrieved_at: retrievedAt,
  sources: [{ id: 'agency', name: '测试来源', url: 'https://example.invalid/source', license: '仅用于测试' }],
  flood_points: [], resident_impacts: [], department_responses: [],
})
const provenance = (id, city = 'ningbo') => ({
  id, city_id: city, event_id: null, evidence_type: 'observation', source_id: 'agency', quality: 'source_recorded',
  observed_at: '2026-10-20T10:00:00Z', available_at: null, retrieved_at: retrievedAt,
})

test('unavailable event snapshot cannot imply safe or carry hidden records', () => {
  const empty = { schema_version: 1, state: 'unavailable', retrieved_at: null, sources: [], flood_points: [], resident_impacts: [], department_responses: [] }
  assert.deepEqual(assessRealEventSnapshot(empty, now), { valid: true, issues: [] })
  assert.deepEqual(currentCityEvidence(empty, 'ningbo', now).floodPoints, [])
  empty.flood_points.push({ id: 'unexpected' })
  assert.equal(assessRealEventSnapshot(empty, now).valid, false)
})

test('only recent, sourced and located observations enter city status', () => {
  const snapshot = base()
  snapshot.flood_points.push(
    { ...provenance('current'), place_name: '测试点', coordinates: [121.55, 29.87], water_depth_cm: 12, status: 'waterlogged' },
    { ...provenance('cleared'), place_name: '已清除点', coordinates: [121.54, 29.88], water_depth_cm: null, status: 'cleared' },
    { ...provenance('other', 'taizhou'), place_name: '另一城市', coordinates: [121.42, 28.66], water_depth_cm: null, status: 'receding' },
    { ...provenance('old'), observed_at: '2026-10-18T10:00:00Z', place_name: '过期点', coordinates: [121.56, 29.89], water_depth_cm: null, status: 'waterlogged' },
  )
  snapshot.resident_impacts.push({ ...provenance('impact'), area_name: '测试区', metric: 'transferred', count: 4, status: 'reported' })
  snapshot.department_responses.push({ ...provenance('action'), area_name: '测试区', action: '查看排水情况', status: 'announced' })
  assert.equal(assessRealEventSnapshot(snapshot, now).valid, true)
  const selected = currentCityEvidence(snapshot, 'ningbo', now)
  assert.deepEqual(selected.floodPoints.map(({ id }) => id), ['current', 'cleared'])
  assert.equal(selected.residentImpacts.length, 1)
  assert.equal(selected.departmentResponses[0].status, 'announced')
  assert.equal(activeFloodPointCount(snapshot, 'ningbo', now), 1)
  assert.equal(activeFloodPointCount(snapshot, 'hangzhou', now), 0)
})

test('missing source, impossible time and malformed measurements are rejected', () => {
  const snapshot = base()
  snapshot.flood_points.push({ ...provenance('point'), place_name: '测试点', coordinates: [121.55, 29.87], water_depth_cm: 12, status: 'waterlogged' })
  const unregistered = structuredClone(snapshot)
  unregistered.flood_points[0].source_id = 'unknown'
  assert.ok(assessRealEventSnapshot(unregistered, now).issues.includes('record_provenance_invalid'))
  const future = structuredClone(snapshot)
  future.flood_points[0].observed_at = '2026-10-21T10:00:00Z'
  assert.ok(assessRealEventSnapshot(future, now).issues.includes('record_time_order_invalid'))
  const badDepth = structuredClone(snapshot)
  badDepth.flood_points[0].water_depth_cm = -1
  assert.ok(assessRealEventSnapshot(badDepth, now).issues.includes('flood_point_invalid'))
  const noLocation = structuredClone(snapshot)
  noLocation.flood_points[0].coordinates = null
  assert.ok(assessRealEventSnapshot(noLocation, now).issues.includes('flood_point_invalid'))
  const malformedRow = structuredClone(snapshot)
  malformedRow.resident_impacts.push(null)
  assert.equal(assessRealEventSnapshot(malformedRow, now).valid, false)
})
