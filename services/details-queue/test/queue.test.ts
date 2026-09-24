import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeBatch, enqueue, readQueue, submitNext } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  type FakePorts,
  fakePorts,
  ids,
  row,
  type TestDatabase,
} from './support/database'

// Behaviour of the queue (card, "Tests and fixtures"; actor-integration.md, task 1.4a):
// deduplication, leases, priority, lanes, batches ≤ 200 grouped by region, the throttle, the
// daily cap and deferral.

const NOW = new Date('2026-09-24T10:00:00Z')

let t: TestDatabase
let ports: FakePorts
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  ports = fakePorts()
})
afterEach(() => t.close())

const tick = (now = NOW) => t.db.transaction((q) => submitNext(q, { ports, now }))
const add = (sourceListingIds: string[], extra: Partial<Parameters<typeof enqueue>[1]> = {}) =>
  t.db.transaction((q) =>
    enqueue(q, {
      sourceListingIds,
      priority: 'new-listing',
      lane: 'text',
      reason: 'first-seen',
      requestedBy: 'details-selector',
      regionId: 'chichester',
      ...extra,
    }),
  )
const statuses = async () =>
  Object.fromEntries(
    (await t.sql('select source_listing_id, status from details_queue.items')).map((r) => [
      r.source_listing_id,
      r.status,
    ]),
  )

describe('enqueue', () => {
  it('deduplicates by listing ID, within a batch and across calls', async () => {
    const [a, b] = ids(2)
    expect(await add([a as string, a as string, b as string])).toEqual({
      queued: 2,
      alreadyQueued: 0,
      skipped: 0,
    })
    expect(await add([a as string])).toEqual({ queued: 0, alreadyQueued: 1, skipped: 0 })
    expect(await t.sql('select 1 from details_queue.items')).toHaveLength(2)
  })

  it('takes over a higher priority, never a lower one', async () => {
    const [a] = ids(1)
    await add([a as string], { priority: 'sweep' })
    await add([a as string], { priority: 'shortlisted' })
    await add([a as string], { priority: 'sweep' })
    expect((await readQueue(t.db))[0]?.priority).toBe('shortlisted')
  })

  it('sends a fetched listing again only when a caller asks for a refresh', async () => {
    const [a] = ids(1)
    await add([a as string])
    const report = await tick()
    await t.rows((report as { jobId: number }).jobId, [row(a as string)])
    await t.db.transaction((q) => closeBatch(q, 1))
    expect(await add([a as string])).toEqual({ queued: 0, alreadyQueued: 0, skipped: 1 })
    expect(
      await add([a as string], { refresh: true, reason: 'recheck', priority: 'shortlisted' }),
    ).toEqual({
      queued: 1,
      alreadyQueued: 0,
      skipped: 0,
    })
    expect((await readQueue(t.db))[0]).toMatchObject({
      status: 'queued',
      reason: 'recheck',
      attempts: 0,
    })
  })

  it('keeps a text and a photo request for one listing apart', async () => {
    const [a] = ids(1)
    await add([a as string])
    await add([a as string], { lane: 'photo', priority: 'photo-capture', reason: 'photo-capture' })
    expect(await t.sql('select lane from details_queue.items order by lane')).toEqual([
      { lane: 'photo' },
      { lane: 'text' },
    ])
  })
})

describe('submitNext', () => {
  it('reads the throttle before it submits anything', async () => {
    await add(ids(3))
    await tick()
    expect(ports.calls.indexOf('readThrottle')).toBeLessThan(ports.calls.indexOf('submitRun'))
  })

  it('submits nothing and leases nothing at hold-new', async () => {
    await add(ids(3))
    ports.level = 'hold-new'
    expect(await tick()).toMatchObject({ status: 'held', level: 'hold-new' })
    expect(ports.calls).not.toContain('submitRun')
    expect(Object.values(await statuses())).toEqual(['queued', 'queued', 'queued'])
  })

  it('lets sweep follow-ups wait while the throttle slows sweeps', async () => {
    await add(ids(2, 1), { priority: 'sweep' })
    ports.level = 'slow-sweeps'
    expect(await tick()).toMatchObject({ status: 'idle' })
    await add(ids(1, 9), { priority: 'shortlisted' })
    expect(await tick()).toMatchObject({ status: 'submitted', size: 1 })
  })

  it('sends at most 200 IDs, one lane and one region per batch, most urgent first', async () => {
    await add(ids(150, 1), { priority: 'sweep', regionId: 'leeds' })
    await add(ids(250, 1000), { priority: 'new-listing', regionId: 'chichester' })
    const first = await tick()
    expect(first).toMatchObject({ status: 'submitted', size: 200, regionId: 'chichester' })
    const sent = ports.submitted[0]
    expect(sent?.shape).toBe('details-text')
    expect(sent?.tags).toEqual({
      module: 'details-queue',
      region: 'chichester',
      purpose: 'new-listing',
    })
    expect(sent?.input.listingIds).toEqual(ids(200, 1000))
    expect(sent?.input).not.toHaveProperty('excludeListingIds')
    expect(sent?.timeoutSecs).toBe(960)
  })

  it('runs one details run at a time', async () => {
    await add(ids(250))
    expect(await tick()).toMatchObject({ status: 'submitted', jobId: 1 })
    expect(await tick()).toMatchObject({ status: 'busy', jobId: 1 })
    expect(ports.submitted).toHaveLength(1)
    await t.rows(
      1,
      ids(200).map((id) => row(id)),
    )
    await t.db.transaction((q) => closeBatch(q, 1))
    expect(await tick()).toMatchObject({ status: 'submitted', jobId: 2, size: 50 })
  })

  it('leases each ID so no other batch sends it', async () => {
    const [a] = ids(1)
    await add([a as string])
    await tick()
    // The same listing asked for in the photo lane waits for the text fetch's lease, whatever lane.
    await add([a as string], { lane: 'photo', priority: 'photo-capture', reason: 'photo-capture' })
    expect(await t.sql('select job_id from details_queue.leases')).toEqual([{ job_id: 1 }])
  })

  it('uses route-health for text and the default region for unplaced items', async () => {
    await add(ids(2), { regionId: undefined, reason: 'pasted-link', priority: 'shortlisted' })
    ports.route = 'page'
    expect(await tick()).toMatchObject({ status: 'submitted', regionId: 'uk', route: 'page' })
    expect(ports.submitted[0]?.input.detailRoute).toBe('page')
  })

  it('records photo captures but does not submit them while the actor cannot capture', async () => {
    await add(ids(3), { lane: 'photo', priority: 'photo-capture', reason: 'photo-capture' })
    expect(await tick()).toMatchObject({ status: 'idle' })
    expect(ports.submitted).toHaveLength(0)
  })

  it('leases nothing when the gateway refuses the run', async () => {
    await add(ids(3))
    ports.refuse = true
    expect(await tick()).toMatchObject({
      status: 'refused',
      error: { code: 'apify-gateway.refused' },
    })
    expect(await t.sql('select 1 from details_queue.leases')).toHaveLength(0)
    expect(await t.sql('select 1 from details_queue.batches')).toHaveLength(0)
    expect(Object.values(await statuses())).toEqual(['queued', 'queued', 'queued'])
  })
})

describe('daily cap', () => {
  it('fills the day up to the cap, then defers with a visible status and an event', async () => {
    const all = ids(1100)
    for (let i = 0; i < all.length; i += 500) await add(all.slice(i, i + 500))
    for (let n = 1; n <= 5; n++) {
      expect(await tick()).toMatchObject({ status: 'submitted', size: 200 })
      await t.rows(
        n,
        ids(200, Number(all[0]) + (n - 1) * 200).map((id) => row(id)),
      )
      await t.db.transaction((q) => closeBatch(q, n))
    }
    const capped = await tick()
    expect(capped).toMatchObject({ status: 'capped', day: '2026-09-24', deferred: 100 })
    if (capped.status !== 'capped') throw new Error('expected capped')
    expect(capped.events.map((e) => e.type)).toEqual(['details-queue.deferred'])
    expect(
      (capped.events[0]?.payload as { sourceListingIds: string[] } | undefined)?.sourceListingIds,
    ).toHaveLength(100)
    const queue = await readQueue(t.db)
    expect(
      queue.filter((i) => i.status === 'deferred').every((i) => i.deferredOn === '2026-09-24'),
    ).toBe(true)
    // A second tick the same day defers nothing new and announces nothing again.
    expect(await tick()).toMatchObject({ status: 'capped', deferred: 0, events: [] })
    // The next London day, deferred work is sent first; nothing aged out.
    expect(await tick(new Date('2026-09-25T08:00:00Z'))).toMatchObject({
      status: 'submitted',
      size: 100,
    })
  })
})

describe('lease expiry', () => {
  const later = new Date(NOW.getTime() + 31 * 60 * 1000)

  it('holds while the job is pending or running', async () => {
    await add(ids(2))
    await tick()
    ports.jobs.set(1, { status: 'running', announcedAt: null })
    expect(await tick(later)).toMatchObject({ status: 'busy', jobId: 1 })
  })

  it('requeues a refused job without counting a failure', async () => {
    await add(ids(2))
    await tick()
    ports.jobs.set(1, { status: 'refused', announcedAt: null })
    expect(await tick(later)).toMatchObject({ status: 'submitted', jobId: 2, closed: [1] })
    expect(await t.sql('select attempts, last_outcome from details_queue.items')).toEqual([
      { attempts: 0, last_outcome: 'run-refused' },
      { attempts: 0, last_outcome: 'run-refused' },
    ])
  })

  it('counts one failed attempt for a failed job', async () => {
    await add(ids(2))
    await tick()
    ports.jobs.set(1, { status: 'failed', announcedAt: null })
    ports.level = 'hold-new'
    expect(await tick(later)).toMatchObject({ status: 'held', closed: [1] })
    expect(await t.sql('select status, attempts from details_queue.items')).toEqual([
      { status: 'queued', attempts: 1 },
      { status: 'queued', attempts: 1 },
    ])
  })

  it('closes from the rows when run-collected was lost', async () => {
    const two = ids(2)
    await add(two)
    await tick()
    await t.rows(
      1,
      two.map((id) => row(id)),
    )
    ports.jobs.set(1, { status: 'succeeded', announcedAt: later.toISOString() })
    expect(await tick(later)).toMatchObject({ status: 'idle', closed: [1] })
    expect(Object.values(await statuses())).toEqual(['done', 'done'])
  })

  it('waits for the announcement of a succeeded job, and for a job it cannot see', async () => {
    await add(ids(2))
    await tick()
    ports.jobs.set(1, { status: 'succeeded', announcedAt: null })
    expect(await tick(later)).toMatchObject({ status: 'busy' })
    ports.jobs.delete(1)
    expect(await tick(later)).toMatchObject({ status: 'busy' })
  })
})
