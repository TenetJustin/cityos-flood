import { createHash } from 'node:crypto'

export const EVIDENCE_FILES = [
  'zhejiang-observations.json',
  'zhejiang-real-events.json',
  'zhejiang-weather-forecast.json',
  'zhejiang-historical-rain-2021.json',
  'zhejiang-synoptic-rain-2021.json',
  'zhejiang-track-candidates.json',
]

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function buildEvidenceManifest(files, { generatedAt, sourceCommit = null, runId = null }) {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid evidence manifest time')
  if (sourceCommit !== null && !/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error('Invalid source commit')
  if (runId !== null && !/^\d+$/.test(runId)) throw new Error('Invalid run ID')
  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_commit: sourceCommit,
    run_id: runId,
    files: EVIDENCE_FILES.map((path) => {
      const bytes = files[path]
      if (!Buffer.isBuffer(bytes)) throw new Error(`Missing evidence file: ${path}`)
      return { path, bytes: bytes.length, sha256: sha256(bytes) }
    }),
  }
}

export function assessEvidenceManifest(manifest, files) {
  const issues = []
  if (manifest?.schema_version !== 1 || !Number.isFinite(Date.parse(manifest?.generated_at || ''))) issues.push('metadata_invalid')
  if (manifest?.source_commit !== null && !/^[0-9a-f]{40}$/i.test(manifest?.source_commit || '')) issues.push('source_commit_invalid')
  if (manifest?.run_id !== null && !/^\d+$/.test(manifest?.run_id || '')) issues.push('run_id_invalid')
  if (!Array.isArray(manifest?.files) || manifest.files.length !== EVIDENCE_FILES.length) return { valid: false, issues: [...issues, 'files_invalid'] }
  for (const [index, expected] of EVIDENCE_FILES.entries()) {
    const record = manifest.files[index]
    const bytes = files[expected]
    if (record?.path !== expected || !Buffer.isBuffer(bytes) || record?.bytes !== bytes.length || record?.sha256 !== sha256(bytes)) issues.push(`file_invalid:${expected}`)
  }
  return { valid: issues.length === 0, issues }
}
