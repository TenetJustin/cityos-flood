import test from 'node:test'
import assert from 'node:assert/strict'
import { assessZhejiangRealtimeSnapshot, zhejiangRealtimeEndpoint } from '../src/zhejiangRealtime.js'

const now = Date.parse('2026-10-21T04:00:00Z')
const validSnapshot = () => ({
  region_id: 'zhejiang',
  snapshot_id: `sha256:${'a'.repeat(64)}`,
  as_of: '2026-10-21T12:00:00+08:00',
  status: 'degraded',
  city_status: { ningbo: 'current', taizhou: 'unavailable', wenzhou: 'unavailable', hangzhou: 'unavailable' },
  summaries: [{
    city_id: 'ningbo', phenomenon: 'rainfall', unit: 'mm/h', record_count: 2,
    station_count: 2, latest_observed_at: '2026-10-21T11:55:00+08:00',
    latest_available_at: '2026-10-21T12:00:00+08:00',
  }],
  forecast_input_ready: false,
  model_assimilation_ready: false,
  public_warning_ready: false,
  automatic_dispatch_ready: false,
})

test('accepts only a four-city Zhejiang descriptive snapshot with closed capability flags', () => {
  assert.deepEqual(assessZhejiangRealtimeSnapshot(validSnapshot(), now), { valid: true, issues: [] })
})

test('rejects another region, foreign city, malformed timestamps and opened capability flags', () => {
  const snapshot = validSnapshot()
  snapshot.city_status.shanghai = 'current'
  snapshot.summaries[0].city_id = 'shanghai'
  snapshot.public_warning_ready = true
  assert.equal(assessZhejiangRealtimeSnapshot(snapshot, now).valid, false)
})

test('does not enable an endpoint when no live API base is configured', () => {
  assert.equal(zhejiangRealtimeEndpoint(''), '')
  assert.equal(zhejiangRealtimeEndpoint('https://api.example.test/'), 'https://api.example.test/api/zhejiang/realtime/snapshot')
})
