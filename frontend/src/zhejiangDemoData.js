const CITY_IDS = ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']
const ALLOWED_SEVERITY = new Set(['watch', 'warning', 'severe'])
const SIMULATOR = 'synthetic-typhoon-v2'

export function validateDemoDataset(dataset) {
  const errors = []
  if (!dataset || dataset.schema_version !== 1 || dataset.dataset_type !== 'simulated_demo' || typeof dataset.dataset_id !== 'string' || !dataset.dataset_id.trim()) errors.push('dataset must use simulated_demo schema v1')
  if (dataset?.label !== '模拟台风演示 · 非实时数据') errors.push('dataset must carry the explicit simulated typhoon demo label')
  if (dataset?.time_zone !== 'Asia/Shanghai' || dataset?.time_basis !== 'relative_hours_from_scenario_start' || dataset?.observation_time !== null || dataset?.actual_available_at !== null) errors.push('simulation time basis must not masquerade as observation availability')
  if (dataset?.spatial_reference !== 'EPSG:4326' || dataset?.quality_mark !== 'synthetic_demo_only' || dataset?.missing_value !== null || !dataset?.source_catalog?.some((source) => source.id === SIMULATOR && source.type === 'synthetic_generator')) errors.push('simulation spatial, quality or source metadata is incomplete')
  if (!Array.isArray(dataset?.cities) || !Array.isArray(dataset?.timeline) || !Array.isArray(dataset?.points) || !Array.isArray(dataset?.point_impacts) || !Array.isArray(dataset?.storm_track) || !Array.isArray(dataset?.resident_impacts) || !Array.isArray(dataset?.department_responses)) errors.push('dataset collections are required')
  if (!Number.isFinite(Date.parse(dataset?.generated_at)) || dataset?.scenario?.duration_hours !== 72 || dataset.scenario.landfall_hour !== 24 || !Number.isInteger(dataset.scenario.default_hour) || dataset.scenario.default_hour < 0 || dataset.scenario.default_hour > 72 || dataset.scenario.time_step_hours !== 1 || dataset.scenario.forecast_update_interval_hours !== 6 || dataset.scenario.rule_version !== SIMULATOR) errors.push('scenario metadata must define the 72-hour hourly / 6-hour update contract')
  const cityIds = (dataset?.cities || []).map((city) => city?.city_id)
  if (Array.isArray(dataset?.cities) && (CITY_IDS.some((id) => !cityIds.includes(id)) || new Set(cityIds).size !== CITY_IDS.length || cityIds.length !== CITY_IDS.length)) errors.push('exactly the four Zhejiang cities are required')
  for (const city of dataset?.cities || []) if (!ALLOWED_SEVERITY.has(city?.status) || !Number.isFinite(city.rainfall_6h_mm) || city.rainfall_6h_mm < 0 || !Number.isFinite(city.exposed_population) || city.exposed_population < 0) errors.push(`city ${city?.city_id || '(unknown)'} has invalid demo indicators`)

  const collections = ['timeline', 'points', 'point_impacts', 'resident_impacts', 'department_responses']
  const rows = collections.flatMap((key) => Array.isArray(dataset?.[key]) ? dataset[key] : [])
  const rowIds = new Set()
  for (const row of rows) {
    if (row.evidence_type !== 'simulated_scenario' || row.source_id !== SIMULATOR) errors.push(`row ${row.id || '(unknown)'} is not explicitly simulated`)
    if (!CITY_IDS.includes(row.city_id)) errors.push(`row ${row.id || '(unknown)'} has an unsupported city`)
    if (typeof row.id !== 'string' || !row.id || rowIds.has(row.id)) errors.push('demo record ids must be unique')
    rowIds.add(row.id)
  }
  const hoursByCity = new Map(CITY_IDS.map((id) => [id, new Set()]))
  for (const item of dataset?.timeline || []) {
    if (!ALLOWED_SEVERITY.has(item.severity) || !Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || !Number.isFinite(item.rainfall_mm) || item.rainfall_mm < 0 || !Number.isFinite(item.rainfall_rate_mm_h) || item.rainfall_rate_mm_h < 0 || !Number.isFinite(item.rainfall_6h_mm) || item.rainfall_6h_mm < 0 || ![item.river_level_index, item.tide_index, item.drainage_index, item.water_index].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) || item.forecast_cycle_hour !== Math.floor(item.hour / 6) * 6 || item.is_forecast_update !== (item.hour % 6 === 0)) errors.push(`timeline ${item.id} has invalid hourly values or update cycle`)
    hoursByCity.get(item.city_id)?.add(item.hour)
  }
  for (const cityId of CITY_IDS) if (hoursByCity.get(cityId)?.size !== 73) errors.push(`timeline for ${cityId} must contain every hour from 0 to 72`)

  const pointIds = new Set((dataset?.points || []).map((item) => item.id))
  for (const item of dataset?.points || []) {
    const [lon, lat] = item.coordinates || []
    if (!Array.isArray(item.coordinates) || item.coordinates.length !== 2 || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 118 || lon > 124 || lat < 27 || lat > 32 || !Number.isFinite(item.depth_cm) || item.depth_cm < 0 || !Number.isFinite(item.onset_hour) || item.onset_hour < 0 || item.onset_hour > 72 || !item.area?.startsWith('演示微区')) errors.push(`point ${item.id} has invalid demo values`)
  }
  const pointHours = new Map()
  for (const item of dataset?.point_impacts || []) {
    const point = dataset?.points?.find((candidate) => candidate.id === item.point_id)
    if (!pointIds.has(item.point_id) || point?.city_id !== item.city_id || !Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || !Number.isFinite(item.depth_cm) || item.depth_cm < 0 || item.depth_cm > (point?.depth_cm ?? 0) || !ALLOWED_SEVERITY.has(item.severity)) errors.push(`point impact ${item.id} has invalid values`)
    const key = `${item.point_id}-${item.hour}`
    if (pointHours.has(key)) errors.push(`point impact ${key} is duplicated`)
    pointHours.set(key, true)
  }
  if (pointHours.size !== pointIds.size * 73) errors.push('every demo point must have a depth value for all 73 hours')
  if ((dataset?.resident_impacts?.length || 0) !== CITY_IDS.length * 73) errors.push('resident-impact scenarios must contain one hourly aggregate for every city')
  if ((dataset?.department_responses?.length || 0) !== CITY_IDS.length * 13) errors.push('department suggestions must contain one six-hour-cycle recommendation per city')
  const trackHours = new Set()
  for (const item of dataset?.storm_track || []) {
    const [lon, lat] = item.coordinates || []
    if (item.evidence_type !== 'simulated_scenario' || item.source_id !== SIMULATOR || !Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 118 || lon > 126 || lat < 24 || lat > 33) errors.push(`storm track ${item.id} has invalid simulated coordinates`)
    trackHours.add(item.hour)
  }
  if (trackHours.size !== 73) errors.push('storm track must contain every simulated hour')

  for (const item of dataset?.resident_impacts || []) {
    const values = [item.population_exposed, item.stay, item.self_evacuate, item.assisted, item.shelter_demand]
    if (!Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || !values.every((value) => Number.isSafeInteger(value) && value >= 0) || item.stay + item.self_evacuate + item.assisted !== item.population_exposed || item.shelter_demand > item.population_exposed) errors.push(`resident demo row ${item.id} has inconsistent hourly aggregate values`)
  }
  for (const item of dataset?.department_responses || []) if (!Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || item.hour % 6 !== 0 || item.action_type !== 'recommendation_only' || item.status !== '待人工复核' || typeof item.action !== 'string' || !item.action.trim()) errors.push(`department demo row ${item.id} must be a six-hour human-review recommendation, not an actual response`)
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
    pointImpacts: dataset.point_impacts.filter((row) => row.city_id === cityId),
    residentImpacts: dataset.resident_impacts.filter((row) => row.city_id === cityId),
    departmentResponses: dataset.department_responses.filter((row) => row.city_id === cityId),
    stormTrack: dataset.storm_track,
  }
}

export function demoPointDepth(point, hour, datasetOrTimeline) {
  if (!point || !Number.isFinite(hour) || hour < 0) return 0
  if (!Array.isArray(datasetOrTimeline)) {
    const value = datasetOrTimeline?.point_impacts?.find((row) => row.point_id === point.id && row.hour === hour)
    return value?.depth_cm ?? 0
  }
  if (!Number.isFinite(point.depth_cm) || hour < point.onset_hour) return 0
  const peakIndex = Math.max(...datasetOrTimeline.map((row) => row.water_index), 0.01)
  const currentIndex = datasetOrTimeline.find((row) => row.hour === hour)?.water_index || 0
  const impactFactor = Math.min(1, currentIndex / peakIndex)
  return Math.round(point.depth_cm * (0.35 + 0.65 * impactFactor))
}

export function demoCityAtHour(dataset, cityId, hour) {
  const row = dataset?.timeline?.find((item) => item.city_id === cityId && item.hour === hour)
  if (!row) return null
  const points = dataset.points.filter((point) => point.city_id === cityId).map((point) => ({ ...point, current_depth_cm: demoPointDepth(point, hour, dataset) }))
  const activePoints = points.filter((point) => point.current_depth_cm >= 8)
  return { ...row, status_label: ({ severe: '高影响情景', warning: '重点关注情景', watch: '常态监测情景' })[row.severity], points, activePoints, peak_depth_cm: Math.max(0, ...points.map((point) => point.current_depth_cm)) }
}

export function demoResidentAtHour(dataset, cityId, hour) {
  const matches = dataset?.resident_impacts?.filter((row) => row.city_id === cityId && row.hour === hour) || []
  return matches.reduce((sum, row) => ({
    exposed: sum.exposed + row.population_exposed,
    stay: sum.stay + row.stay,
    self: sum.self + row.self_evacuate,
    assist: sum.assist + row.assisted,
    shelter: sum.shelter + row.shelter_demand,
  }), { exposed: 0, stay: 0, self: 0, assist: 0, shelter: 0 })
}

export function demoTimeLabel(hour, landfallHour = 24) {
  const offset = hour - landfallHour
  return offset === 0 ? '登陆时刻 T0' : offset < 0 ? `T−${Math.abs(offset)} h` : `T+${offset} h`
}

export function demoPointAdvice(point, depthCm = point?.depth_cm) {
  if (!point || !Number.isFinite(depthCm) || depthCm < 0) return '先核验点位和数据完整性，再形成现场建议。'
  if (depthCm >= 60) return '优先现场测深并核对周边下穿、低洼路段；达到当地管控阈值时，评估临时交通管控与绕行。'
  if (depthCm >= 30) return '现场复核积水变化和通行条件，检查雨水口、泵站及相邻道路，准备必要的绕行预案。'
  if (depthCm >= 8) return '建议巡查并核对积水是否持续发展；确认水深、流速和通行状态后再评估下一步措施。'
  return '持续观察积水趋势并检查排水口；现场核实前不据此发布风险结论。'
}
