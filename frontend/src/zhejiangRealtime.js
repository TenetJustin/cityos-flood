export const ZHEJIANG_REALTIME_CITIES = ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']
const PHENOMENA = ['rainfall', 'tide_level', 'river_level', 'flood_depth', 'road_closure']
const CAPABILITY_GATES = [
  'forecast_input_ready',
  'model_assimilation_ready',
  'public_warning_ready',
  'automatic_dispatch_ready',
]
const zonedTimestamp = (value) => typeof value === 'string'
  && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))

export function assessZhejiangRealtimeSnapshot(snapshot, now = Date.now()) {
  const issues = []
  if (!snapshot || snapshot.region_id !== 'zhejiang') issues.push('region_invalid')
  if (!['current', 'degraded', 'unavailable'].includes(snapshot?.status)) issues.push('status_invalid')
  if (!zonedTimestamp(snapshot?.as_of) || Date.parse(snapshot.as_of) > now + 5 * 60_000) issues.push('as_of_invalid')
  if (!snapshot?.snapshot_id || !/^sha256:[a-f0-9]{64}$/.test(snapshot.snapshot_id)) issues.push('snapshot_id_invalid')
  if (!snapshot?.city_status || Object.keys(snapshot.city_status).length !== ZHEJIANG_REALTIME_CITIES.length
    || ZHEJIANG_REALTIME_CITIES.some((city) => !['current', 'degraded', 'unavailable'].includes(snapshot.city_status[city]))) {
    issues.push('city_status_invalid')
  }
  if (!Array.isArray(snapshot?.summaries)) issues.push('summaries_invalid')
  else for (const summary of snapshot.summaries) {
    if (!ZHEJIANG_REALTIME_CITIES.includes(summary?.city_id)
      || !PHENOMENA.includes(summary?.phenomenon)
      || typeof summary?.unit !== 'string'
      || !Number.isInteger(summary?.record_count) || summary.record_count < 1
      || !Number.isInteger(summary?.station_count) || summary.station_count < 1
      || !['latest_observed_at', 'latest_available_at'].every((field) => zonedTimestamp(summary?.[field]))) {
      issues.push('summary_record_invalid')
      break
    }
  }
  if (CAPABILITY_GATES.some((field) => snapshot?.[field] !== false)) issues.push('capability_gate_invalid')
  return { valid: issues.length === 0, issues: [...new Set(issues)] }
}

export function zhejiangRealtimeEndpoint(baseUrl) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''
  return base ? `${base}/api/zhejiang/realtime/snapshot` : ''
}
