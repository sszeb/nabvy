import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { erase, position } from '../src'
import {
  createTestDatabase,
  NOW,
  runIndex,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  uuid,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: a replayed batch writes nothing and announces nothing;
// a new version of the group (its as_of) re-positions.

const ids = Array.from({ length: 12 }, (_, i) => uuid(i + 1))
let db: TestDatabase
let groupKeys: string[]

const snapshot = () =>
  db.sql(`select listing_id, group_key, updated_at, positioned_at
          from asking_price_position.positions order by 1, 2`)

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(
    db,
    ids.map((id, i) => ({ id, priceMinor: 50000 + 1000 * i })),
  )
  await switchOn(db)
  await setSwitch(db, 'on')
  groupKeys = await runIndex(db, ids)
}, 60_000)
afterAll(() => db.close())

describe('asking-price-position idempotency', () => {
  it('writes and announces once, then nothing on a replay', async () => {
    const first = await db.as('nabvy_pipeline', (q) => position(q, { groupKeys }, { now: NOW }))
    expect(first.ok && first.value.positioned).toHaveLength(12)
    expect(first.ok && first.value.events).toHaveLength(1)
    const before = await snapshot()
    const later = new Date(NOW.getTime() + 60_000)
    const second = await db.as('nabvy_pipeline', (q) => position(q, { groupKeys }, { now: later }))
    expect(second.ok && second.value.events).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('rejects an empty batch', async () => {
    const empty = await db.as('nabvy_pipeline', (q) => position(q, { groupKeys: [] }))
    expect(!empty.ok && empty.error.code).toBe('asking-price-position.invalid_input')
  })

  it('removes the position of a listing that left the group', async () => {
    await db.sql(`update listing_ingest.listings set availability = 'sold' where id = $1`, [ids[0]])
    const updated = await runIndex(db, [ids[0] as string])
    expect(updated).toEqual(groupKeys)
    const result = await db.as('nabvy_pipeline', (q) =>
      position(q, { groupKeys: updated }, { now: NOW }),
    )
    expect(result.ok && result.value.positioned).toHaveLength(12)
    const [row] = await db.sql(
      'select count(*)::int as n, max(n) as group_n from asking_price_position.positions',
    )
    expect(row).toEqual({ n: 11, group_n: 11 })
  })

  it('erase removes the listings', async () => {
    const removed = await db.as('nabvy_pipeline', (q) => erase(q, ids.slice(1, 3)))
    expect(removed).toBe(2)
  })
})
