const CITIES = new Set(['ningbo', 'taizhou', 'wenzhou', 'hangzhou'])
const PHENOMENA = new Set(['rainfall', 'tide_level', 'river_level', 'flood_depth', 'road_closure'])

const zonedTime = (value) => typeof value === 'string'
  && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))

/**
 * Normalize an expanded OGC SensorThings Observation into the CityOS event
 * contract. Source identity, license, phenomenon mapping, units and availability
 * are deliberately caller-supplied; the adapter never invents them.
 */
export function normalizeSensorThingsObservation(observation, context = {}) {
  const issues = []
  const datastream = observation?.Datastream
  const feature = observation?.FeatureOfInterest?.feature
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature
  const coordinates = geometry?.coordinates
  const phenomenon = context.phenomenon
  const value = typeof observation?.result === 'number' ? observation.result : null

  if (!context.sourceVerified) issues.push('source_not_verified')
  if (observation?.['@iot.id'] === undefined && observation?.id === undefined) issues.push('observation_id_missing')
  if (typeof context.sourceId !== 'string' || !context.sourceId.trim()) issues.push('source_id_missing')
  if (typeof context.license !== 'string' || !context.license.trim()) issues.push('license_missing')
  if (!CITIES.has(context.cityId)) issues.push('city_not_supported')
  if (!PHENOMENA.has(phenomenon)) issues.push('phenomenon_not_mapped')
  if (!zonedTime(observation?.phenomenonTime)) issues.push('phenomenon_time_invalid')
  if (!Number.isFinite(value)) issues.push('scalar_result_required')
  if (typeof context.canonicalUnit !== 'string' || !context.canonicalUnit.trim() || datastream?.unitOfMeasurement?.symbol !== context.canonicalUnit) issues.push('unit_mismatch_or_missing')
  if (geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length < 2
    || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])
    || coordinates[0] < 118 || coordinates[0] > 124 || coordinates[1] < 27 || coordinates[1] > 32) issues.push('point_geometry_invalid')
  if (context.availableAt !== null && context.availableAt !== undefined && !zonedTime(context.availableAt)) issues.push('availability_time_invalid')
  if (issues.length) return { valid: false, issues, record: null }

  const qualityFlag = observation?.parameters?.quality_flag ?? observation?.parameters?.qualityFlag ?? 'source_unrated'
  return {
    valid: true,
    issues: [],
    record: {
      id: `sensorthings:${String(observation['@iot.id'] ?? observation.id ?? 'unknown')}`,
      city_id: context.cityId,
      phenomenon,
      value,
      unit: context.canonicalUnit,
      coordinates: [coordinates[0], coordinates[1]],
      spatial_reference: 'EPSG:4326',
      observed_at: observation.phenomenonTime,
      available_at: context.availableAt ?? null,
      retrieved_at: context.retrievedAt && zonedTime(context.retrievedAt) ? context.retrievedAt : null,
      provider_result_time: zonedTime(observation.resultTime) ? observation.resultTime : null,
      evidence_type: 'observation',
      source_id: context.sourceId,
      source_url: context.sourceUrl ?? null,
      license: context.license,
      quality_flag: String(qualityFlag),
      sensor_id: datastream?.Sensor?.['@iot.id'] ?? datastream?.['@iot.id'] ?? null,
      stream_id: datastream?.['@iot.id'] ?? null,
    },
  }
}

/** Normalize one page of an OGC SensorThings `Observations` collection. */
export function normalizeSensorThingsCollection(payload, contextForObservation) {
  if (!Array.isArray(payload?.value)) {
    return { records: [], rejected: [{ index: null, issues: ['observations_value_array_required'] }], nextLink: null }
  }
  const records = []
  const rejected = []
  payload.value.forEach((observation, index) => {
    const context = typeof contextForObservation === 'function' ? contextForObservation(observation, index) : contextForObservation
    const result = normalizeSensorThingsObservation(observation, context)
    if (result.valid) records.push(result.record)
    else rejected.push({ index, issues: result.issues })
  })
  return {
    records,
    rejected,
    nextLink: typeof payload['@iot.nextLink'] === 'string' ? payload['@iot.nextLink'] : null,
  }
}
