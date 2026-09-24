import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBudgets, readThrottle, recompute } from '../src'
import { ALL_ON, createTestDatabase, seed, type TestDatabase } from './support/database'

// Rule 11, fail closed: while spend-governor or cost-meter is off, or the throttle was never
// computed or has gone stale, v_throttle reads hold-new for every budget, so paid work pauses.
// No module reads the throttle yet (check-scheduler is not built), so "a reader's fixtures pass
// with this module off" waits for it.

let t: TestDatabase
const args = () => ({ now: new Date().toISOString(), usdGbpRate: 0.75 })
const throttle = () =>
  t.asPipeline('select budget, level, reason from spend_governor.v_throttle order by budget')
const writes = async () =>
  Number((await t.sql('select count(*) as n from spend_governor.throttle'))[0]?.n)

beforeEach(async () => {
  t = await createTestDatabase()
  await seed(t, {
    calls: [{ refId: 'r1', reservedMicros: 1_000_000, settledMicros: 900_000, at: args().now }],
  })
})
afterEach(async () => {
  await t.close()
})

describe('switch', () => {
  it('off (the default): writes nothing, holds every budget, publishes no budgets', async () => {
    const result = await recompute(t.db, args())
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'spend-governor.off' }),
    })
    expect(await writes()).toBe(0)
    expect((await throttle()).map((r) => `${r.level}/${r.reason}`)).toEqual([
      'hold-new/off',
      'hold-new/off',
      'hold-new/off',
    ])
    expect(await readBudgets(t.db)).toEqual([])
    expect((await readThrottle(t.db)).level).toBe('hold-new')
  })

  it('on but never computed: holds every budget', async () => {
    await t.switches(ALL_ON)
    expect((await throttle()).map((r) => r.reason)).toEqual([
      'never-computed',
      'never-computed',
      'never-computed',
    ])
    expect((await readThrottle(t.db)).level).toBe('hold-new')
  })

  it('on and computed: reads the computed levels', async () => {
    await t.switches(ALL_ON)
    expect((await recompute(t.db, args())).ok).toBe(true)
    expect((await throttle()).map((r) => `${r.level}/${r.reason}`)).toEqual([
      'none/computed',
      'none/computed',
      'none/computed',
    ])
    expect((await readThrottle(t.db)).level).toBe('none')
    expect((await readBudgets(t.db)).map((b) => b.committedMicros)).toEqual([900_000, 900_000, 0])
  })

  it('shadow behaves like on: the governor has no user-facing output', async () => {
    await t.switches({ ...ALL_ON, 'spend-governor': 'shadow' })
    expect((await recompute(t.db, args())).ok).toBe(true)
    expect((await readThrottle(t.db)).level).toBe('none')
  })

  it('cost-meter off: holds every budget, even when computed', async () => {
    await t.switches(ALL_ON)
    await recompute(t.db, args())
    await t.switches({ 'cost-meter': 'off' })
    expect((await throttle()).map((r) => `${r.level}/${r.reason}`)).toEqual([
      'hold-new/off',
      'hold-new/off',
      'hold-new/off',
    ])
  })

  it('switched off after computing: holds every budget, hides v_budgets', async () => {
    await t.switches(ALL_ON)
    await recompute(t.db, args())
    await t.switches({ 'spend-governor': 'off' })
    expect((await readThrottle(t.db)).level).toBe('hold-new')
    expect(await readBudgets(t.db)).toEqual([])
  })

  it('stale: a row past valid_until holds its budget', async () => {
    await t.switches(ALL_ON)
    await recompute(t.db, args())
    await t.sql(
      `update spend_governor.throttle set computed_at = now() - interval '2 hours',
         valid_until = now() - interval '1 hour' where budget = 'apify-monthly'`,
    )
    expect((await throttle())[0]).toEqual({
      budget: 'apify-monthly',
      level: 'hold-new',
      reason: 'stale',
    })
    expect((await readThrottle(t.db)).level).toBe('hold-new')
  })

  it('unreadable: readThrottle fails closed', async () => {
    await t.sql('revoke select on spend_governor.v_throttle from nabvy_pipeline')
    expect(await readThrottle(t.db)).toEqual({ level: 'hold-new', budgets: [] })
  })
})
