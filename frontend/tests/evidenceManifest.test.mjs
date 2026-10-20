import test from 'node:test'
import assert from 'node:assert/strict'
import { assessEvidenceManifest, buildEvidenceManifest, EVIDENCE_FILES } from '../scripts/evidence-manifest.mjs'

const files = () => Object.fromEntries(EVIDENCE_FILES.map((path) => [path, Buffer.from(`source:${path}\n`)]))
const context = { generatedAt: '2026-10-20T12:00:00Z', sourceCommit: 'a'.repeat(40), runId: '12345' }

test('evidence manifest binds each deployed snapshot to exact bytes and a run', () => {
  const snapshots = files()
  const manifest = buildEvidenceManifest(snapshots, context)
  assert.deepEqual(assessEvidenceManifest(manifest, snapshots), { valid: true, issues: [] })
  const changed = { ...snapshots, 'zhejiang-observations.json': Buffer.from('different') }
  assert.equal(assessEvidenceManifest(manifest, changed).valid, false)
  assert.match(assessEvidenceManifest(manifest, changed).issues[0], /zhejiang-observations/)
})

test('manifest rejects missing, swapped or malformed evidence and metadata', () => {
  const snapshots = files()
  const manifest = buildEvidenceManifest(snapshots, context)
  assert.throws(() => buildEvidenceManifest({ ...snapshots, 'zhejiang-weather-forecast.json': null }, context), /Missing evidence/)
  assert.equal(assessEvidenceManifest({ ...manifest, files: [...manifest.files].reverse() }, snapshots).valid, false)
  assert.equal(assessEvidenceManifest({ ...manifest, source_commit: 'not-a-commit' }, snapshots).valid, false)
})
