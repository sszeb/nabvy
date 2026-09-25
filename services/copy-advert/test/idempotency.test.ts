import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { purgeUserReports, recompute, report } from '../src/index'
import {
  ALL_ON,
  collectedAndRecorded,
  createTestDatabase,
  listingIdOf,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: every handler and exported write function is
// idempotent. `recompute` upserts on the print's version key, and clusters/members/flags on their
// own natural keys, so a replayed batch writes nothing new and returns the same changed listings.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await db.switches(ALL_ON)
}, 60_000)
afterAll(() => db.close())

describe('copy-advert idempotency', () => {
  it('recompute run twice on the same batch writes no new prints, links, clusters or members', async () => {
    const run = loadRun(RECORDED)
    const { listingIds } = await collectedAndRecorded(db, run)

    const first = await recompute(db.db, { listingIds })
    expect(first.ok).toBe(true)
    const countsAfterFirst = await tableCounts(db)

    const second = await recompute(db.db, { listingIds })
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect([...second.value.changedListingIds].sort()).toEqual(
        [...first.value.changedListingIds].sort(),
      )
    }
    expect(await tableCounts(db)).toEqual(countsAfterFirst)
  })

  it('a repeated report by the same user on the same listing writes once', async () => {
    const run = loadRun(RECORDED)
    const { listingIds } = await collectedAndRecorded(db, run)
    const listingId =
      listingIds[0] ??
      (await listingIdOf(db, String((run.dataset[0] as { listingId: unknown }).listingId)))
    const userId = '00000000-0000-7000-8000-000000000001'
    const a = await db.asAppQuery(userId, (q) =>
      report(q, userId, { listingId, reason: 'not_a_copy' }),
    )
    const b = await db.asAppQuery(userId, (q) =>
      report(q, userId, { listingId, reason: 'not_a_copy' }),
    )
    expect(a.recorded).toBe(true)
    expect(b.recorded).toBe(false)
    const rows = await db.asPipeline(
      'select count(*)::int as n from copy_advert.reports where user_id = $1',
      [userId],
    )
    expect(rows[0]?.n).toBe(1)
  })

  it('a second account.deleted purge for the same user changes nothing', async () => {
    const userId = '00000000-0000-7000-8000-000000000002'
    const run = loadRun(RECORDED)
    const { listingIds } = await collectedAndRecorded(db, run)
    const listingId = listingIds[1] ?? listingIds[0]
    if (listingId)
      await db.asAppQuery(userId, (q) => report(q, userId, { listingId, reason: 'other' }))
    await purgeUserReports(db.db, userId)
    await purgeUserReports(db.db, userId)
    const rows = await db.asPipeline(
      'select count(*)::int as n from copy_advert.reports where user_id = $1',
      [userId],
    )
    expect(rows[0]?.n).toBe(0)
  })
})

async function tableCounts(t: TestDatabase): Promise<Record<string, number>> {
  const tables = ['prints', 'links', 'photo_matches', 'clusters', 'members', 'flags']
  const out: Record<string, number> = {}
  for (const table of tables) {
    const rows = await t.asPipeline(`select count(*)::int as n from copy_advert.${table}`)
    out[table] = Number(rows[0]?.n ?? 0)
  }
  return out
}
