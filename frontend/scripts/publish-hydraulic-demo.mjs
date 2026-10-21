// Explicitly attach successful EPA SWMM outputs to the synthetic-only bundle.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { classifyDemoDepth, demoActionForPoint, makeDemoPointResult } from '../src/demoFloodModel.js'
import { validateDemoDataset } from '../src/zhejiangDemoData.js'

const root = new URL('../../', import.meta.url)
const publicData = new URL('../public/data/', import.meta.url)
const source = new URL('zhejiang-demo-snapshot.json', publicData)
const raw = await readFile(source)
const dataset = JSON.parse(raw)
const output = resolve(process.argv[2] || new URL('.tmp/hydraulic-demo', root).pathname)
const hydraulics = JSON.parse(await readFile(`${output}/results.json`, 'utf8'))
if (createHash('sha256').update(raw).digest('hex') !== hydraulics.input_sha256) throw new Error('Solver results do not match current input bundle; regenerate inputs and solve again')
if (!hydraulics.acceptance.passed) throw new Error('Hydraulic acceptance failed')
dataset.model = { engine: 'epa_swmm', version: hydraulics.model_version, hydrodynamic_solver: 'EPA SWMM 5.2.4', calibrated: false, description: '合成微区降雨径流、动态管流与节点地表蓄水；不是二维淹没范围或真实城市预测。' }
dataset.hydraulics = hydraulics
for (const point of dataset.points) {
  const depths = hydraulics.cities[point.city_id].depth_cm_by_point[point.id]
  point.depth_cm = Math.max(...depths)
  point.onset_hour = depths.findIndex((depth) => depth >= 8)
  if (point.onset_hour < 0) point.onset_hour = 72
  point.severity = classifyDemoDepth(point.depth_cm)
}
for (const row of dataset.timeline) {
  const depths = Object.values(hydraulics.cities[row.city_id].depth_cm_by_point).map((values) => values[row.hour])
  row.peak_depth_cm = Math.max(...depths)
  row.water_index = Number(Math.min(1, row.peak_depth_cm / 100).toFixed(3))
  row.severity = row.peak_depth_cm >= 60 ? 'severe' : row.peak_depth_cm >= 8 ? 'warning' : 'watch'
}
for (const city of dataset.cities) {
  city.status = dataset.timeline.find((r) => r.city_id === city.city_id && r.hour === dataset.scenario.default_hour).severity
  city.status_label = { severe: '高影响情景', warning: '重点关注情景', watch: '常态监测情景' }[city.status]
}
for (const recommendation of dataset.department_responses) {
  const row = dataset.timeline.find((r) => r.city_id === recommendation.city_id && r.hour === recommendation.hour)
  const ranked = dataset.points.filter((p) => p.city_id === row.city_id).map((p) => makeDemoPointResult(p, row, hydraulics.cities[p.city_id].depth_cm_by_point[p.id][row.hour])).sort((a, b) => a.priority_tier.localeCompare(b.priority_tier) || b.priority_score-a.priority_score || b.depth_cm-a.depth_cm)
  const first = ranked[0]
  Object.assign(recommendation, demoActionForPoint(first, first.depth_cm), { area: first.area, point_id: first.point_id, priority_score: first.priority_score, priority_tier: first.priority_tier, depth_cm: first.depth_cm, ranked_point_ids: ranked.filter((p) => p.depth_cm >= 8).slice(0, 5).map((p) => p.point_id) })
}
dataset.scenario.update_note = '逐小时展示 SWMM 节点蓄水结果；每6小时汇集建议。驱动为预设合成过程，不是滚动真实预报。'
dataset.units.depth = 'cm, SWMM node ponding on synthetic geometry'
const validation = validateDemoDataset(dataset)
if (!validation.valid) throw new Error(validation.errors.join('; '))
const gis = JSON.parse(await readFile(new URL('zhejiang-demo-peak.geojson', publicData), 'utf8'))
for (const f of gis.features) if (f.properties.point_id) {
  const point = dataset.points.find((p) => p.id === f.properties.point_id)
  const row = dataset.timeline.find((r) => r.city_id === point.city_id && r.hour === f.properties.hour)
  const result = makeDemoPointResult(point, row, hydraulics.cities[point.city_id].depth_cm_by_point[point.id][row.hour])
  Object.assign(f.properties, { depth_cm: result.depth_cm, severity: result.severity, priority_score: result.priority_score, priority_tier: result.priority_tier, model_version: hydraulics.model_version, result_type: 'node_ponding_not_2d_extent' })
}
const published = new URL('hydraulic-demo/', publicData)
await mkdir(published, { recursive: true })
for (const city of dataset.cities) for (const [file, suffix] of [['model.inp', 'inp'], ['model.rpt', 'rpt'], ['synthetic-relative-elevation.tif', 'tif']]) {
  await copyFile(`${output}/${city.city_id}/${file}`, new URL(`${city.city_id}.${suffix}`, published))
}
for (const file of ['feed.ndjson', 'peak-points.geojson', 'results.json']) await copyFile(`${output}/${file}`, new URL(file, published))
await writeFile(source, `${JSON.stringify(dataset)}\n`)
await writeFile(new URL('zhejiang-demo-peak.geojson', publicData), `${JSON.stringify(gis)}\n`)
console.log(`Attached tested ${hydraulics.model_version}: 100 nodes × 73 hours; shared point, population and recommendation views.`)
