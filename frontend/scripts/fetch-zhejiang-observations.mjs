import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessZhejiangSnapshot, normalizeZhejiangMetars, unavailableZhejiangSnapshot, ZHEJIANG_AWC_URL } from '../src/zhejiangObservations.js'

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/zhejiang-observations.json')
const fetchedAt = new Date().toISOString()
let snapshot
try {
  const response = await fetch(ZHEJIANG_AWC_URL, { headers: { Accept: 'application/json', 'User-Agent': 'cityos-flood-research/0.2 (https://github.com/TenetJustin/cityos-flood)' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  snapshot = normalizeZhejiangMetars(await response.json(), fetchedAt)
  const assessment = assessZhejiangSnapshot(snapshot)
  if (!assessment.valid) throw new Error(`Invalid normalized snapshot: ${assessment.issues.join(', ')}`)
  if (snapshot.stations.every((station) => !station.latest)) throw new Error('No valid Zhejiang airport observations')
} catch (error) {
  console.error(`Zhejiang observation fetch unavailable: ${error.message}`)
  snapshot = unavailableZhejiangSnapshot(fetchedAt)
}
const assessment = assessZhejiangSnapshot(snapshot)
if (!assessment.valid) throw new Error(`Invalid final Zhejiang snapshot: ${assessment.issues.join(', ')}`)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(snapshot)}\n`)
console.log(`Zhejiang observation snapshot: ${snapshot.state}; ${assessment.coverage}/4 with records; missing ${assessment.missing.join(', ') || 'none'}`)
