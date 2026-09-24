import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, erase, requestRecheck, tick } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingIdsBySource,
  loadRun,
  RECORDED,
  runJob,
  type TestDatabase,
} from './support/database'

// Rule 11: off records nothing (except requestRecheck, which keeps recording), v_status is empty
// ("status is unknown"), and no recheck is sent; a paused pipeline acts the same for the handlers
// and the tick; shadow runs like on, because the module has no user-facing view.

const recorded = loadRun(RECORDED)
const NOW = new Date('2026-09-24T02:40:43.415Z')

let t: TestDatabase
let ids: string[]
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await runJob(t, recorded, { kind: 'search', collectedAt: '2026-09-24T01:40:43.415Z' })
  ids = [...(await listingIdsBySource(t)).values()]
})
afterEach(async () => {
  await t.close()
})

const stored = async () =>
  (await t.sql('select count(*)::int as n from listing_lifecycle.status'))[0]?.n
const visible = async () =>
  (await t.asPipeline('select count(*)::int as n from listing_lifecycle.v_status'))[0]?.n
const queued = async () =>
  (
    await t.sql(
      `select count(*)::int as n from details_queue.items where requested_by = 'listing-lifecycle'`,
    )
  )[0]?.n

describe('switch', () => {
  it('off: events and ticks write nothing, the view is empty, no recheck is sent', async () => {
    await t.switches({ 'listing-lifecycle': 'off' })
    const event = await applyEvent(t.db, {
      listingIds: ids,
      key: 'listing-ingest.card-changed:1:0',
    })
    expect(event.ok && event.value.open).toBe(false)
    const report = await tick(t.db, { now: NOW })
    expect(report.open).toBe(false)
    expect(await stored()).toBe(0)

    // requestRecheck keeps recording while off (rule 11), and nothing is sent until it is on.
    const request = await requestRecheck(t.db, {
      listingIds: ids,
      reason: 'alerted',
      requestedBy: 'notifier',
    })
    expect(request.scheduled).toBe(20)
    await tick(t.db, { now: new Date(Date.now() + 7 * 3_600_000) })
    expect(await queued()).toBe(0)

    await t.switches({ 'listing-lifecycle': 'on' })
    await tick(t.db, { now: new Date(Date.now() + 7 * 3_600_000) })
    expect(await queued()).toBe(20)
    expect(await visible()).toBe(20)

    await t.switches({ 'listing-lifecycle': 'off' })
    expect(await visible()).toBe(0)
    expect(await stored()).toBe(20)
  })

  it('a paused pipeline stops events and ticks', async () => {
    await t.switches({ pipeline: 'off' })
    const event = await applyEvent(t.db, {
      listingIds: ids,
      key: 'listing-ingest.card-changed:1:0',
    })
    expect(event.ok && event.value.open).toBe(false)
    expect((await tick(t.db, { now: NOW })).open).toBe(false)
    expect(await stored()).toBe(0)
  })

  it('shadow runs like on: rows are written and visible (no user-facing output)', async () => {
    await t.switches({ 'listing-lifecycle': 'shadow' })
    const report = await tick(t.db, { now: NOW })
    expect(report.changed).toHaveLength(20)
    expect(await visible()).toBe(20)
  })

  it('erase runs whatever the switch says', async () => {
    await tick(t.db, { now: NOW })
    await requestRecheck(t.db, { listingIds: ids, reason: 'watched', requestedBy: 'watch' })
    await t.switches({ 'listing-lifecycle': 'off' })
    expect(await erase(t.db, ids)).toBe(20)
    expect(await stored()).toBe(0)
    const [left] = await t.sql('select count(*)::int as n from listing_lifecycle.rechecks')
    expect(left?.n).toBe(0)
  })

  it('listing-ingest and detail-evidence carry on with this module off', async () => {
    await t.switches({ 'listing-lifecycle': 'off' })
    await runJob(t, recorded, { kind: 'search', collectedAt: '2026-09-25T01:40:43.415Z' })
    const [sightings] = await t.asPipeline(
      'select count(*)::int as n from listing_ingest.v_sightings',
    )
    expect(sightings?.n).toBe(40)
  })
})
