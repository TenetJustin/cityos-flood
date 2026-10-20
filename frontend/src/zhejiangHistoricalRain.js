export const RAIN_CITY_IDS = ['hangzhou', 'ningbo', 'taizhou', 'wenzhou']
export const RAIN_STATION_IDS = ['CHM00058457', 'CHM00058477', 'CHM00058666', 'CHM00058659', 'CHM00058752']
const STATION_BINDING = {
  CHM00058457: ['hangzhou', 'city_station'],
  CHM00058477: ['ningbo', 'regional_proxy'],
  CHM00058666: ['taizhou', 'regional_proxy'],
  CHM00058659: ['wenzhou', 'city_station'],
  CHM00058752: ['wenzhou', 'regional_proxy'],
}
export const RAIN_DATES = Array.from({ length: 9 }, (_, index) => `2021-07-${String(index + 20).padStart(2, '0')}`)

export function assessHistoricalRain(snapshot) {
  const issues = []
  if (snapshot?.schema_version !== 1 || snapshot?.state !== 'ok' || snapshot?.evidence_type !== 'historical_record') issues.push('classification_invalid')
  if (snapshot?.available_at !== null || snapshot?.slice?.timezone !== null || snapshot?.crs !== 'EPSG:4326' || snapshot?.unit !== 'mm') issues.push('basis_invalid')
  if (snapshot?.slice?.start_date !== RAIN_DATES[0] || snapshot?.slice?.end_date !== RAIN_DATES.at(-1) || !Number.isFinite(Date.parse(snapshot?.built_at || ''))) issues.push('time_invalid')
  if (snapshot?.source?.publisher !== 'NOAA NCEI' || snapshot?.source?.native_unit !== '0.1 mm' || snapshot?.source?.documentation_url !== 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt' || snapshot?.source?.citation_url !== 'https://doi.org/10.7289/V5D21VHZ') issues.push('source_invalid')
  if (!Array.isArray(snapshot?.stations)) return { valid: false, issues: [...issues, 'stations_missing'] }
  const seen = new Set()
  for (const station of snapshot.stations) {
    if (!RAIN_CITY_IDS.includes(station?.city_id) || !RAIN_STATION_IDS.includes(station?.station_id) || STATION_BINDING[station.station_id]?.[0] !== station.city_id || STATION_BINDING[station.station_id]?.[1] !== station.relation || seen.has(station.station_id) || !/^[0-9a-f]{64}$/.test(station?.source_sha256 || '') || station?.source_url !== `https://www.ncei.noaa.gov/pub/data/ghcn/daily/by_station/${station.station_id}.csv.gz`) issues.push('identity_invalid')
    seen.add(station.station_id)
    if (!Array.isArray(station?.station_coordinates) || station.station_coordinates.length !== 2 || !station.station_coordinates.every(Number.isFinite) || !Number.isFinite(station?.distance_to_city_centre_km) || station.distance_to_city_centre_km < 0 || station.distance_to_city_centre_km > 100 || !['city_station', 'regional_proxy'].includes(station?.relation)) issues.push('spatial_invalid')
    if (!Array.isArray(station?.daily) || station.daily.length !== RAIN_DATES.length) { issues.push('days_invalid'); continue }
    let available = 0
    for (let i = 0; i < RAIN_DATES.length; i++) {
      const day = station.daily[i]
      if (day?.date !== RAIN_DATES[i]) issues.push('day_identity_invalid')
      if (day?.status === 'historical_record' && Number.isFinite(day.precip_mm) && day.precip_mm >= 0 && day.precip_mm <= 1000 && !day.quality_flag && day.source_flag === 'S') available++
      else if (day?.status !== 'missing_data' || day.precip_mm !== null) issues.push('daily_quality_invalid')
    }
    if (station.coverage_days !== available) issues.push('coverage_invalid')
  }
  if (seen.size !== RAIN_STATION_IDS.length || RAIN_STATION_IDS.some((id) => !seen.has(id))) issues.push('station_coverage_invalid')
  return { valid: issues.length === 0, issues: [...new Set(issues)] }
}
