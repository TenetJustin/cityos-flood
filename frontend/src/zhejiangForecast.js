export const FORECAST_CITY_IDS = ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']
export const FORECAST_STEPS = [6, 12, 24, 48, 72]

export function assessForecastSnapshot(snapshot) {
  const issues = []
  if (snapshot?.schema_version !== 1 || snapshot?.state !== 'ok' || snapshot?.evidence_type !== 'model_inference' || snapshot?.forecast_kind !== 'weather_only') issues.push('classification_invalid')
  if (snapshot?.source?.publisher !== 'ECMWF' || snapshot?.source?.crs !== 'EPSG:4326' || snapshot?.source?.timezone !== 'UTC' || snapshot?.source?.display_unit !== 'mm' || !snapshot?.source?.license || !snapshot?.source?.attribution) issues.push('source_invalid')
  const run = Date.parse(snapshot?.model_run_at || '')
  const seen = Date.parse(snapshot?.available_at || '')
  const retrieved = Date.parse(snapshot?.retrieved_at || '')
  if (!Number.isFinite(run) || !Number.isFinite(seen) || !Number.isFinite(retrieved) || seen < run || seen > retrieved || snapshot?.issued_at !== null) issues.push('time_invalid')
  if (!/^[0-9a-f]{64}$/.test(snapshot?.source_sha256 || '')) issues.push('provenance_invalid')
  if (!Array.isArray(snapshot?.cities)) return { valid: false, issues: [...issues, 'cities_missing'], coverage: 0 }
  const ids = new Set()
  for (const city of snapshot.cities) {
    if (!FORECAST_CITY_IDS.includes(city?.city_id) || ids.has(city.city_id)) issues.push('city_identity_invalid')
    ids.add(city.city_id)
    if (!Array.isArray(city?.city_center) || city.city_center.length !== 2 || !Array.isArray(city?.grid_cell) || city.grid_cell.length !== 2 || !Number.isFinite(city.grid_distance_km) || city.grid_distance_km > 30 || city.grid_distance_km < 0 || city.quality !== 'model_grid_sample') issues.push('grid_invalid')
    if (!Array.isArray(city?.values) || city.values.length !== FORECAST_STEPS.length) { issues.push('leads_invalid'); continue }
    let previous = -0.001
    for (let i = 0; i < FORECAST_STEPS.length; i++) {
      const value = city.values[i]
      if (value?.lead_hours !== FORECAST_STEPS[i] || Date.parse(value?.valid_at || '') !== run + FORECAST_STEPS[i] * 3_600_000) issues.push('validity_invalid')
      if (!Number.isFinite(value?.cumulative_precip_mm) || value.cumulative_precip_mm < 0 || value.cumulative_precip_mm > 1500 || value.cumulative_precip_mm + 0.02 < previous) issues.push('precip_invalid')
      previous = value?.cumulative_precip_mm
    }
  }
  if (ids.size !== FORECAST_CITY_IDS.length || FORECAST_CITY_IDS.some((id) => !ids.has(id))) issues.push('coverage_invalid')
  return { valid: issues.length === 0, issues: [...new Set(issues)], coverage: ids.size }
}

export function forecastDisplayStatus(snapshot, now = Date.now()) {
  if (!assessForecastSnapshot(snapshot).valid) return 'unavailable'
  const age = now - Date.parse(snapshot.model_run_at)
  return age < 0 || now < Date.parse(snapshot.available_at) || age > 24 * 3_600_000 ? 'stale' : 'current'
}

export function cityForecast(snapshot, cityId) {
  return snapshot?.cities?.find((city) => city.city_id === cityId) || null
}
