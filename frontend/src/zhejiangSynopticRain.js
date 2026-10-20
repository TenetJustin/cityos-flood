export const SYNOPTIC_STATIONS = {
  CHI0000ZSHC: ['hangzhou', 'city_station'],
  CHI0000ZSNB: ['ningbo', 'city_station'],
  CHM00058477: ['ningbo', 'regional_proxy'],
  CHM00058659: ['wenzhou', 'city_station'],
  CHM00058752: ['wenzhou', 'regional_proxy'],
}
const CITY_IDS = ['hangzhou', 'ningbo', 'taizhou', 'wenzhou']
const START = Date.parse('2021-07-20T00:00:00Z')
const STEP = 3 * 60 * 60 * 1000
const SOURCE = 'https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly'

export function assessSynopticRain(snapshot) {
  const issues = []
  if (snapshot?.schema_version !== 1 || snapshot?.state !== 'ok' || snapshot?.evidence_type !== 'historical_record' || snapshot?.variable !== 'precipitation_6_hour') issues.push('classification_invalid')
  if (snapshot?.unit !== 'mm' || snapshot?.timezone !== 'UTC' || snapshot?.crs !== 'EPSG:4326' || snapshot?.period_hours !== 6 || snapshot?.report_grid_hours !== 3 || snapshot?.available_at !== null) issues.push('basis_invalid')
  if (snapshot?.slice?.start_inclusive !== '2021-07-20T00:00:00Z' || snapshot?.slice?.end_exclusive !== '2021-07-29T00:00:00Z' || !Number.isFinite(Date.parse(snapshot?.built_at || '')) || !Number.isFinite(Date.parse(snapshot?.retrieved_at || ''))) issues.push('time_invalid')
  if (snapshot?.source?.publisher !== 'NOAA NCEI' || snapshot?.source?.product !== 'GHCNh 2021 by-year PSV' || snapshot?.source?.documentation_url !== `${SOURCE}/doc/ghcnh_DOCUMENTATION.pdf` || snapshot?.source?.citation_url !== 'https://doi.org/10.25921/jp3d-3v19' || snapshot?.source?.license !== 'CC0-1.0') issues.push('source_invalid')
  if (!Array.isArray(snapshot?.stations) || snapshot.stations.length !== Object.keys(SYNOPTIC_STATIONS).length) return { valid: false, issues: [...issues, 'stations_invalid'] }
  const seen = new Set()
  const coverage = Object.fromEntries(CITY_IDS.map((city) => [city, 0]))
  for (const station of snapshot.stations) {
    const id = station?.station_id
    const binding = SYNOPTIC_STATIONS[id]
    if (!binding || binding[0] !== station?.city_id || binding[1] !== station?.relation || seen.has(id) || station?.source_url !== `${SOURCE}/access/by-year/2021/psv/GHCNh_${id}_2021.psv` || !/^[0-9a-f]{64}$/.test(station?.source_sha256 || '')) issues.push('identity_invalid')
    seen.add(id)
    if (!Array.isArray(station?.station_coordinates) || station.station_coordinates.length !== 2 || !station.station_coordinates.every(Number.isFinite) || !Number.isFinite(station?.distance_to_city_centre_km) || station.distance_to_city_centre_km < 0 || station.distance_to_city_centre_km > 100 || !Number.isInteger(station?.source_rows_in_slice) || station.source_rows_in_slice < 0) issues.push('spatial_invalid')
    if (!Array.isArray(station?.slots) || station.slots.length !== 72) { issues.push('slots_invalid'); continue }
    let available = 0
    for (let index = 0; index < 72; index++) {
      const slot = station.slots[index]
      if (slot?.observed_at !== new Date(START + index * STEP).toISOString().replace('.000Z', 'Z') || slot?.available_at !== null) issues.push('slot_time_invalid')
      if (slot?.status === 'historical_record') {
        if (!Number.isFinite(slot.precip_6h_mm) || slot.precip_6h_mm < 0 || slot.precip_6h_mm > 1000 || slot.quality_code !== '1' || slot.measurement_code === 'T' || !['220', '223'].includes(slot.source_code) || slot.report_type !== 'FM12' || slot.missing_reason !== null) issues.push('quality_invalid')
        else available++
      } else if (slot?.status !== 'missing_data' || slot.precip_6h_mm !== null || !['no_report', 'quality_or_trace_not_numeric'].includes(slot.missing_reason)) issues.push('missingness_invalid')
    }
    if (station?.coverage_slots !== available) issues.push('coverage_invalid')
    if (CITY_IDS.includes(station?.city_id)) coverage[station.city_id] += available
  }
  if (seen.size !== Object.keys(SYNOPTIC_STATIONS).length) issues.push('station_coverage_invalid')
  if (JSON.stringify(snapshot.city_coverage) !== JSON.stringify(coverage)) issues.push('city_coverage_invalid')
  return { valid: issues.length === 0, issues: [...new Set(issues)] }
}
