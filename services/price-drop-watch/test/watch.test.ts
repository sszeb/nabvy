import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accountDeletedEvent, erase, tick, unwatch, watch } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingIdsBySource,
  loadRun,
  RECORDED,
  runJob,
  type TestDatabase,
} from './support/database'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_USER = '00000000-0000-4000-8000-000000000002'
const LISTING_SOURCE_ID = '1816901372840238'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

async function seedListing(): Promise<string> {
  const recorded = loadRun(RECORDED)
  await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
  const located = await listingIdsBySource(t)
  return located.get(LISTING_SOURCE_ID) as string
}

// watch()/unwatch() are called as nabvy_app (withUser's role); nabvy_pipeline has no insert or
// update grant on `watches` (packages/db/README.md, "Roles, withUser and RLS").
const doWatch = (userId: string, listingId: string) =>
  t.asApp(userId, (tx) => watch(tx, { userId, listingId }))
const doUnwatch = (userId: string, listingId: string) =>
  t.asApp(userId, (tx) => unwatch(tx, { userId, listingId }))

describe('watch', () => {
  it('refuses a listing listing-ingest does not show', async () => {
    const result = await doWatch(USER_ID, crypto.randomUUID())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('price-drop-watch.listing_not_found')
  })

  it('is idempotent: watching twice keeps one row, active', async () => {
    const listingId = await seedListing()
    const first = await doWatch(USER_ID, listingId)
    const second = await doWatch(USER_ID, listingId)
    if (!first.ok || !second.ok) throw new Error('watch failed')
    expect(first.value.id).toBe(second.value.id)
    const rows = await t.asPipeline(
      'select count(*)::int as n from price_drop_watch.watches where user_id = $1 and listing_id = $2',
      [USER_ID, listingId],
    )
    expect(rows[0]?.n).toBe(1)
  })

  it('two users can each watch the same listing independently', async () => {
    const listingId = await seedListing()
    const a = await doWatch(USER_ID, listingId)
    const b = await doWatch(OTHER_USER, listingId)
    if (!a.ok || !b.ok) throw new Error('watch failed')
    expect(a.value.id).not.toBe(b.value.id)
  })

  it('unwatch deactivates rather than deleting, and reactivates on a later watch()', async () => {
    const listingId = await seedListing()
    const watched = await doWatch(USER_ID, listingId)
    if (!watched.ok) throw new Error(watched.error.message)

    const unwatched = await doUnwatch(USER_ID, listingId)
    expect(unwatched?.active).toBe(false)
    expect(unwatched?.id).toBe(watched.value.id)

    const rewatched = await doWatch(USER_ID, listingId)
    if (!rewatched.ok) throw new Error(rewatched.error.message)
    expect(rewatched.value.id).toBe(watched.value.id)
    expect(rewatched.value.active).toBe(true)
  })

  it('unwatch of a listing never watched is a no-op', async () => {
    const listingId = await seedListing()
    expect(await doUnwatch(USER_ID, listingId)).toBeNull()
  })
})

describe('tick', () => {
  it('asks listing-lifecycle for a watched recheck on every active watch', async () => {
    const listingId = await seedListing()
    const watched = await doWatch(USER_ID, listingId)
    if (!watched.ok) throw new Error(watched.error.message)

    const report = await tick(t.db)
    expect(report.requested).toBe(1)

    const rows = await t.asPipeline(
      "select reason, requested_by from listing_lifecycle.rechecks where listing_id = $1 and reason = 'watched'",
      [listingId],
    )
    expect(rows).toEqual([{ reason: 'watched', requested_by: 'price-drop-watch' }])
  })

  it('never asks for an inactive (unwatched) listing', async () => {
    const listingId = await seedListing()
    const watched = await doWatch(USER_ID, listingId)
    if (!watched.ok) throw new Error(watched.error.message)
    await doUnwatch(USER_ID, listingId)

    const report = await tick(t.db)
    expect(report.requested).toBe(0)
  })
})

describe('erase and account.deleted', () => {
  it('erase removes every watch on a listing (and its drops, cascade)', async () => {
    const listingId = await seedListing()
    const a = await doWatch(USER_ID, listingId)
    const b = await doWatch(OTHER_USER, listingId)
    if (!a.ok || !b.ok) throw new Error('watch failed')

    expect(await erase(t.db, [listingId])).toBe(2)
    const rows = await t.asPipeline(
      'select 1 from price_drop_watch.watches where listing_id = $1',
      [listingId],
    )
    expect(rows).toHaveLength(0)
  })

  it('account.deleted removes only that user’s watches', async () => {
    const listingId = await seedListing()
    const a = await doWatch(USER_ID, listingId)
    const b = await doWatch(OTHER_USER, listingId)
    if (!a.ok || !b.ok) throw new Error('watch failed')

    expect(await accountDeletedEvent(t.db, [USER_ID])).toBe(1)
    const rows = await t.asPipeline(
      'select user_id from price_drop_watch.watches where listing_id = $1',
      [listingId],
    )
    expect(rows).toEqual([{ user_id: OTHER_USER }])
  })
})
