import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const SOURCE = 'synthetic-typhoon-v2'
const cities = [
  { id: 'ningbo', code: 'NB', center: [121.55, 29.87], population: 18400, rainPeak: 29, rainMax: 38, width: 7.5, tidePhase: 3, tideScale: 0.95, drainage: 0.48, riverBase: 0.24, points: [[121.515, 29.845, 42], [121.535, 29.895, 68], [121.585, 29.865, 76], [121.615, 29.915, 31]] },
  { id: 'taizhou', code: 'TZ', center: [121.42, 28.66], population: 9600, rainPeak: 20, rainMax: 42, width: 7, tidePhase: -1, tideScale: 0.92, drainage: 0.57, riverBase: 0.2, points: [[121.385, 28.635, 35], [121.415, 28.685, 53], [121.455, 28.655, 27], [121.485, 28.715, 18]] },
  { id: 'wenzhou', code: 'WZ', center: [120.7, 27.99], population: 15200, rainPeak: 15, rainMax: 44, width: 7.5, tidePhase: -3, tideScale: 0.98, drainage: 0.44, riverBase: 0.29, points: [[120.655, 27.965, 48], [120.685, 28.005, 82], [120.735, 27.985, 65], [120.765, 28.045, 33]] },
  { id: 'hangzhou', code: 'HZ', center: [120.15, 30.25], population: 7100, rainPeak: 39, rainMax: 31, width: 8.5, tidePhase: 7, tideScale: 0.38, drainage: 0.69, riverBase: 0.21, points: [[120.125, 30.245, 24], [120.155, 30.285, 38], [120.195, 30.255, 19], [120.225, 30.315, 28]] },
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
const pointSeeds = cities.flatMap((city) => city.points.map(([lon, lat, peakDepth], index) => ({
  id: `${city.code.toLowerCase()}-p${index + 1}`,
  city_id: city.id,
  label: `${city.code}-${String(index + 1).padStart(2, '0')}`,
  coordinates: [lon, lat],
  depth_cm: peakDepth,
  severity: peakDepth >= 60 ? 'severe' : peakDepth >= 30 ? 'warning' : 'watch',
  onset_hour: 72,
  area: `演示微区 ${String.fromCharCode(65 + index)}`,
  susceptibility: [0.92, 1.05, 1.12, 0.78][index],
  evidence_type: 'simulated_scenario',
  source_id: SOURCE,
})))

const pointImpacts = pointSeeds.flatMap((point) => {
  const cityRows = timeline.filter((row) => row.city_id === point.city_id)
  const cityMaximum = Math.max(...cityRows.map((row) => row.water_index), 0.1)
  const depths = cityRows.map((row) => Math.round(point.depth_cm * clamp((row.water_index - 0.13) / Math.max(0.3, cityMaximum - 0.13)) ** 1.2 * point.susceptibility))
  const onset = depths.findIndex((depth) => depth > 0)
  point.onset_hour = onset < 0 ? 72 : onset
  return cityRows.map((row, index) => ({
    id: `${point.id}-h${String(row.hour).padStart(2, '0')}`,
    city_id: point.city_id,
    point_id: point.id,
    hour: row.hour,
    depth_cm: Math.min(point.depth_cm, depths[index]),
    severity: depths[index] >= 60 ? 'severe' : depths[index] >= 30 ? 'warning' : depths[index] > 0 ? 'watch' : 'watch',
    evidence_type: 'simulated_scenario',
    source_id: SOURCE,
  }))
})

const residentImpacts = cities.flatMap((city) => timeline.filter((row) => row.city_id === city.id).map((row) => {
  const exposureFactor = clamp((row.water_index - 0.16) / 0.58)
  const population = Math.round(city.population * exposureFactor)
  const assisted = Math.round(population * (0.12 + 0.1 * row.water_index))
  const selfEvacuate = Math.round((population - assisted) * (0.25 + 0.08 * row.water_index))
  const stay = population - assisted - selfEvacuate
  return {
    id: `${city.id}-res-h${String(row.hour).padStart(2, '0')}`,
    city_id: city.id,
    hour: row.hour,
    area: '情景覆盖微区合计',
    population_exposed: population,
    stay,
    self_evacuate: selfEvacuate,
    assisted,
    shelter_demand: Math.round(assisted * 0.7),
    evidence_type: 'simulated_scenario',
    source_id: SOURCE,
  }
}))

const departmentResponses = cities.flatMap((city) => timeline.filter((row) => row.city_id === city.id && row.hour % 6 === 0).map((row) => {
  const impacts = pointImpacts.filter((item) => item.city_id === city.id && item.hour === row.hour)
  const deepest = impacts.reduce((best, item) => !best || item.depth_cm > best.depth_cm ? item : best, null)
  const point = pointSeeds.find((item) => item.id === deepest?.point_id)
  const action = !deepest || deepest.depth_cm < 8
    ? '建议核查未来6小时降雨、水情、演示点位和排水设施值守安排'
    : deepest.depth_cm >= 60
      ? `建议优先现场核验 ${point.label}（${point.area}），并依属地预案评估交通与人员安全措施`
      : deepest.depth_cm >= 30
        ? `建议现场复核 ${point.label}（${point.area}）水深、通行状态及相邻排水设施`
        : `建议巡查 ${point.label}（${point.area}）并复核短时雨强和积水变化`
  return {
    id: `${city.id}-advice-h${String(row.hour).padStart(2, '0')}`,
    city_id: city.id,
    hour: row.hour,
    action,
    status: '待人工复核',
    action_type: 'recommendation_only',
    area: point?.area || '四城情景范围',
    point_id: point?.id || null,
    depth_cm: deepest?.depth_cm || 0,
    evidence_type: 'simulated_scenario',
    source_id: SOURCE,
  }
}))

const dataset = {
  schema_version: 1,
  dataset_id: 'zhejiang-typhoon-demo-v2',
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
  source_catalog: [{ id: SOURCE, type: 'synthetic_generator', description: '用于演示台风路径、城市水情压力、点位积水、居民影响情景和核查建议的确定性规则合成器；不代表观测、预报、居民行为或部门行动。', license_note: '不包含第三方事实数据；仅用于项目演示，独立再利用前应确认许可并保留模拟标识。' }],
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
    return { city_id: city.id, status: row.severity, status_label: severityLabel(row.severity), rainfall_6h_mm: row.rainfall_6h_mm, river_level_index: row.river_level_index, tide_index: row.tide_index, drainage_index: row.drainage_index, exposed_population: city.population }
  }),
  timeline,
  storm_track: makeTrack(),
  points: pointSeeds,
  point_impacts: pointImpacts,
  resident_impacts: residentImpacts,
  department_responses: departmentResponses,
}

const output = resolve(fileURLToPath(new URL('../public/data/zhejiang-demo-snapshot.json', import.meta.url)))
await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`)
console.log(`Wrote ${output}: ${timeline.length} city-hour rows, ${pointImpacts.length} point-hour rows, ${residentImpacts.length} resident-hour rows.`)
