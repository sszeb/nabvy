import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, erase, tick, unwatch, watch } from '../src'
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
const LISTING_SOURCE_ID = '1816901372840238'
const OTHERS_ON = Object.fromEntries(
  Object.entries(ALL_ON).filter(([name]) => name !== 'price-drop-watch'),
) as Record<string, 'off' | 'shadow' | 'on'>

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

const doWatch = (userId: string, listingId: string) =>
  t.asApp(userId, (tx) => watch(tx, { userId, listingId }))
const doUnwatch = (userId: string, listingId: string) =>
  t.asApp(userId, (tx) => unwatch(tx, { userId, listingId }))

describe('off', () => {
  beforeEach(async () => {
    await t.switches({ ...OTHERS_ON, 'price-drop-watch': 'off' })
  })

  it('refuses watch()', async () => {
    const result = await doWatch(USER_ID, crypto.randomUUID())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('price-drop-watch.module_off')
  })

  it('unwatch() is a no-op', async () => {
    expect(await doUnwatch(USER_ID, crypto.randomUUID())).toBeNull()
  })

  it('applyEvent acknowledges and writes nothing', async () => {
    const report = await applyEvent(t.db, { listingIds: [], key: 'k' })
    expect(report).toEqual({ open: false, evaluated: 0, candidates: 0, events: [] })
  })

  it('tick does nothing', async () => {
    expect(await tick(t.db)).toEqual({ requested: 0 })
  })

  it('erase still runs (rule 12): a watch made while on is removed while off', async () => {
    await t.switches({ 'price-drop-watch': 'on' })
    const recorded = loadRun(RECORDED)
    await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
    const located = await listingIdsBySource(t)
    const listingId = located.get(LISTING_SOURCE_ID) as string
    const watched = await doWatch(USER_ID, listingId)
    if (!watched.ok) throw new Error(watched.error.message)
    await t.switches({ 'price-drop-watch': 'off' })

    const removed = await erase(t.db, [listingId])
    expect(removed).toBe(1)
    const rows = await t.asPipeline(
      'select 1 from price_drop_watch.watches where listing_id = $1',
      [listingId],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('paused pipeline', () => {
  it('applyEvent and tick do nothing while the module is on but pipeline is off', async () => {
    await t.switches({ ...ALL_ON, pipeline: 'off' })
    expect(await applyEvent(t.db, { listingIds: [], key: 'k' })).toEqual({
      open: false,
      evaluated: 0,
      candidates: 0,
      events: [],
    })
    expect(await tick(t.db)).toEqual({ requested: 0 })
  })

  it("watch() still works: a user's own write is not pipeline processing", async () => {
    await t.switches(ALL_ON)
    const recorded = loadRun(RECORDED)
    await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
    const located = await listingIdsBySource(t)
    const listingId = located.get(LISTING_SOURCE_ID) as string

    await t.switches({ pipeline: 'off' })
    const result = await doWatch(USER_ID, listingId)
    expect(result.ok).toBe(true)
  })
})

describe('shadow', () => {
  it('runs and writes, but has no user-facing output', async () => {
    await t.switches({ ...OTHERS_ON, 'price-drop-watch': 'shadow' })
    const recorded = loadRun(RECORDED)
    await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
    const located = await listingIdsBySource(t)
    const listingId = located.get(LISTING_SOURCE_ID) as string
    const watched = await doWatch(USER_ID, listingId)
    if (!watched.ok) throw new Error(watched.error.message)

    const rows = await t.asPipeline('select 1 from price_drop_watch.watches where id = $1', [
      watched.value.id,
    ])
    expect(rows).toHaveLength(1)

    const appRows = await t.asUser(USER_ID, 'select * from app.v_price_drop_watch_watches')
    expect(appRows).toEqual([])
  })
})
