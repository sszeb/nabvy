import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { erase, index } from '../src'
import {
  createTestDatabase,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: a replayed batch writes nothing and announces nothing.

const ids = Array.from(
  { length: 12 },
  (_, i) => `01900000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
)
const now = new Date('2026-09-26T00:00:00Z')
let db: TestDatabase

const snapshot = () =>
  db.sql(`
    select 'g' as t, group_key as k, updated_at from asking_price_index.groups
    union all select 'm', group_key || listing_id, updated_at from asking_price_index.members
    union all select 's', group_key, updated_at from asking_price_index.stats
    order by 1, 2`)

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(
    db,
    ids.map((id, i) => ({ id, priceMinor: 50000 + 1000 * i })),
  )
  await switchOn(db, UPSTREAM)
  await setSwitch(db, 'on')
}, 60_000)
afterAll(() => db.close())

describe('asking-price-index idempotency', () => {
  it('writes and announces once, then nothing on a replay', async () => {
    const first = await db.as('nabvy_pipeline', (q) => index(q, { listingIds: ids }, { now }))
    expect(first.ok && first.value.events).toHaveLength(1)
    const before = await snapshot()
    const second = await db.as('nabvy_pipeline', (q) => index(q, { listingIds: ids }, { now }))
    expect(second.ok && second.value.events).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('rejects an empty or oversized batch', async () => {
    const empty = await db.as('nabvy_pipeline', (q) => index(q, { listingIds: [] }))
    expect(!empty.ok && empty.error.code).toBe('asking-price-index.invalid_input')
  })

  it('erase removes the listings and recomputes their group', async () => {
    const changed = await db.as('nabvy_pipeline', (q) => erase(q, ids.slice(0, 2), { now }))
    expect(changed).toBe(1)
    const [row] = await db.sql('select n from asking_price_index.stats')
    expect(row?.n).toBe(10)
  })
})
