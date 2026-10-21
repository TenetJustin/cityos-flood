import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSensorThingsCollection, normalizeSensorThingsObservation } from '../src/sensorThingsAdapter.js'

const observation = {
  '@iot.id': 42,
  phenomenonTime: '2026-10-20T08:00:00+08:00',
  resultTime: '2026-10-20T08:01:00+08:00',
  result: 18.4,
  parameters: { quality_flag: 'checked' },
  Datastream: {
    '@iot.id': 9,
    unitOfMeasurement: { name: 'hourly rainfall', symbol: 'mm/h' },
    Sensor: { '@iot.id': 3 },
  },
  FeatureOfInterest: {
    feature: { type: 'Feature', geometry: { type: 'Point', coordinates: [121.55, 29.87] } },
  },
}

const context = {
  sourceVerified: true,
  sourceId: 'zj-open-data-rain-gauge',
  sourceUrl: 'https://data.example.invalid/rain',
  license: 'Open Government Data License',
  cityId: 'ningbo',
  phenomenon: 'rainfall',
  canonicalUnit: 'mm/h',
  availableAt: '2026-10-20T08:02:00+08:00',
  retrievedAt: '2026-10-20T08:03:00+08:00',
}

test('SensorThings observations preserve separate observation, availability and retrieval times', () => {
  const result = normalizeSensorThingsObservation(observation, context)
  assert.equal(result.valid, true)
  assert.deepEqual(result.issues, [])
  assert.equal(result.record.evidence_type, 'observation')
  assert.equal(result.record.observed_at, context.availableAt.replace('08:02', '08:00'))
  assert.equal(result.record.available_at, context.availableAt)
  assert.equal(result.record.retrieved_at, context.retrievedAt)
  assert.equal(result.record.value, 18.4)
  assert.deepEqual(result.record.coordinates, [121.55, 29.87])
})

test('SensorThings normalization fails closed when source, license, unit, city or point is unverified', () => {
  const invalidContext = { ...context, sourceVerified: false, license: '', canonicalUnit: 'mm', cityId: 'shanghai' }
  const invalidObservation = structuredClone(observation)
  invalidObservation.FeatureOfInterest.feature.geometry.coordinates = [0, 0]
  const result = normalizeSensorThingsObservation(invalidObservation, invalidContext)
  assert.equal(result.valid, false)
  assert.equal(result.record, null)
  for (const expected of ['source_not_verified', 'license_missing', 'unit_mismatch_or_missing', 'city_not_supported', 'point_geometry_invalid']) {
    assert.ok(result.issues.includes(expected), expected)
  }
})

test('unknown source availability remains null and is not replaced with result or retrieval time', () => {
  const result = normalizeSensorThingsObservation(observation, { ...context, availableAt: null })
  assert.equal(result.valid, true)
  assert.equal(result.record.available_at, null)
  assert.equal(result.record.provider_result_time, observation.resultTime)
})

test('SensorThings collection pages retain valid observations, report rejected rows and expose pagination', () => {
  const result = normalizeSensorThingsCollection({ value: [observation, { ...observation, result: 'bad' }], '@iot.nextLink': 'https://example.invalid/next' }, context)
  assert.equal(result.records.length, 1)
  assert.equal(result.rejected.length, 1)
  assert.ok(result.rejected[0].issues.includes('scalar_result_required'))
  assert.equal(result.nextLink, 'https://example.invalid/next')
  assert.deepEqual(normalizeSensorThingsCollection({}, context).records, [])
})
