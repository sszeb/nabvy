import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { index } from '../src'
import {
  createTestDatabase,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off acknowledges and writes nothing, and every view is
// empty; shadow writes and fills the internal views but no user-facing row; on shows bands, only
// for groups with n >= 10, and only while listing-suppression is on.

const ids = Array.from(
  { length: 13 },
  (_, i) => `01900000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
)
const now = new Date('2026-09-26T00:00:00Z')
let db: TestDatabase

const run = () => db.as('nabvy_pipeline', (q) => index(q, { listingIds: ids }, { now }))
const bands = () =>
  db.as('nabvy_app', async (q) => {
    const result = await q.execute('select * from app.v_asking_price_index_bands')
    return (result as unknown as { rows: Record<string, unknown>[] }).rows
  })

beforeAll(async () => {
  db = await createTestDatabase()
  // Ten GB asks for the RTX 3090 (a band) and three for the RTX 3080 (no band: n < 10).
  await seed(db, [
    ...ids.slice(0, 10).map((id, i) => ({ id, priceMinor: 60000 + 500 * i })),
    ...ids.slice(10).map((id) => ({ id, priceMinor: 40000, offered: ['gpu:rtx-3080'] })),
  ])
  await switchOn(db, UPSTREAM)
}, 60_000)
afterAll(() => db.close())

describe('asking-price-index switch', () => {
  it('off: acknowledges and writes nothing; views are empty', async () => {
    const result = await run()
    expect(result.ok && result.value.open).toBe(false)
    expect(await db.sql('select count(*)::int as n from asking_price_index.members')).toEqual([
      { n: 0 },
    ])
    expect(await db.sql('select * from asking_price_index.v_groups')).toEqual([])
  })

  it('shadow: writes and fills internal views, but no band', async () => {
    await setSwitch(db, 'shadow')
    const result = await run()
    expect(result.ok && result.value.updated).toHaveLength(2)
    expect(await db.sql('select * from asking_price_index.v_group_health')).toHaveLength(2)
    expect(await bands()).toEqual([])
    await setSwitch(db, 'off')
    expect(await db.sql('select * from asking_price_index.v_members')).toEqual([])
  })

  it('on: shows a band only for n >= 10, with the allowed columns', async () => {
    await setSwitch(db, 'on')
    expect(await bands()).toEqual([
      {
        group_key: 'gpu:rtx-3090|standalone|used_good|GB|GBP|30d',
        label: 'RTX 3090, on its own, used, good',
        n: 10,
        median: 62250,
        range_low: 61125,
        range_high: 63375,
        currency: 'GBP',
      },
    ])
  })

  it('on, with listing-suppression off: no band', async () => {
    await setSwitch(db, 'off', 'listing-suppression')
    expect(await bands()).toEqual([])
    await setSwitch(db, 'on', 'listing-suppression')
  })

  it('never lets nabvy_app read the thin mark or members', async () => {
    const denied = async (query: string) => {
      const error = await db
        .as('nabvy_app', (q) => q.execute(query))
        .then(
          () => null,
          (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
        )
      expect(error).toMatch(/permission denied/)
    }
    await denied('select thin from asking_price_index.stats')
    await denied('select * from asking_price_index.members')
  })
})
