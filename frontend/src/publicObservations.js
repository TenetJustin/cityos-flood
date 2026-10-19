export const AIRPORTS = [
  { city: 'shanghai', icao: 'ZSPD', name: '浦东机场' },
  { city: 'ningbo', icao: 'ZSNB', name: '栎社机场' },
  { city: 'fuzhou', icao: 'ZSFZ', name: '长乐机场' },
  { city: 'shenzhen', icao: 'ZGSZ', name: '宝安机场' },
  { city: 'haikou', icao: 'ZJHK', name: '美兰机场' },
]

export const AWC_URL = 'https://aviationweather.gov/api/data/metar?ids=ZSPD,ZSNB,ZSFZ,ZGSZ,ZJHK&format=json&hours=24'
export const AWC_DOCS = 'https://aviationweather.gov/data/api/'
const MAX_AGE_HOURS = 3

function isoFromEpoch(value) {
  if (!Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function optionalNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function normalizeMetars(rows, fetchedAt) {
  if (!Array.isArray(rows)) throw new Error('AWC response is not an array')
  const fetchedMs = Date.parse(fetchedAt)
  if (!Number.isFinite(fetchedMs)) throw new Error('Invalid fetched_at')
  const validIds = new Set(AIRPORTS.map((station) => station.icao))
  const grouped = Object.fromEntries(AIRPORTS.map((station) => [station.icao, []]))
  for (const row of rows) {
    if (!row || !validIds.has(row.icaoId)) continue
    const observedAt = isoFromEpoch(row.obsTime)
    const observedMs = Date.parse(observedAt)
    if (!observedAt || observedMs > fetchedMs + 10 * 60_000 || observedMs < fetchedMs - 25 * 3600_000) continue
    grouped[row.icaoId].push({
      observed_at: observedAt,
      source_received_at: typeof row.receiptTime === 'string' && Number.isFinite(Date.parse(row.receiptTime)) ? new Date(row.receiptTime).toISOString() : null,
      temperature_c: optionalNumber(row.temp, -80, 60),
      pressure_hpa: optionalNumber(row.altim, 800, 1100),
      wind_kt: optionalNumber(row.wspd, 0, 200),
      weather_codes: typeof row.wxString === 'string' ? row.wxString.slice(0, 40) : null,
      quality: row.qcField === 0 ? 'source_qc_0' : 'source_qc_uninterpreted',
    })
  }
  return {
    schema_version: 1,
    state: 'ok',
    evidence_type: 'observation',
    fetched_at: fetchedAt,
    source: { name: 'NOAA Aviation Weather Center METAR', url: AWC_DOCS, query: AWC_URL, scope: '机场站点；非城区雨量、潮位或积水观测', license: '公开 API；原始报文权利与中国站点再利用条款未独立确认，仅展示少量归一化字段' },
    stations: AIRPORTS.map((station) => {
      const history = grouped[station.icao].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))
      const deduped = history.filter((item, index) => index === 0 || item.observed_at !== history[index - 1].observed_at)
      const latest = deduped.at(-1) || null
      const ageHours = latest ? (fetchedMs - Date.parse(latest.observed_at)) / 3600_000 : null
      return { ...station, status: !latest ? 'missing' : ageHours > MAX_AGE_HOURS ? 'stale' : 'current', latest, history: deduped }
    }),
  }
}

export function unavailableSnapshot(fetchedAt, reason = 'source_unavailable') {
  return { schema_version: 1, state: 'unavailable', evidence_type: 'missing', fetched_at: fetchedAt, reason, source: { name: 'NOAA Aviation Weather Center METAR', url: AWC_DOCS }, stations: AIRPORTS.map((station) => ({ ...station, status: 'missing', latest: null, history: [] })) }
}

export function stationDisplayStatus(station, now = new Date()) {
  if (!station?.latest) return 'missing'
  const age = now.getTime() - Date.parse(station.latest.observed_at)
  return !Number.isFinite(age) || age > MAX_AGE_HOURS * 3600_000 ? 'stale' : 'current'
}
