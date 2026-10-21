import { rankDemoPoint, syntheticTerrainElevation } from './demoFloodModel.js'
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

export function makeCustomSeries(inputs) {
  const { rain, peak, tide, river, drainage } = inputs
  if (![rain, peak, tide, river, drainage].every(Number.isFinite) || rain < 0 || peak < 0 || peak > rain || rain > peak * 24 || tide < 0 || tide > 4 || river < 0 || river > 4 || drainage < 0 || drainage > 100) throw new Error('Invalid custom scenario inputs')
  const weights = [0.01,0.01,0.01,0.01,0.01,1,2,3,5,8,12,18,24,29,27,22,18,14,11,8,6,4,3,2]
  const peakIndex = weights.indexOf(Math.max(...weights))
  const rates = weights.map((_, i) => i === peakIndex ? peak : 0)
  let remaining = rain - peak
  let open = weights.map((_, i) => i).filter((i) => i !== peakIndex)
  while (remaining > 1e-8 && open.length) {
    const weight = open.reduce((n, i) => n + weights[i], 0)
    const capped = open.filter((i) => remaining * weights[i] / weight >= peak)
    if (!capped.length) {
      for (const i of open) rates[i] = remaining * weights[i] / weight
      remaining = 0
    } else {
      for (const i of capped) { rates[i] = peak; remaining -= peak }
      open = open.filter((i) => !capped.includes(i))
    }
  }
  return Array.from({ length: 25 }, (_, hour) => {
    const cumulative = rates.slice(0, hour).reduce((a, b) => a+b, 0)
    const rainHour = hour ? rates[hour-1] : 0
    const stress = clamp(cumulative / Math.max(rain, 1) * .62 + rainHour / 100 * .2 + (tide+river) / 8 * .34 - drainage / 100 * .24)
    return { hour, rain: Number(rainHour.toFixed(4)), cumulative: Number(cumulative.toFixed(4)), stress: Number(stress.toFixed(3)), wetCells: Math.round(8+stress*stress*420) }
  })
}

export function makeCustomGrid(stress) {
  if (!Number.isFinite(stress) || stress < 0 || stress > 1) throw new Error('Invalid rule pressure')
  return Array.from({ length: 25 }, (_, index) => {
    const x = (index % 5-2)*3, z = (Math.floor(index/5)-2)*3
    const elevation = syntheticTerrainElevation(x, z)
    const depth = Math.round(clamp((stress*(.58+clamp(1-elevation/15)*.55)-.25)*145, 0, 110))
    const point = { id: `custom-${index}`, point_id: `custom-${index}`, label: `CT-${String(index+1).padStart(2,'0')}`, terrain_x: x, terrain_z: z, relative_elevation_m: elevation, current_depth_cm: depth }
    return { ...point, priority_tier: rankDemoPoint(point, depth).tier }
  })
}
