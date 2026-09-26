import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, watch } from '../src'
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

  it('announces later watches whose drops are new in a later pass', async () => {
    const recorded = loadRun(RECORDED)
    await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
    const located = await listingIdsBySource(t)
    const listingIdA = located.get(LISTING_A) as string
    const listingIdB = located.get(LISTING_B) as string

    // Pass 1: Watch A exists, relist group formed, both drop to £150
    const watchedA = await t.asApp(USER_A, (tx) =>
      watch(tx, { userId: USER_A, listingId: listingIdA }),
    )
    if (!watchedA.ok) throw new Error(watchedA.error.message)
    await t.sql('update price_drop_watch.watches set created_at = $1 where id = $2', [
      '2026-09-24T00:00:00Z',
      watchedA.value.id,
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
    const pass1Announced = await runJob(t, recorded, {
      collectedAt: '2026-09-25T01:40:43.415Z',
      edits: [
        { listingId: LISTING_A, fields: { money: newPrice, price: 150 } },
        { listingId: LISTING_B, fields: { money: newPrice, price: 150 } },
      ],
    })

    // Pass 1: only A is watched, so only A announces
    expect(pass1Announced).toEqual([watchedA.value.id])

    // Pass 2: B starts watching the same group at the same price. Call applyEvent with no new
    // data (same price change from pass 1), but now both A and B are watches.
    const watchedB = await t.asApp(USER_B, (tx) =>
      watch(tx, { userId: USER_B, listingId: listingIdB }),
    )
    if (!watchedB.ok) throw new Error(watchedB.error.message)
    await t.sql('update price_drop_watch.watches set created_at = $1 where id = $2', [
      '2026-09-24T00:00:01Z',
      watchedB.value.id,
    ])

    // Directly call applyEvent with both listings; the price change from pass 1 is still the
    // latest. A's drop for this change already exists; B's is new.
    const pass2Report = await applyEvent(t.db, {
      listingIds: [listingIdA, listingIdB],
      key: 'test.pass2',
    })

    const pass2Announced = pass2Report.events.flatMap((e) => e.payload.watchIds) as string[]

    // Pass 2: B's drop is new in this pass and should be announced; A's drop already existed
    // from pass 1 and is not announced again
    expect(pass2Announced).toEqual([watchedB.value.id])

    // Both drops should be recorded in the database for the same price transition (same card_hash)
    const dropsData = (await t.asPipeline(
      'select watch_id, from_minor, to_minor from price_drop_watch.drops where watch_id = any($1::uuid[]) order by watch_id',
      [[watchedA.value.id, watchedB.value.id]],
    )) as Array<{ watch_id: string; from_minor: number; to_minor: number }>
    expect(dropsData.length).toBe(2)
    const dropA = dropsData[0]
    const dropB = dropsData[1]
    if (!dropA || !dropB) throw new Error('drops should exist')
    expect(dropA.watch_id).toBe(watchedA.value.id)
    expect(dropA.from_minor).toBe(20000) // LISTING_A is £200
    expect(dropA.to_minor).toBe(15000) // drops to £150
    expect(dropB.watch_id).toBe(watchedB.value.id)
    expect(dropB.from_minor).toBe(30000) // LISTING_B is £300
    expect(dropB.to_minor).toBe(15000) // drops to £150
  })
})
