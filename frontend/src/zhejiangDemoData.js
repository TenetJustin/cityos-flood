const CITY_IDS = ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']
const ALLOWED_SEVERITY = new Set(['watch', 'warning', 'severe'])

export function validateDemoDataset(dataset) {
  const errors = []
  if (!dataset || dataset.schema_version !== 1 || dataset.dataset_type !== 'simulated_demo' || typeof dataset.dataset_id !== 'string' || !dataset.dataset_id.trim()) errors.push('dataset must use simulated_demo schema v1')
  if (dataset?.label !== '演示模拟数据 · 非真实观测') errors.push('dataset must carry the simulation label')
  if (dataset?.time_zone !== 'Asia/Shanghai' || dataset?.time_basis !== 'relative_hours_from_scenario_start' || dataset?.observation_time !== null || dataset?.actual_available_at !== null) errors.push('simulation time basis must not masquerade as observation availability')
  if (dataset?.spatial_reference !== 'EPSG:4326' || dataset?.quality_mark !== 'synthetic_demo_only' || dataset?.missing_value !== null || !dataset?.source_catalog?.some((source) => source.id === 'synthetic-rules-v1' && source.type === 'synthetic_generator')) errors.push('simulation spatial, quality or source metadata is incomplete')
  if (!Array.isArray(dataset?.cities) || !Array.isArray(dataset?.timeline) || !Array.isArray(dataset?.points) || !Array.isArray(dataset?.resident_impacts) || !Array.isArray(dataset?.department_responses)) errors.push('dataset collections are required')
  if (!Number.isFinite(Date.parse(dataset?.generated_at)) || !Number.isFinite(dataset?.scenario?.duration_hours) || dataset.scenario.duration_hours < 1 || dataset.scenario.rule_version !== 'synthetic-rules-v1') errors.push('scenario metadata is invalid')
  const cityIds = (dataset?.cities || []).map((city) => city?.city_id)
  if (Array.isArray(dataset?.cities) && (CITY_IDS.some((id) => !cityIds.includes(id)) || new Set(cityIds).size !== CITY_IDS.length || cityIds.length !== CITY_IDS.length)) errors.push('exactly the four Zhejiang cities are required')
  const statuses = new Set(['watch', 'warning', 'severe'])
  for (const city of dataset?.cities || []) if (!statuses.has(city?.status) || !Number.isFinite(city.rainfall_6h_mm) || city.rainfall_6h_mm < 0 || !Number.isFinite(city.exposed_population) || city.exposed_population < 0) errors.push(`city ${city?.city_id || '(unknown)'} has invalid demo indicators`)
  const rows = ['timeline', 'points', 'resident_impacts', 'department_responses'].flatMap((key) => Array.isArray(dataset?.[key]) ? dataset[key] : [])
  const rowIds = new Set()
  for (const row of rows) {
    if (row.evidence_type !== 'simulated_scenario' || row.source_id !== 'synthetic-rules-v1') errors.push(`row ${row.id || '(unknown)'} is not explicitly simulated`)
    if (!CITY_IDS.includes(row.city_id)) errors.push(`row ${row.id || '(unknown)'} has an unsupported city`)
    if (typeof row.id !== 'string' || !row.id || rowIds.has(row.id)) errors.push('demo record ids must be unique')
    rowIds.add(row.id)
  }
  for (const item of dataset?.timeline || []) if (!ALLOWED_SEVERITY.has(item.severity) || !Number.isFinite(item.hour) || item.hour < 0 || item.hour > dataset?.scenario?.duration_hours || !Number.isFinite(item.rainfall_mm) || item.rainfall_mm < 0 || !Number.isFinite(item.water_index) || item.water_index < 0 || item.water_index > 1) errors.push(`timeline ${item.id} has invalid values`)
  for (const item of dataset?.points || []) {
    const [lon, lat] = item.coordinates || []
    if (!Array.isArray(item.coordinates) || item.coordinates.length !== 2 || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 118 || lon > 124 || lat < 27 || lat > 32 || !Number.isFinite(item.depth_cm) || item.depth_cm < 0 || !Number.isFinite(item.onset_hour) || item.onset_hour < 0 || item.onset_hour > dataset?.scenario?.duration_hours) errors.push(`point ${item.id} has invalid demo values`)
  }
  for (const item of dataset?.resident_impacts || []) {
    const values = [item.population_exposed, item.stay, item.self_evacuate, item.assisted, item.shelter_demand]
    if (!values.every((value) => Number.isSafeInteger(value) && value >= 0) || item.stay + item.self_evacuate + item.assisted !== item.population_exposed || item.shelter_demand > item.population_exposed) errors.push(`resident demo row ${item.id} has inconsistent aggregate values`)
  }
  for (const item of dataset?.department_responses || []) if (!Number.isFinite(item.hour) || item.hour < 0 || item.hour > dataset?.scenario?.duration_hours || typeof item.action !== 'string' || !item.action.trim()) errors.push(`department demo row ${item.id} has invalid values`)
  return { valid: errors.length === 0, errors }
}

export function cityDemoData(dataset, cityId) {
  if (!validateDemoDataset(dataset).valid) return null
  const city = dataset.cities.find((row) => row.city_id === cityId)
  if (!city) return null
  return {
    city,
    timeline: dataset.timeline.filter((row) => row.city_id === cityId),
    points: dataset.points.filter((row) => row.city_id === cityId),
    residentImpacts: dataset.resident_impacts.filter((row) => row.city_id === cityId),
    departmentResponses: dataset.department_responses.filter((row) => row.city_id === cityId),
  }
}
