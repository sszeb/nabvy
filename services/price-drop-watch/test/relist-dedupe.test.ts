import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watch } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingIdsBySource,
  loadRun,
  RECORDED,
  runJob,
  seedRelistGroup,
  type TestDatabase,
} from './support/database'

// Relist-merge "only stops the same item alerting twice" (README.md, "Decisions", catalogue
// question 21): two watches on two different listing IDs relist-merge has grouped, dropping to
// the same new price in one batch, announce only once — but each watch still gets its own `drops`
// row, since a watch never moves to another listing ID.

const USER_A = '00000000-0000-4000-8000-0000000000a1'
const USER_B = '00000000-0000-4000-8000-0000000000b1'
const LISTING_A = '1816901372840238' // £200
const LISTING_B = '1756692548940192' // £300

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('relist-merge group dedupe', () => {
  it('announces only the earlier watch when both land on the same new price', async () => {
    const recorded = loadRun(RECORDED)
    await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
    const located = await listingIdsBySource(t)
    const listingIdA = located.get(LISTING_A) as string
    const listingIdB = located.get(LISTING_B) as string

    const watchedA = await t.asApp(USER_A, (tx) =>
      watch(tx, { userId: USER_A, listingId: listingIdA }),
    )
    const watchedB = await t.asApp(USER_B, (tx) =>
      watch(tx, { userId: USER_B, listingId: listingIdB }),
    )
    if (!watchedA.ok) throw new Error(watchedA.error.message)
    if (!watchedB.ok) throw new Error(watchedB.error.message)
    // Force a deterministic creation order (the dedupe tie-break), rather than relying on the
    // two writes landing in different clock ticks.
    await t.sql('update price_drop_watch.watches set created_at = $1 where id = $2', [
      '2026-09-24T00:00:00Z',
      watchedA.value.id,
    ])
    await t.sql('update price_drop_watch.watches set created_at = $1 where id = $2', [
      '2026-09-24T00:00:01Z',
      watchedB.value.id,
    ])

    await seedRelistGroup(t, [listingIdA, listingIdB])

    const newPrice = {
      kind: 'fixed',
      display: '£150',
      currency: 'GBP',
      exponent: 2,
      rawAmount: '150.00',
      amountMinor: 15000,
    }
    const announced = await runJob(t, recorded, {
      collectedAt: '2026-09-25T01:40:43.415Z',
      edits: [
        { listingId: LISTING_A, fields: { money: newPrice, price: 150 } },
        { listingId: LISTING_B, fields: { money: newPrice, price: 150 } },
      ],
    })

    expect(announced).toEqual([watchedA.value.id])

    const drops = await t.asPipeline(
      'select watch_id from price_drop_watch.drops where watch_id = any($1::uuid[])',
      [[watchedA.value.id, watchedB.value.id]],
    )
    expect(drops.map((d) => d.watch_id).sort()).toEqual(
      [watchedA.value.id, watchedB.value.id].sort(),
    )
  })
})
