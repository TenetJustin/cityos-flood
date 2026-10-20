import { readFile, writeFile } from 'node:fs/promises'
import { buildEvidenceManifest, EVIDENCE_FILES } from './evidence-manifest.mjs'

const dataDir = new URL('../public/data/', import.meta.url)
const files = Object.fromEntries(await Promise.all(EVIDENCE_FILES.map(async (path) => [path, await readFile(new URL(path, dataDir))])))
const manifest = buildEvidenceManifest(files, {
  generatedAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
})
await writeFile(new URL('zhejiang-evidence-manifest.json', dataDir), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Evidence manifest covers ${manifest.files.length} exact files.`)
