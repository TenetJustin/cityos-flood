import test from 'node:test'
import assert from 'node:assert/strict'
import { makeCustomGrid, makeCustomSeries } from '../src/customVisualModel.js'

test('custom 24-hour rainfall preserves total, exact peak, and zero initial accumulation', () => {
  for (const rain of [100, 220, 360]) for (const peak of [Math.ceil(rain/24), 64, 100]) {
    const rows = makeCustomSeries({ rain, peak, tide: 3, river: 2, drainage: 38 })
    assert.equal(rows[0].cumulative, 0)
    assert.equal(rows.at(-1).cumulative, rain)
    assert.equal(Math.max(...rows.map((r) => r.rain)), peak)
    assert.ok(Math.abs(rows.reduce((n, r) => n+r.rain, 0)-rain) < .002)
    assert.ok(rows.every((r) => Number.isFinite(r.stress)))
  }
})

test('custom grid remains finite and responds to parameters independently of event data', () => {
  assert.ok(makeCustomGrid(0).every((p) => p.current_depth_cm === 0))
  assert.ok(makeCustomGrid(1).every((p) => Number.isFinite(p.current_depth_cm) && p.current_depth_cm > 0))
  assert.throws(() => makeCustomGrid(NaN))
  assert.throws(() => makeCustomSeries({ rain: 360, peak: 10, tide: 0, river: 0, drainage: 50 }))
})
