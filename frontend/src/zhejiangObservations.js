import { ZHEJIANG_CITIES } from './zhejiangData.js'

export const ZHEJIANG_AWC_URL = 'https://aviationweather.gov/api/data/metar?ids=ZSNB,ZSLQ,ZSWZ,ZSHC&format=json&hours=24'
export const ZHEJIANG_AWC_DOCS = 'https://aviationweather.gov/data/api/'

const airportName = { ningbo: '栎社机场', taizhou: '路桥机场', wenzhou: '龙湾机场', hangzhou: '萧山机场' }
const airports = ZHEJIANG_CITIES.map(({ id, airport }) => ({ city: id, icao: airport, name: airportName[id] }))
const sourceMeta = {
  name: 'NOAA Aviation Weather Center METAR', url: ZHEJIANG_AWC_DOCS, query: ZHEJIANG_AWC_URL,
  scope: '机场气象；非城区雨量、潮位或积水', license: '公开 API；原始报文再利用条款待独立核对，仅展示少量归一化字段',
  timezone: 'UTC', display_timezone: 'Asia/Shanghai', spatial_reference: 'ICAO 机场站点；未在快照中提供坐标', crs: null,
  units: { temperature_c: '°C', pressure_hpa: 'hPa', wind_kt: 'kt' },
}

function optionalNumber(value, low, high) {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high ? value : null
}

export function normalizeZhejiangMetars(rows, fetchedAt) {
  if (!Array.isArray(rows)) throw new Error('AWC response must be an array')
  const fetchedMs = Date.parse(fetchedAt)
  if (!Number.isFinite(fetchedMs)) throw new Error('Invalid fetched_at')
  const byId = Object.fromEntries(airports.map(({ icao }) => [icao, []]))
  for (const row of rows) {
    if (!row || !Object.hasOwn(byId, row.icaoId)) continue
    const observedMs = typeof row.obsTime === 'number' ? row.obsTime * 1000 : NaN
    if (!Number.isFinite(observedMs) || observedMs > fetchedMs + 10 * 60_000 || observedMs < fetchedMs - 25 * 3600_000) continue
    byId[row.icaoId].push({
      observed_at: new Date(observedMs).toISOString(),
      available_at: null,
      source_received_at: typeof row.receiptTime === 'string' && Number.isFinite(Date.parse(row.receiptTime)) ? new Date(row.receiptTime).toISOString() : null,
      temperature_c: optionalNumber(row.temp, -80, 60),
      pressure_hpa: optionalNumber(row.altim, 800, 1100),
      wind_kt: optionalNumber(row.wspd, 0, 200),
      quality: row.qcField === 0 ? 'source_qc_0' : 'source_qc_uninterpreted',
    })
  }
  return {
    schema_version: 1,
    state: 'ok',
    evidence_type: 'observation',
    fetched_at: fetchedAt,
    source: sourceMeta,
    stations: airports.map((airport) => {
      const unique = [...new Map(byId[airport.icao].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)).map((item) => [item.observed_at, item])).values()]
      const latest = unique.at(-1) || null
      return { ...airport, status: !latest ? 'missing' : fetchedMs - Date.parse(latest.observed_at) > 3 * 3600_000 ? 'stale' : 'current', latest, history: unique }
    }),
  }
}

export function unavailableZhejiangSnapshot(fetchedAt, reason = 'source_unavailable') {
  return { schema_version: 1, state: 'unavailable', evidence_type: 'missing', fetched_at: fetchedAt, reason, source: sourceMeta, stations: airports.map((airport) => ({ ...airport, status: 'missing', latest: null, history: [] })) }
}

export function assessZhejiangSnapshot(snapshot) {
  const issues = []
  const fetchedMs = Date.parse(snapshot?.fetched_at || '')
  if (snapshot?.schema_version !== 1) issues.push('schema_version_invalid')
  if (!['ok', 'unavailable'].includes(snapshot?.state)) issues.push('state_invalid')
  if (snapshot?.evidence_type !== (snapshot?.state === 'ok' ? 'observation' : 'missing')) issues.push('evidence_type_invalid')
  if (!Number.isFinite(fetchedMs)) issues.push('fetched_at_invalid')
  if (!snapshot?.source?.url || !snapshot?.source?.license || snapshot?.source?.timezone !== 'UTC' || snapshot?.source?.display_timezone !== 'Asia/Shanghai') issues.push('source_metadata_invalid')
  if (!Array.isArray(snapshot?.stations) || snapshot.stations.length !== airports.length) {
    issues.push('station_count_invalid')
    return { valid: false, issues, coverage: 0, missing: airports.map(({ city }) => city) }
  }
  const found = new Set()
  let coverage = 0
  const missing = []
  for (const station of snapshot.stations) {
    if (!station || typeof station.city !== 'string') { issues.push('station_identity_invalid'); continue }
    const expected = airports.find((item) => item.city === station?.city)
    if (!expected || expected.icao !== station.icao || found.has(station.city)) issues.push('station_identity_invalid')
    found.add(station?.city)
    if (!Array.isArray(station?.history)) { issues.push('history_invalid'); continue }
    if (!station.latest) {
      missing.push(station.city)
      if (station.status !== 'missing' || station.history.length) issues.push('missing_station_inconsistent')
      continue
    }
    coverage += 1
    if (snapshot.state !== 'ok' || !['current', 'stale'].includes(station.status)) issues.push('station_status_inconsistent')
    if (!station.history.length || JSON.stringify(station.history.at(-1)) !== JSON.stringify(station.latest)) issues.push('latest_not_in_history')
    let priorMs = -Infinity
    for (const row of station.history) {
      if (!row || typeof row !== 'object') { issues.push('row_invalid'); continue }
      const observedMs = Date.parse(row?.observed_at || '')
      if (!Number.isFinite(observedMs) || (Number.isFinite(fetchedMs) && observedMs > fetchedMs + 10 * 60_000)) issues.push('observed_at_invalid')
      if (observedMs <= priorMs) issues.push('history_not_unique_sorted')
      priorMs = observedMs
      if (!Object.hasOwn(row || {}, 'available_at') || (row.available_at !== null && !Number.isFinite(Date.parse(row.available_at)))) issues.push('available_at_invalid')
      if (!Object.hasOwn(row || {}, 'source_received_at') || (row.source_received_at !== null && !Number.isFinite(Date.parse(row.source_received_at)))) issues.push('source_received_at_invalid')
      if (typeof row?.quality !== 'string' || !row.quality) issues.push('quality_missing')
      for (const [key, low, high] of [['temperature_c', -80, 60], ['pressure_hpa', 800, 1100], ['wind_kt', 0, 200]]) {
        if (!Object.hasOwn(row, key) || (row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < low || row[key] > high))) issues.push('measure_invalid')
      }
    }
  }
  if (found.size !== airports.length) issues.push('city_coverage_invalid')
  if (snapshot.state === 'unavailable' && coverage) issues.push('unavailable_with_records')
  return { valid: issues.length === 0, issues: [...new Set(issues)], coverage, missing }
}
