const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const round = (value, digits = 0) => Number(value.toFixed(digits))

export const DEMO_MODEL_VERSION = 'zhejiang-screening-equation-v1'
export const DEMO_GRID_SIDE = 5

// Synthetic local relief only. The output is a relative demonstration surface,
// not a DEM, surveyed elevation, or vertically referenced height.
export function syntheticTerrainElevation(x, z) {
  const ridge = Math.sin(x * 0.42 + z * 0.18) * 0.16 + Math.cos(z * 0.55 - x * 0.2) * 0.12
  const basin = Math.exp(-((x - 2.5) ** 2 + (z + 1.8) ** 2) / 22) * -0.25
  const normalized = clamp(0.53 + ridge + basin + Math.sin(x * 0.13) * 0.08, 0.08, 0.94)
  return round(normalized * 15, 1)
}

export function pointForcingIndex(row) {
  if (!row) return 0
  return round(clamp(
    0.29 * clamp((row.rainfall_6h_mm || 0) / 180)
    + 0.19 * clamp((row.rainfall_rate_mm_h || 0) / 60)
    + 0.19 * clamp(row.river_level_index || 0)
    + 0.17 * clamp(row.tide_index || 0)
    + 0.16 * clamp(row.rain_memory_index || 0),
  ), 3)
}

export function pointSusceptibilityIndex(point) {
  if (!point) return 0
  const elevation = clamp(1 - (point.relative_elevation_m || 0) / 15)
  return round(clamp(
    0.34 * elevation
    + 0.20 * clamp(point.imperviousness_index || 0)
    + 0.18 * clamp(point.river_exposure_index || 0)
    + 0.14 * clamp(point.coastal_exposure_index || 0)
    + 0.14 * clamp(point.flatness_index || 0)
    - 0.20 * clamp(point.drainage_capacity_index || 0),
  ), 3)
}

// A transparent screening equation for the synthetic demonstration. It is not
// a shallow-water solver and must not be presented as a calibrated prediction.
export function estimateDemoDepthCm(point, row) {
  if (!point || !row) return 0
  const forcing = pointForcingIndex(row)
  const susceptibility = pointSusceptibilityIndex(point)
  const depth = 130 * Math.max(0, forcing - 0.25) * (0.60 + 0.85 * susceptibility)
  return Math.round(clamp(depth, 0, 120))
}

export function makeDemoPointResult(point, row, solverDepthCm) {
  if (!point || !row) return null
  const depth = solverDepthCm === undefined ? estimateDemoDepthCm(point, row) : solverDepthCm
  if (!Number.isFinite(depth) || depth < 0) return null
  const priority = rankDemoPoint(point, depth)
  return {
    ...point,
    id: `${point.id}-h${String(row.hour).padStart(2, '0')}`,
    city_id: point.city_id,
    point_id: point.id,
    hour: row.hour,
    depth_cm: depth,
    current_depth_cm: depth,
    severity: classifyDemoDepth(depth),
    forcing_index: pointForcingIndex(row),
    susceptibility_index: pointSusceptibilityIndex(point),
    priority_score: priority.score,
    priority_tier: priority.tier,
    evidence_type: 'simulated_scenario',
    source_id: 'synthetic-typhoon-v3',
  }
}

export function classifyDemoDepth(depthCm) {
  return depthCm >= 60 ? 'severe' : depthCm >= 30 ? 'warning' : depthCm >= 8 ? 'watch' : 'dry'
}

export function rankDemoPoint(point, depthCm) {
  if (!point || depthCm < 8) return { score: 0, tier: 'P4' }
  const depthScore = clamp(depthCm / 80)
  const exposureScore = clamp((point.population_base || 0) / 1200)
  const score = Math.round(100 * (
    0.50 * depthScore
    + 0.20 * clamp(point.road_criticality_index || 0)
    + 0.18 * exposureScore
    + 0.12 * clamp(pointSusceptibilityIndex(point))
  ))
  const tier = depthCm >= 60 ? 'P1' : depthCm >= 30 ? 'P2' : depthCm >= 8 ? 'P3' : 'P4'
  return { score, tier }
}

export function estimateResidentScenario(point, depthCm) {
  if (!point || depthCm < 8) return { exposed: 0, stay: 0, self: 0, assisted: 0, shelter: 0 }
  const depthIndex = clamp(depthCm / 80)
  const exposed = Math.round((point.population_base || 0) * clamp((depthCm - 5) / 55))
  const assisted = Math.min(exposed, Math.round(exposed * clamp((point.vulnerable_share || 0) * (0.55 + 0.35 * depthIndex))))
  const self = Math.min(exposed - assisted, Math.round((exposed - assisted) * (0.15 + 0.45 * depthIndex)))
  const stay = exposed - assisted - self
  return { exposed, stay, self, assisted, shelter: Math.min(exposed, Math.round(assisted * 0.75)) }
}

export function demoActionForPoint(point, depthCm) {
  if (!point || depthCm < 8) return {
    action: '核对未来降雨与水情，按巡查路线确认低洼位置和排水设施状态。',
    resource_types: ['巡查力量'],
  }
  if (depthCm >= 60) return {
    action: `P1：优先核验 ${point.label} 水深、流速与通行状态；按属地预案评估交通管控，并预置排水及人员协助力量。`,
    resource_types: ['现场核验', '交通管理', '排水力量', '人员协助待命'],
  }
  if (depthCm >= 30) return {
    action: `P2：复核 ${point.label} 与相邻道路通行情况，检查排水设施，准备必要绕行与抽排方案。`,
    resource_types: ['现场巡查', '排水力量', '交通备勤'],
  }
  return {
    action: `P3：巡查 ${point.label} 积水趋势，核实雨强、排水口和周边通行信息。`,
    resource_types: ['巡查力量'],
  }
}

export function makeSyntheticRainfallGrid(city, cityRows, hour) {
  const row = cityRows.find((item) => item.hour === hour)
  if (!row) return []
  const center = city.center
  const cells = []
  const span = 0.045
  for (let gridY = 0; gridY < DEMO_GRID_SIDE; gridY += 1) {
    for (let gridX = 0; gridX < DEMO_GRID_SIDE; gridX += 1) {
      const x = (gridX - (DEMO_GRID_SIDE - 1) / 2) / 2
      const z = (gridY - (DEMO_GRID_SIDE - 1) / 2) / 2
      const distance = Math.hypot(x - 0.35 * Math.sin(hour / 9), z + 0.3 * Math.cos(hour / 12))
      const spatialFactor = clamp(0.55 + 0.48 * Math.exp(-(distance ** 2) / 3.2), 0.45, 1.12)
      const rainfall = round(row.rainfall_rate_mm_h * spatialFactor, 1)
      cells.push({
        id: `${city.id}-rain-${gridX}-${gridY}-h${String(hour).padStart(2, '0')}`,
        city_id: city.id,
        coordinates: [round(center[0] + x * span / Math.cos(center[1] * Math.PI / 180), 5), round(center[1] + z * span, 5)],
        grid_x: gridX,
        grid_y: gridY,
        rainfall_rate_mm_h: rainfall,
        rainfall_6h_mm: round(row.rainfall_6h_mm * spatialFactor, 1),
        evidence_type: 'simulated_scenario',
        source_id: 'synthetic-typhoon-v3',
      })
    }
  }
  return cells
}
