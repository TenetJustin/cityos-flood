import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  demoActionForPoint,
  estimateResidentScenario,
  makeDemoPointResult,
  makeSyntheticRainfallGrid,
  syntheticTerrainElevation,
} from '../src/demoFloodModel.js'

const SOURCE = 'synthetic-typhoon-v3'
const cities = [
  { id: 'ningbo', code: 'NB', center: [121.55, 29.87], population: 18400, rainPeak: 29, rainMax: 38, width: 7.5, tidePhase: 3, tideScale: 0.95, drainage: 0.48, riverBase: 0.24 },
  { id: 'taizhou', code: 'TZ', center: [121.42, 28.66], population: 9600, rainPeak: 20, rainMax: 42, width: 7, tidePhase: -1, tideScale: 0.92, drainage: 0.57, riverBase: 0.2 },
  { id: 'wenzhou', code: 'WZ', center: [120.7, 27.99], population: 15200, rainPeak: 15, rainMax: 44, width: 7.5, tidePhase: -3, tideScale: 0.98, drainage: 0.44, riverBase: 0.29 },
  { id: 'hangzhou', code: 'HZ', center: [120.15, 30.25], population: 7100, rainPeak: 39, rainMax: 31, width: 8.5, tidePhase: 7, tideScale: 0.38, drainage: 0.69, riverBase: 0.21 },
]

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const round = (value, digits = 0) => Number(value.toFixed(digits))
const severity = (index) => index >= 0.72 ? 'severe' : index >= 0.42 ? 'warning' : 'watch'
const severityLabel = (value) => ({ severe: '高影响情景', warning: '重点关注情景', watch: '常态监测情景' })[value]

function makeTimeline(city) {
  const result = []
  let cumulative = 0
  let memory = 0
  for (let hour = 0; hour <= 72; hour += 1) {
    const eventHour = hour - 24
    const primary = city.rainMax * Math.exp(-0.5 * ((eventHour - city.rainPeak) / city.width) ** 2)
    const secondary = city.rainMax * 0.38 * Math.exp(-0.5 * ((eventHour - city.rainPeak - 14) / (city.width * 1.2)) ** 2)
    const rainfallRate = round(primary + secondary, 1)
    cumulative = round(cumulative + rainfallRate, 1)
    memory = clamp(memory * 0.87 + rainfallRate / 65 * 0.13)
    const rain6 = round(result.slice(-5).reduce((sum, row) => sum + row.rainfall_rate_mm_h, rainfallRate), 1)
    const tide = clamp(0.46 + city.tideScale * 0.27 * Math.cos((eventHour - city.tidePhase) * 2 * Math.PI / 12.4))
    const river = clamp(city.riverBase + 0.25 * clamp(rain6 / 170) + 0.19 * memory)
    const water = clamp(0.02 + 0.43 * clamp(rain6 / 180) + 0.23 * memory + 0.19 * river + 0.1 * tide - 0.1 * city.drainage)
    result.push({
      id: `${city.id}-h${String(hour).padStart(2, '0')}`,
      city_id: city.id,
      hour,
      event_hour: eventHour,
      rainfall_rate_mm_h: rainfallRate,
      rainfall_6h_mm: rain6,
      rainfall_mm: cumulative,
      river_level_index: round(river, 3),
      tide_index: round(tide, 3),
      drainage_index: round(city.drainage, 3),
      rain_memory_index: round(memory, 3),
      water_index: round(water, 3),
      severity: severity(water),
      forecast_cycle_hour: Math.floor(hour / 6) * 6,
      is_forecast_update: hour % 6 === 0,
      evidence_type: 'simulated_scenario',
      source_id: SOURCE,
    })
  }
  return result
}

function makeTrack() {
  const result = []
  const waypoints = [
    { hour: 0, lon: 124.2, lat: 26.0, wind: 32 },
    { hour: 12, lon: 123.2, lat: 27.0, wind: 38 },
    { hour: 24, lon: 121.8, lat: 28.45, wind: 42 },
    { hour: 42, lon: 120.5, lat: 29.7, wind: 28 },
    { hour: 72, lon: 118.9, lat: 31.0, wind: 16 },
  ]
  for (let hour = 0; hour <= 72; hour += 1) {
    const left = [...waypoints].reverse().find((point) => point.hour <= hour) || waypoints[0]
    const right = waypoints.find((point) => point.hour >= hour) || waypoints.at(-1)
    const mix = left === right ? 0 : (hour - left.hour) / (right.hour - left.hour)
    result.push({
      id: `track-h${String(hour).padStart(2, '0')}`,
      hour,
      event_hour: hour - 24,
      coordinates: [round(left.lon + (right.lon - left.lon) * mix, 3), round(left.lat + (right.lat - left.lat) * mix, 3)],
      wind_speed_ms: round(left.wind + (right.wind - left.wind) * mix, 1),
      evidence_type: 'simulated_scenario',
      source_id: SOURCE,
    })
  }
  return result
}

const timeline = cities.flatMap(makeTimeline)
const pointSeeds = cities.flatMap((city) => Array.from({ length: 25 }, (_, index) => {
  const gridX = index % 5
  const gridY = Math.floor(index / 5)
  const terrainX = (gridX - 2) * 3
  const terrainZ = (gridY - 2) * 3
  const lonOffset = (gridX - 2) * 0.009
  const latOffset = (gridY - 2) * 0.007
  const relativeElevation = syntheticTerrainElevation(terrainX, terrainZ)
  const variation = ((gridX * 7 + gridY * 11 + city.code.charCodeAt(0)) % 11) / 20
  const drainage = clamp(city.drainage + ((gridX + gridY) % 5 - 2) * 0.035)
  return {
    id: `${city.code.toLowerCase()}-p${String(index + 1).padStart(3, '0')}`,
    city_id: city.id,
    label: `${city.code}-${String(index + 1).padStart(2, '0')}`,
    coordinates: [round(city.center[0] + lonOffset / Math.cos(city.center[1] * Math.PI / 180), 5), round(city.center[1] + latOffset, 5)],
    terrain_x: terrainX,
    terrain_z: terrainZ,
    relative_elevation_m: relativeElevation,
    depth_cm: 0,
    severity: 'dry',
    onset_hour: 72,
    area: `演示微区 ${String.fromCharCode(65 + gridY)}${gridX + 1}`,
    population_base: Math.round((city.population / 25) * (0.66 + variation)),
    vulnerable_share: round(0.12 + ((gridX * 3 + gridY * 2) % 7) * 0.025, 3),
    road_criticality_index: round(0.28 + ((gridX * 5 + gridY * 3) % 8) * 0.08, 3),
    imperviousness_index: round(0.48 + ((gridX * 2 + gridY * 5) % 7) * 0.065, 3),
    drainage_capacity_index: round(drainage, 3),
    river_exposure_index: round(0.18 + ((gridX + 2 * gridY) % 7) * 0.08, 3),
    coastal_exposure_index: round(clamp(city.tideScale * (0.35 + ((gridX * 3 + gridY) % 5) * 0.13)), 3),
    flatness_index: round(0.55 + ((gridX * 4 + gridY * 3) % 5) * 0.075, 3),
    evidence_type: 'simulated_scenario',
    source_id: SOURCE,
  }
}))

const pointImpacts = pointSeeds.flatMap((point) => {
  const cityRows = timeline.filter((row) => row.city_id === point.city_id)
  const impacts = cityRows.map((row) => ({ ...makeDemoPointResult(point, row), id: `${point.id}-h${String(row.hour).padStart(2, '0')}`, point_id: point.id }))
  const active = impacts.filter((item) => item.depth_cm >= 8)
  point.depth_cm = impacts.reduce((maximum, item) => Math.max(maximum, item.depth_cm), 0)
  point.severity = impacts.reduce((deepest, item) => item.depth_cm > deepest.depth_cm ? item : deepest, impacts[0]).severity
  point.onset_hour = active[0]?.hour ?? 72
  return impacts
})

const residentPointImpacts = pointImpacts.map((impact) => {
  const point = pointSeeds.find((candidate) => candidate.id === impact.point_id)
  const people = estimateResidentScenario(point, impact.depth_cm)
  return {
    id: `${impact.id}-resident`,
    city_id: impact.city_id,
    point_id: impact.point_id,
    hour: impact.hour,
    area: point.area,
    population_exposed: people.exposed,
    stay: people.stay,
    self_evacuate: people.self,
    assisted: people.assisted,
    shelter_demand: people.shelter,
    evidence_type: 'simulated_scenario',
    source_id: SOURCE,
  }
})

const residentImpacts = cities.flatMap((city) => timeline.filter((row) => row.city_id === city.id).map((row) => {
  const local = residentPointImpacts.filter((item) => item.city_id === city.id && item.hour === row.hour)
  const totals = local.reduce((sum, item) => ({
    exposed: sum.exposed + item.population_exposed,
    stay: sum.stay + item.stay,
    self: sum.self + item.self_evacuate,
    assisted: sum.assisted + item.assisted,
    shelter: sum.shelter + item.shelter_demand,
  }), { exposed: 0, stay: 0, self: 0, assisted: 0, shelter: 0 })
  return {
    id: `${city.id}-res-h${String(row.hour).padStart(2, '0')}`,
    city_id: city.id,
    hour: row.hour,
    area: '演示微区聚合',
    population_exposed: totals.exposed,
    stay: totals.stay,
    self_evacuate: totals.self,
    assisted: totals.assisted,
    shelter_demand: totals.shelter,
    evidence_type: 'simulated_scenario',
    source_id: SOURCE,
  }
}))

const rainfallGrid = cities.flatMap((city) => {
  const cityRows = timeline.filter((row) => row.city_id === city.id)
  return cityRows.flatMap((row) => makeSyntheticRainfallGrid(city, cityRows, row.hour).map((cell) => ({
    ...cell,
    hour: row.hour,
    forecast_cycle_hour: row.forecast_cycle_hour,
  })))
})

const departmentResponses = cities.flatMap((city) => timeline.filter((row) => row.city_id === city.id && row.hour % 6 === 0).map((row) => {
  const impacts = pointImpacts.filter((item) => item.city_id === city.id && item.hour === row.hour)
  const ranked = impacts.filter((item) => item.depth_cm >= 8).sort((left, right) => left.priority_tier.localeCompare(right.priority_tier) || right.priority_score - left.priority_score)
  const highest = ranked[0] || impacts.reduce((best, item) => !best || item.depth_cm > best.depth_cm ? item : best, null)
  const point = pointSeeds.find((item) => item.id === highest?.point_id)
  const suggestion = demoActionForPoint(point, highest?.depth_cm || 0)
  return {
    id: `${city.id}-advice-h${String(row.hour).padStart(2, '0')}`,
    city_id: city.id,
    hour: row.hour,
    action: suggestion.action,
    resource_types: suggestion.resource_types,
    status: '待人工复核',
    action_type: 'recommendation_only',
    area: point?.area || '四城情景范围',
    point_id: highest?.point_id || null,
    priority_score: highest?.priority_score || 0,
    priority_tier: highest?.priority_tier || 'P4',
    depth_cm: highest?.depth_cm || 0,
    ranked_point_ids: ranked.slice(0, 5).map((item) => item.point_id),
    evidence_type: 'simulated_scenario',
    source_id: SOURCE,
  }
}))

const dataset = {
  schema_version: 2,
  dataset_id: 'zhejiang-typhoon-demo-v3',
  dataset_type: 'simulated_demo',
  label: '模拟台风演示 · 非实时数据',
  generated_at: new Date().toISOString(),
  time_zone: 'Asia/Shanghai',
  time_basis: 'relative_hours_from_scenario_start',
  observation_time: null,
  actual_available_at: null,
  spatial_reference: 'EPSG:4326',
  units: { rainfall: 'mm; hourly rate and scenario cumulative', depth: 'cm, synthetic', population: 'people, synthetic aggregates', indices: 'dimensionless, 0-1', track_wind: 'm/s, synthetic' },
  quality_mark: 'synthetic_demo_only',
  missing_value: null,
  source_catalog: [{ id: SOURCE, type: 'synthetic_generator', description: '用于演示台风路径、四城逐小时雨量格点、相对高程网格、积水点位筛查、居民情景和人工复核建议的确定性规则合成器；不代表观测、预报、居民行为或部门行动。', license_note: '不包含第三方事实数据；仅用于项目演示，独立再利用前应确认许可并保留模拟标识。' }],
  model: {
    engine: 'transparent_screening_equation',
    version: 'zhejiang-screening-equation-v1',
    hydrodynamic_solver: null,
    calibrated: false,
    description: '演示用气象/潮河驱动与相对地形、地表属性筛查公式；不是 SWMM、SFINCS 或 ANUGA 求解结果。',
  },
  scenario: {
    id: 'zhejiang-synthetic-typhoon-01',
    name: '浙江近海模拟台风 A',
    description: '模拟台风登陆前24小时至登陆后48小时的四城复合降雨、潮位、河流水情及排水压力过程。所有数值、轨迹、点位、人数和建议均为规则合成，仅用于展示系统工作流。',
    duration_hours: 72,
    landfall_hour: 24,
    time_step_hours: 1,
    forecast_update_interval_hours: 6,
    default_hour: 48,
    rule_version: SOURCE,
    update_note: '每6小时形成一次情景驱动更新；每个小时展示插值/规则演算状态，不代表每小时取得了真实新观测。',
  },
  cities: cities.map((city) => {
    const row = timeline.find((item) => item.city_id === city.id && item.hour === 48)
    return { city_id: city.id, center: city.center, status: row.severity, status_label: severityLabel(row.severity), rainfall_6h_mm: row.rainfall_6h_mm, river_level_index: row.river_level_index, tide_index: row.tide_index, drainage_index: row.drainage_index, exposed_population: city.population }
  }),
  timeline,
  storm_track: makeTrack(),
  points: pointSeeds,
  department_responses: departmentResponses,
}

const output = resolve(fileURLToPath(new URL('../public/data/zhejiang-demo-snapshot.json', import.meta.url)))
await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`)
const gisHour = dataset.scenario.default_hour
const pointById = new Map(pointSeeds.map((point) => [point.id, point]))
const gisFeatures = [
  ...pointImpacts.filter((item) => item.hour === gisHour).map((impact) => {
    const point = pointById.get(impact.point_id)
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point.coordinates },
      properties: {
        layer: 'synthetic_flood_screening',
        city_id: point.city_id,
        point_id: point.id,
        label: point.label,
        area: point.area,
        hour: gisHour,
        depth_cm: impact.depth_cm,
        severity: impact.severity,
        priority_score: impact.priority_score,
        priority_tier: impact.priority_tier,
        relative_elevation_m: point.relative_elevation_m,
        model_version: 'zhejiang-screening-equation-v1',
        evidence_type: impact.evidence_type,
        source_id: impact.source_id,
      },
    }
  }),
  ...rainfallGrid.filter((cell) => cell.hour === gisHour).map((cell) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: cell.coordinates },
    properties: {
      layer: 'synthetic_rainfall_grid',
      city_id: cell.city_id,
      hour: gisHour,
      rainfall_rate_mm_h: cell.rainfall_rate_mm_h,
      rainfall_6h_mm: cell.rainfall_6h_mm,
      evidence_type: cell.evidence_type,
      source_id: cell.source_id,
    },
  })),
]
const gisOutput = resolve(fileURLToPath(new URL('../public/data/zhejiang-demo-peak.geojson', import.meta.url)))
await writeFile(gisOutput, `${JSON.stringify({ type: 'FeatureCollection', name: 'CityOS synthetic typhoon demo · T+24h', features: gisFeatures }, null, 2)}\n`)
console.log(`Wrote ${output}: ${timeline.length} hourly forcing rows, ${pointSeeds.length} synthetic microzones and ${departmentResponses.length} six-hour recommendations; hourly screening outputs are derived at runtime.`)
console.log(`Wrote ${gisOutput}: ${gisFeatures.length} GeoJSON features for QGIS/GDAL inspection at demo hour ${gisHour}.`)
