import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assessTrackSnapshot, nearbyTracks, trackSegments, tracksForYear } from '../src/historicalTracks.js'

const snapshotPath = new URL('../public/data/zhejiang-track-candidates.json', import.meta.url)

test('checked-in NOAA-derived index passes structural and provenance checks', async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
  const assessment = assessTrackSnapshot(snapshot)
  assert.deepEqual(assessment.issues, [])
  assert.ok(assessment.valid)
  assert.ok(assessment.count > 0)
  assert.equal(snapshot.evidence_type, 'historical_record')
  assert.equal(snapshot.source.timezone, 'UTC')
  assert.equal(snapshot.source.crs, 'EPSG:4326')
  for (const cityId of ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']) {
    const matches = nearbyTracks(snapshot, cityId)
    assert.ok(matches.length > 0, `${cityId} should have historical path candidates`)
    assert.ok(matches.every((track) => track.city_min_km[cityId] <= snapshot.screening.city_center_near_km))
  }
  const firstYear = Number(snapshot.tracks[0].points[0].time_utc.slice(0, 4))
  assert.ok(tracksForYear(snapshot, 'ningbo', firstYear).every((track) => track.points.some((point) => point.time_utc.startsWith(String(firstYear)))))
  assert.deepEqual(tracksForYear(snapshot, 'ningbo', '1900'), [])
})

test('tampered track classification and geometry fail closed', async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
  snapshot.evidence_type = 'real_observation'
  snapshot.tracks[0].points[0].lat = 999
  const assessment = assessTrackSnapshot(snapshot)
  assert.equal(assessment.valid, false)
  assert.ok(assessment.issues.includes('classification_invalid'))
  assert.ok(assessment.issues.includes('track_geometry_invalid'))
})

test('map does not bridge gaps from clipped path points', () => {
  const points = [
    { time_utc: '2024-01-01T00:00:00Z', lat: 28, lon: 120 },
    { time_utc: '2024-01-01T06:00:00Z', lat: 29, lon: 121 },
    { time_utc: '2024-01-03T00:00:00Z', lat: 30, lon: 122 },
  ]
  assert.deepEqual(trackSegments(points), [[[28, 120], [29, 121]], [[30, 122]]])
})
