import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { position } from '../src'
import {
  createTestDatabase,
  NOW,
  runIndex,
  seed,
  setSwitch,
  shownRows,
  switchOn,
  type TestDatabase,
  uuid,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off acknowledges and writes nothing, and every view is
// empty; shadow writes and fills the internal view but no user-facing row; on shows positions,
// only at n >= 10, never for a suppressed listing, and only while asking-price-index and
// listing-suppression are on. The index's own fixtures pass with this module off (it reads nothing
// from here).

const ids = Array.from({ length: 13 }, (_, i) => uuid(i + 1))
let db: TestDatabase
let groupKeys: string[]

const run = () => db.as('nabvy_pipeline', (q) => position(q, { groupKeys }, { now: NOW }))

beforeAll(async () => {
  db = await createTestDatabase()
  // Ten GB asks for the RTX 3090 (shown) and three for the RTX 3080 (n < 10: recorded, hidden).
  await seed(db, [
    ...ids.slice(0, 10).map((id, i) => ({ id, priceMinor: 60000 + 500 * i })),
    ...ids.slice(10).map((id) => ({ id, priceMinor: 40000, offered: ['gpu:rtx-3080'] })),
  ])
  await switchOn(db)
  groupKeys = await runIndex(db, ids)
}, 60_000)
afterAll(() => db.close())

describe('asking-price-position switch', () => {
  it('off: acknowledges and writes nothing; views are empty', async () => {
    const result = await run()
    expect(result.ok && result.value.open).toBe(false)
    expect(await db.sql('select count(*)::int as n from asking_price_position.positions')).toEqual([
      { n: 0 },
    ])
    expect(await db.sql('select * from asking_price_position.v_positions')).toEqual([])
  })

  it('with asking-price-index off: does nothing', async () => {
    await setSwitch(db, 'on')
    await setSwitch(db, 'off', 'asking-price-index')
    const result = await run()
    expect(result.ok && result.value.open).toBe(false)
    await setSwitch(db, 'on', 'asking-price-index')
  })

  it('shadow: writes and fills the internal view (T4 for every size), but no user row', async () => {
    await setSwitch(db, 'shadow')
    const result = await run()
    expect(result.ok && result.value.positioned).toHaveLength(13)
    expect(await db.sql('select * from asking_price_position.v_positions')).toHaveLength(13)
    expect(await shownRows(db)).toEqual([])
  })

  it('on: shows only n >= 10, with the allowed columns and no score', async () => {
    await setSwitch(db, 'on')
    const shown = await shownRows(db)
    expect(shown).toHaveLength(10)
    expect(shown[0]).toEqual({
      listing_id: ids[0],
      label: 'RTX 3090, on its own, used, good',
      rank: 1,
      n: 10,
      median: 62250,
      range_low: 61125,
      range_high: 63375,
      currency: 'GBP',
    })
  })

  it('on: hides a suppressed listing', async () => {
    await db.sql(
      `insert into listing_suppression.entries (kind, value, request_id)
       select 'listing_hash', listing_suppression.listing_hash(source, source_listing_id),
         nabvy_core.uuidv7()
       from listing_ingest.listings where id = $1`,
      [ids[0]],
    )
    const shown = await shownRows(db)
    expect(shown.map((r) => r.listing_id)).not.toContain(ids[0])
    expect(shown).toHaveLength(9)
  })

  it('on, with listing-suppression or asking-price-index off: no row', async () => {
    await setSwitch(db, 'off', 'listing-suppression')
    expect(await shownRows(db)).toEqual([])
    await setSwitch(db, 'on', 'listing-suppression')
    await setSwitch(db, 'off', 'asking-price-index')
    expect(await shownRows(db)).toEqual([])
    await setSwitch(db, 'on', 'asking-price-index')
  })

  it('never lets nabvy_app read the score or the hashes', async () => {
    const denied = async (query: string) => {
      const error = await db
        .as('nabvy_app', (q) => q.execute(query))
        .then(
          () => null,
          (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
        )
      expect(error).toMatch(/permission denied/)
    }
    await denied('select percentile from asking_price_position.positions')
    await denied('select robust_z from asking_price_position.positions')
    await denied('select card_hash from asking_price_position.positions')
    await denied('select * from asking_price_position.v_positions')
  })
})
