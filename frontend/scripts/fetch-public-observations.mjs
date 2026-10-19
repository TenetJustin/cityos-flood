import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { AWC_URL, normalizeMetars, unavailableSnapshot } from '../src/publicObservations.js'

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/observations.json')
const fetchedAt = new Date().toISOString()
let snapshot
try {
  const response = await fetch(AWC_URL, {
    headers: { 'User-Agent': 'cityos-flood-research/0.1 (https://github.com/TenetJustin/cityos-flood)', Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  snapshot = normalizeMetars(await response.json(), fetchedAt)
  if (snapshot.stations.every((station) => station.status === 'missing')) throw new Error('No valid station observations')
} catch (error) {
  console.error(`Public observation fetch unavailable: ${error.message}`)
  snapshot = unavailableSnapshot(fetchedAt)
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(snapshot) + '\n')
console.log(`Observation snapshot: ${snapshot.state}; ${snapshot.stations.filter((station) => station.status === 'current').length}/5 current stations`)
