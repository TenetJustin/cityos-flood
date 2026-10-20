import { ZHEJIANG_CITIES } from './zhejiangData.js'

const cities = new Set(ZHEJIANG_CITIES.map(({ id }) => id))
const kinds = ['flood_points', 'resident_impacts', 'department_responses']
const qualityFlags = new Set(['source_recorded', 'independently_verified'])
const residentMetrics = new Set(['affected', 'transferred', 'sheltered', 'stranded'])
const floodStates = new Set(['waterlogged', 'receding', 'cleared'])
const responseStates = new Set(['announced', 'in_progress', 'completed', 'cancelled'])
const utc = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const optionalUtc = (value) => value === null || utc(value)
const nonnegative = (value) => Number.isFinite(value) && value >= 0

export function assessRealEventSnapshot(snapshot, now = Date.now()) {
  const issues = []
  if (!snapshot || snapshot.schema_version !== 1 || !['ok', 'unavailable'].includes(snapshot.state)) issues.push('schema_invalid')
  if (!Array.isArray(snapshot?.sources)) issues.push('sources_invalid')
  for (const kind of kinds) if (!Array.isArray(snapshot?.[kind])) issues.push(`${kind}_invalid`)
  if (issues.length) return { valid: false, issues }

  const sourceIds = new Set()
  for (const source of snapshot.sources) {
    if (!nonempty(source?.id) || sourceIds.has(source.id) || !nonempty(source.name)
      || !/^https?:\/\//.test(source.url || '') || !nonempty(source.license)) issues.push('source_metadata_invalid')
    sourceIds.add(source?.id)
  }
  const expectedSnapshot = new Set(['schema_version', 'state', 'retrieved_at', 'sources', ...kinds])
  if (Object.keys(snapshot).some((key) => !expectedSnapshot.has(key))) issues.push('snapshot_fields_invalid')
  if (snapshot.state === 'unavailable') {
    if (snapshot.retrieved_at !== null || snapshot.sources.length || kinds.some((kind) => snapshot[kind].length)) issues.push('unavailable_has_records')
    return { valid: issues.length === 0, issues: [...new Set(issues)] }
  }
  if (!utc(snapshot.retrieved_at) || Date.parse(snapshot.retrieved_at) > now + 5 * 60_000) issues.push('retrieved_at_invalid')

  const ids = new Set()
  for (const kind of kinds) for (const row of snapshot[kind]) {
    const expected = new Set(['id', 'city_id', 'event_id', 'evidence_type', 'source_id', 'quality', 'verification_source_id', 'observed_at', 'available_at', 'retrieved_at',
      ...(kind === 'flood_points' ? ['place_name', 'coordinates', 'water_depth_cm', 'status'] : kind === 'resident_impacts' ? ['area_name', 'metric', 'count', 'status'] : ['area_name', 'action', 'status'])])
    if (!row || typeof row !== 'object' || Object.keys(row).some((key) => !expected.has(key))) issues.push('record_fields_invalid')
    if (!nonempty(row?.id) || ids.has(row.id)) issues.push('record_id_invalid')
    ids.add(row?.id)
    if (!cities.has(row?.city_id) || !sourceIds.has(row?.source_id) || !qualityFlags.has(row?.quality)
      || !(row?.event_id === null || nonempty(row?.event_id))) issues.push('record_provenance_invalid')
    if (row?.quality === 'independently_verified' && (!sourceIds.has(row.verification_source_id) || row.verification_source_id === row.source_id)) issues.push('verification_source_invalid')
    if (row?.evidence_type !== 'observation' && row?.evidence_type !== 'historical_record') issues.push('record_evidence_invalid')
    if (!utc(row?.observed_at) || !optionalUtc(row?.available_at) || !utc(row?.retrieved_at)) issues.push('record_time_invalid')
    else if (Date.parse(row.observed_at) > Date.parse(row.retrieved_at) + 5 * 60_000
      || (row.available_at !== null && (Date.parse(row.available_at) < Date.parse(row.observed_at) || Date.parse(row.available_at) > Date.parse(row.retrieved_at) + 5 * 60_000))
      || Date.parse(row.retrieved_at) > Date.parse(snapshot.retrieved_at) + 5 * 60_000) issues.push('record_time_order_invalid')
    if (kind === 'flood_points') {
      const [lon, lat] = row?.coordinates || []
      if (!nonempty(row?.place_name) || !Array.isArray(row?.coordinates) || row.coordinates.length !== 2
        || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 118 || lon > 124 || lat < 27 || lat > 32
        || !(row?.water_depth_cm === null || nonnegative(row?.water_depth_cm)) || !floodStates.has(row?.status)) issues.push('flood_point_invalid')
    } else if (kind === 'resident_impacts') {
      if (!nonempty(row?.area_name) || !residentMetrics.has(row?.metric) || !Number.isSafeInteger(row?.count)
        || row?.count < 0 || !['reported', 'confirmed'].includes(row?.status)) issues.push('resident_impact_invalid')
    } else if (!nonempty(row?.area_name) || !nonempty(row?.action) || !responseStates.has(row?.status)) issues.push('department_response_invalid')
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] }
}

export function currentCityEvidence(snapshot, cityId, now = Date.now()) {
  if (!cities.has(cityId) || !assessRealEventSnapshot(snapshot, now).valid || snapshot.state !== 'ok')
    return { floodPoints: [], residentImpacts: [], departmentResponses: [] }
  const recent = (row) => row.city_id === cityId && row.evidence_type === 'observation'
    && Date.parse(row.observed_at) <= now + 5 * 60_000 && now - Date.parse(row.observed_at) <= 24 * 60 * 60_000
  return {
    floodPoints: snapshot.flood_points.filter(recent),
    residentImpacts: snapshot.resident_impacts.filter(recent),
    departmentResponses: snapshot.department_responses.filter(recent),
  }
}

export function activeFloodPointCount(snapshot, cityId, now = Date.now()) {
  return currentCityEvidence(snapshot, cityId, now).floodPoints.filter((row) =>
    row.status !== 'cleared' && now - Date.parse(row.observed_at) <= 6 * 60 * 60_000).length
}
