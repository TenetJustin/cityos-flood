import { ZHEJIANG_CITIES } from './zhejiangData.js'

export const ZHEJIANG_AWC_URL = 'https://aviationweather.gov/api/data/metar?ids=ZSNB,ZSLQ,ZSWZ,ZSHC&format=json&hours=24'
export const ZHEJIANG_AWC_DOCS = 'https://aviationweather.gov/data/api/'

const airportName = { ningbo: '栎社机场', taizhou: '路桥机场', wenzhou: '龙湾机场', hangzhou: '萧山机场' }
const airports = ZHEJIANG_CITIES.map(({ id, airport }) => ({ city: id, icao: airport, name: airportName[id] }))

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
    source: { name: 'NOAA Aviation Weather Center METAR', url: ZHEJIANG_AWC_DOCS, query: ZHEJIANG_AWC_URL, scope: '机场气象；非城区雨量、潮位或积水', license: '公开 API；原始报文再利用条款待独立核对，仅展示少量归一化字段' },
    stations: airports.map((airport) => {
      const unique = [...new Map(byId[airport.icao].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)).map((item) => [item.observed_at, item])).values()]
      const latest = unique.at(-1) || null
      return { ...airport, status: !latest ? 'missing' : fetchedMs - Date.parse(latest.observed_at) > 3 * 3600_000 ? 'stale' : 'current', latest, history: unique }
    }),
  }
}

export function unavailableZhejiangSnapshot(fetchedAt, reason = 'source_unavailable') {
  return { schema_version: 1, state: 'unavailable', evidence_type: 'missing', fetched_at: fetchedAt, reason, source: { name: 'NOAA Aviation Weather Center METAR', url: ZHEJIANG_AWC_DOCS }, stations: airports.map((airport) => ({ ...airport, status: 'missing', latest: null, history: [] })) }
}
