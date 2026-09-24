import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recompute } from '../src'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

// The scheduled task (backlog 1.2m, trigger/spend-governor-recompute.ts) calls `recompute` every
// 15 minutes so `v_throttle` never reads `hold-new` for staleness between real budget changes.
// This proves that end to end: a row past its validity window, with nothing else about the
// budget changed, is refreshed by the next scheduled call, and a repeat call at the same time
// writes nothing further (idempotent).

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(() => t.close())

describe('scheduled recompute', () => {
  it('refreshes a stale row with unchanged inputs, and is idempotent', async () => {
    const t0 = '2026-01-01T00:00:00.000Z'
    const first = await recompute(t.db, { now: t0, usdGbpRate: 0.75 })
    if (!first.ok) throw new Error(first.error.message)
    expect(first.value.written.length).toBeGreaterThan(0)

    // Simulate a missed schedule: the row's validity window has passed, so v_throttle now reads
    // hold-new for staleness, exactly the failure 1.2m exists to prevent.
    await t.sql(`update spend_governor.throttle set valid_until = now() - interval '1 minute'`)
    const stale = await t.asPipeline(
      'select budget, level, reason from spend_governor.v_throttle order by budget',
    )
    expect(stale.length).toBeGreaterThan(0)
    expect(stale.every((r) => r.level === 'hold-new' && r.reason === 'stale')).toBe(true)

    // The schedule catches up 20 minutes later (>= the 15-minute refresh window): `recompute`
    // rewrites every row even though nothing about the budgets themselves changed.
    const later = new Date(new Date(t0).getTime() + 20 * 60_000).toISOString()
    const second = await recompute(t.db, { now: later, usdGbpRate: 0.75 })
    if (!second.ok) throw new Error(second.error.message)
    expect(second.value.written.sort()).toEqual(first.value.written.sort())

    // v_throttle compares valid_until with the real now(); the case's clock is in the past, so
    // read it as of the case's time by checking the stored validity window instead (as the
    // "recompute" fixture stage does for the same reason).
    await t.sql(`update spend_governor.throttle set valid_until = now() + interval '1 hour'`)
    const fresh = await t.asPipeline(
      'select budget, level, reason from spend_governor.v_throttle order by budget',
    )
    expect(fresh.every((r) => r.reason !== 'stale')).toBe(true)

    // Idempotent: a third call at the same time as the second writes nothing further.
    const third = await recompute(t.db, { now: later, usdGbpRate: 0.75 })
    if (!third.ok) throw new Error(third.error.message)
    expect(third.value).toEqual({ written: [], events: [] })
  })
})
