import {
  DEMO_MODEL_VERSION,
  demoActionForPoint,
  estimateResidentScenario,
  makeDemoPointResult,
  makeSyntheticRainfallGrid,
} from './demoFloodModel.js'

const CITY_IDS = ['ningbo', 'taizhou', 'wenzhou', 'hangzhou']
const ALLOWED_SEVERITY = new Set(['watch', 'warning', 'severe'])
const SIMULATOR = 'synthetic-typhoon-v3'
export const HYDRAULIC_MODEL_VERSION = 'epa-swmm-5.2.4-synthetic-v1'

export function validateDemoDataset(dataset) {
  const errors = []
  if (!dataset || dataset.schema_version !== 2 || dataset.dataset_type !== 'simulated_demo' || typeof dataset.dataset_id !== 'string' || !dataset.dataset_id.trim()) errors.push('dataset must use simulated_demo schema v2')
  if (dataset?.label !== '模拟台风演示 · 非实时数据') errors.push('dataset must carry the explicit simulated typhoon demo label')
  if (dataset?.time_zone !== 'Asia/Shanghai' || dataset?.time_basis !== 'relative_hours_from_scenario_start' || dataset?.observation_time !== null || dataset?.actual_available_at !== null) errors.push('simulation time basis must not masquerade as observation availability')
  if (dataset?.spatial_reference !== 'EPSG:4326' || dataset?.quality_mark !== 'synthetic_demo_only' || dataset?.missing_value !== null || !dataset?.source_catalog?.some((source) => source.id === SIMULATOR && source.type === 'synthetic_generator')) errors.push('simulation spatial, quality or source metadata is incomplete')
  if (!Array.isArray(dataset?.cities) || !Array.isArray(dataset?.timeline) || !Array.isArray(dataset?.points) || !Array.isArray(dataset?.storm_track) || !Array.isArray(dataset?.department_responses)) errors.push('dataset inputs and recommendation collections are required')
  const hydraulic = dataset?.model?.engine === 'epa_swmm'
  if (dataset?.model?.calibrated !== false || (!hydraulic && (dataset?.model?.engine !== 'transparent_screening_equation' || dataset.model.version !== DEMO_MODEL_VERSION || dataset.model.hydrodynamic_solver !== null))) errors.push('demonstration model metadata is invalid')
  if (hydraulic) {
    const h = dataset.hydraulics
    if (dataset.model.version !== HYDRAULIC_MODEL_VERSION || dataset.model.hydrodynamic_solver !== 'EPA SWMM 5.2.4' || h?.model_version !== HYDRAULIC_MODEL_VERSION || h?.evidence_type !== 'simulated_scenario' || h?.calibrated !== false || h?.public_warning_ready !== false || h?.automatic_dispatch_ready !== false || h?.surface_extent_available !== false || h?.acceptance?.passed !== true || h?.depth_unit !== 'cm' || !/^[a-f0-9]{64}$/.test(h?.input_sha256 || '')) errors.push('SWMM provenance or safety gates invalid')
    for (const cityId of CITY_IDS) {
      const output = h?.cities?.[cityId]
      if (!output || !Object.values(output.continuity || {}).length || !Object.values(output.continuity).every((v) => Number.isFinite(v) && Math.abs(v) <= 1)) errors.push(`SWMM continuity missing or failed: ${cityId}`)
      for (const point of dataset.points || []) if (point.city_id === cityId) {
        const depths = output?.depth_cm_by_point?.[point.id]
        if (!Array.isArray(depths) || depths.length !== 73 || !depths.every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) errors.push(`SWMM hourly output invalid: ${point.id}`)
      }
      const plans = h?.resource_plans?.[cityId]
      if (!Array.isArray(plans) || plans.length !== 73 || plans.some((p, hour) => p.hour !== hour || p.evidence_type !== 'simulated_scenario' || p.status !== 'pending-human-review' || p.automatic_dispatch_ready !== false || p.assigned_teams > p.available_teams || p.assigned_teams + p.unmet_teams !== p.required_teams)) errors.push(`resource capacity contract invalid: ${cityId}`)
    }
  }
  if (!Number.isFinite(Date.parse(dataset?.generated_at)) || dataset?.scenario?.duration_hours !== 72 || dataset.scenario.landfall_hour !== 24 || !Number.isInteger(dataset.scenario.default_hour) || dataset.scenario.default_hour < 0 || dataset.scenario.default_hour > 72 || dataset.scenario.time_step_hours !== 1 || dataset.scenario.forecast_update_interval_hours !== 6 || dataset.scenario.rule_version !== SIMULATOR) errors.push('scenario metadata must define the 72-hour hourly / 6-hour update contract')

  const cityIds = (dataset?.cities || []).map((city) => city?.city_id)
  if (Array.isArray(dataset?.cities) && (CITY_IDS.some((id) => !cityIds.includes(id)) || new Set(cityIds).size !== CITY_IDS.length || cityIds.length !== CITY_IDS.length)) errors.push('exactly the four Zhejiang cities are required')
  for (const city of dataset?.cities || []) {
    const [lon, lat] = city.center || []
    if (!ALLOWED_SEVERITY.has(city?.status) || !Number.isFinite(city.rainfall_6h_mm) || city.rainfall_6h_mm < 0 || !Number.isFinite(city.exposed_population) || city.exposed_population < 0 || !Number.isFinite(lon) || !Number.isFinite(lat)) errors.push(`city ${city?.city_id || '(unknown)'} has invalid demo indicators or center`)
  }

  // The bundle stores only scenario forcings and spatial attributes. Rain cells,
  // point depths, priorities and population scenarios are computed at the
  // selected hour by the same transparent rules as the client-side display.
  const collections = ['timeline', 'points', 'storm_track', 'department_responses']
  const rows = collections.flatMap((key) => Array.isArray(dataset?.[key]) ? dataset[key] : [])
  const rowIds = new Set()
  for (const row of rows) {
    if (row.evidence_type !== 'simulated_scenario' || row.source_id !== SIMULATOR) errors.push(`row ${row.id || '(unknown)'} is not explicitly simulated`)
    if (row.city_id && !CITY_IDS.includes(row.city_id)) errors.push(`row ${row.id || '(unknown)'} has an unsupported city`)
    if (typeof row.id !== 'string' || !row.id || rowIds.has(row.id)) errors.push('demo record ids must be unique')
    rowIds.add(row.id)
  }

  const hoursByCity = new Map(CITY_IDS.map((id) => [id, new Set()]))
  for (const item of dataset?.timeline || []) {
    if (!CITY_IDS.includes(item.city_id) || !ALLOWED_SEVERITY.has(item.severity) || !Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || !Number.isFinite(item.rainfall_mm) || item.rainfall_mm < 0 || !Number.isFinite(item.rainfall_rate_mm_h) || item.rainfall_rate_mm_h < 0 || !Number.isFinite(item.rainfall_6h_mm) || item.rainfall_6h_mm < 0 || ![item.river_level_index, item.tide_index, item.drainage_index, item.water_index, item.rain_memory_index].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) || item.forecast_cycle_hour !== Math.floor(item.hour / 6) * 6 || item.is_forecast_update !== (item.hour % 6 === 0)) errors.push(`timeline ${item.id} has invalid hourly values or update cycle`)
    hoursByCity.get(item.city_id)?.add(item.hour)
  }
  for (const cityId of CITY_IDS) if (hoursByCity.get(cityId)?.size !== 73) errors.push(`timeline for ${cityId} must contain every hour from 0 to 72`)

  const pointsByCity = new Map(CITY_IDS.map((id) => [id, 0]))
  const pointIds = new Set()
  for (const item of dataset?.points || []) {
    const [lon, lat] = item.coordinates || []
    const indices = [item.imperviousness_index, item.drainage_capacity_index, item.river_exposure_index, item.coastal_exposure_index, item.flatness_index, item.vulnerable_share, item.road_criticality_index]
    if (!CITY_IDS.includes(item.city_id) || pointIds.has(item.id) || !Array.isArray(item.coordinates) || item.coordinates.length !== 2 || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 118 || lon > 124 || lat < 27 || lat > 32 || !Number.isFinite(item.depth_cm) || item.depth_cm < 0 || item.depth_cm > (hydraulic ? 1000 : 120) || !Number.isFinite(item.onset_hour) || item.onset_hour < 0 || item.onset_hour > 72 || !item.area?.startsWith('演示微区') || !Number.isFinite(item.relative_elevation_m) || item.relative_elevation_m < 0 || item.relative_elevation_m > 15 || !Number.isFinite(item.terrain_x) || !Number.isFinite(item.terrain_z) || !Number.isFinite(item.population_base) || item.population_base < 0 || !indices.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) errors.push(`point ${item.id || '(unknown)'} has invalid demo values`)
    pointIds.add(item.id)
    pointsByCity.set(item.city_id, (pointsByCity.get(item.city_id) || 0) + 1)
  }
  if (pointIds.size !== CITY_IDS.length * 25 || CITY_IDS.some((id) => pointsByCity.get(id) !== 25)) errors.push('each city must contain 25 synthetic microzones')

  const trackHours = new Set()
  for (const item of dataset?.storm_track || []) {
    const [lon, lat] = item.coordinates || []
    if (!Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 118 || lon > 126 || lat < 24 || lat > 33) errors.push(`storm track ${item.id} has invalid simulated coordinates`)
    trackHours.add(item.hour)
  }
  if (trackHours.size !== 73) errors.push('storm track must contain every simulated hour')
  const responseCounts = new Map(CITY_IDS.map((id) => [id, 0]))
  for (const item of dataset?.department_responses || []) {
    if (!Number.isInteger(item.hour) || item.hour < 0 || item.hour > 72 || item.hour % 6 !== 0 || item.action_type !== 'recommendation_only' || item.status !== '待人工复核' || typeof item.action !== 'string' || !item.action.trim() || !Array.isArray(item.resource_types) || !['P1', 'P2', 'P3', 'P4'].includes(item.priority_tier) || !Array.isArray(item.ranked_point_ids) || (item.point_id && !pointIds.has(item.point_id)) || item.ranked_point_ids.some((id) => !pointIds.has(id))) errors.push(`department demo row ${item.id} must be a six-hour human-review recommendation, not an actual response`)
    responseCounts.set(item.city_id, (responseCounts.get(item.city_id) || 0) + 1)
  }
  if (CITY_IDS.some((id) => responseCounts.get(id) !== 13)) errors.push('department suggestions must contain one six-hour recommendation per city')
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
    departmentResponses: dataset.department_responses.filter((row) => row.city_id === cityId),
    stormTrack: dataset.storm_track,
  }
}

export function demoPointResultAtHour(dataset, point, hour) {
  const row = dataset?.timeline?.find((item) => item.city_id === point?.city_id && item.hour === hour)
  if (dataset?.model?.engine === 'epa_swmm') {
    // Missing physical outputs never silently fall back to heuristic depths.
    const depth = dataset.hydraulics?.cities?.[point?.city_id]?.depth_cm_by_point?.[point?.id]?.[hour]
    return Number.isFinite(depth) ? makeDemoPointResult(point, row, depth) : null
  }
  return makeDemoPointResult(point, row)
}

export function demoPointState(point, hour, dataset) {
  return demoPointResultAtHour(dataset, point, hour)
}

export function demoRankedPoints(dataset, cityIds, hour) {
  const citySet = new Set(Array.isArray(cityIds) ? cityIds : [cityIds])
  return (dataset?.points || [])
    .filter((point) => citySet.has(point.city_id))
    .map((point) => demoPointResultAtHour(dataset, point, hour))
    .filter(Boolean)
    .sort((left, right) => left.priority_tier.localeCompare(right.priority_tier) || right.priority_score - left.priority_score || right.current_depth_cm - left.current_depth_cm)
}

export function demoRainfallGridAtHour(dataset, cityIds, hour) {
  const citySet = new Set(Array.isArray(cityIds) ? cityIds : [cityIds])
  return [...citySet].flatMap((cityId) => {
    const city = dataset?.cities?.find((item) => item.city_id === cityId)
    const rows = dataset?.timeline?.filter((item) => item.city_id === cityId) || []
    return city ? makeSyntheticRainfallGrid({ id: cityId, center: city.center }, rows, hour) : []
  })
}

export function demoPointDepth(point, hour, datasetOrTimeline) {
  if (!point || !Number.isFinite(hour) || hour < 0) return 0
  if (datasetOrTimeline?.model?.engine === 'epa_swmm') return demoPointResultAtHour(datasetOrTimeline, point, hour)?.current_depth_cm ?? null
  const row = Array.isArray(datasetOrTimeline)
    ? datasetOrTimeline.find((item) => item.city_id === point.city_id && item.hour === hour)
    : datasetOrTimeline?.timeline?.find((item) => item.city_id === point.city_id && item.hour === hour)
  return makeDemoPointResult(point, row)?.current_depth_cm || 0
}

export function demoCityAtHour(dataset, cityId, hour) {
  const row = dataset?.timeline?.find((item) => item.city_id === cityId && item.hour === hour)
  if (!row) return null
  const points = dataset.points.filter((point) => point.city_id === cityId).map((point) => demoPointState(point, hour, dataset)).filter(Boolean)
  const activePoints = points.filter((point) => point.current_depth_cm >= 8)
  return { ...row, status_label: ({ severe: '高影响情景', warning: '重点关注情景', watch: '常态监测情景' })[row.severity], points, activePoints, peak_depth_cm: Math.max(0, ...points.map((point) => point.current_depth_cm)) }
}

export function demoResidentAtHour(dataset, cityId, hour) {
  return (dataset?.points || [])
    .filter((point) => point.city_id === cityId)
    .map((point) => estimateResidentScenario(point, demoPointDepth(point, hour, dataset)))
    .reduce((sum, row) => ({
      exposed: sum.exposed + row.exposed,
      stay: sum.stay + row.stay,
      self: sum.self + row.self,
      assist: sum.assist + row.assisted,
      shelter: sum.shelter + row.shelter,
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

export { demoActionForPoint }
