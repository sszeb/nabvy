import { levelFor } from '@nabvy/spend-governor'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listRuns, onSearchDegraded, tick } from '../src'
import {
  ALL_ON,
  BELFAST,
  CHICHESTER,
  createTestDatabase,
  type FakePorts,
  fakePorts,
  pair,
  type TestDatabase,
} from './support/database'

// The card's tests (docs/design/modules/check-scheduler.md, "Tests and fixtures") on the real
// migrations in PGlite, with the gateway and the other modules faked: no live run is submitted.

const DAY = new Date('2026-09-25T12:00:00Z') // 13:00 London, in active hours
const later = (minutes: number, from = DAY) => new Date(from.getTime() + minutes * 60_000)

let db: TestDatabase
let ports: FakePorts
beforeEach(async () => {
  db = await createTestDatabase()
  await db.switches(ALL_ON)
  ports = fakePorts()
})
afterEach(() => db.close())

const run = (now: Date) => db.tx((tx) => tick(tx, { ports, now }))

describe('check-scheduler tick', () => {
  it('sends one run per region per tick, with every due term in it', async () => {
    ports.plan = [
      pair(CHICHESTER, 'rtx 3090', 'narrow', 1, 1),
      pair(CHICHESTER, 'gaming pc', 'broad', 1, 2),
      pair(BELFAST, 'rtx 4070', 'narrow', 0, 3),
    ]
    const report = await run(DAY)
    expect(report.status).toBe('ran')
    expect(ports.submitted.map((s) => [s.tags.region, s.shape, s.input.searchTerms])).toEqual([
      [CHICHESTER, 'newest-check', ['rtx 3090', 'gaming pc']],
      [BELFAST, 'newest-check', ['rtx 4070']],
    ])
    // The next slot: newest checks are hourly, so each region's sweep takes its one run.
    await run(later(5))
    expect(ports.submitted.slice(2).map((s) => [s.tags.region, s.shape])).toEqual([
      [CHICHESTER, 'sweep-broad'],
      [BELFAST, 'sweep-narrow'],
    ])
    const runs = await listRuns(db.db)
    const perSlot = new Map<string, number>()
    for (const r of runs) {
      const key = `${r.tickAt}|${r.centreId}`
      perSlot.set(key, (perSlot.get(key) ?? 0) + 1)
    }
    expect([...perSlot.values()].every((n) => n === 1)).toBe(true)
  })

  it('sends includeDetails false and an explicit sort in every search run', async () => {
    ports.plan = [pair(CHICHESTER, 'rtx 3090', 'narrow', 0, 1)]
    ports.oneOffs = [
      {
        id: '01920000-0000-7000-8000-00000000000a',
        purpose: 'verification',
        input: { centreId: BELFAST, terms: ['rtx 3090'] },
        approved: false,
        status: 'pending',
        createdAt: DAY.toISOString(),
        updatedAt: DAY.toISOString(),
      },
    ]
    await run(DAY) // newest check + verification
    await run(later(5)) // sweep
    await db.search({
      id: '01920000-0000-7000-8000-0000000000b1',
      jobId: 3,
      centreId: CHICHESTER,
      term: 'rtx 3090',
      status: 'degraded',
    })
    await db.tx((tx) =>
      onSearchDegraded(tx, [{ jobId: 3, searchIds: ['01920000-0000-7000-8000-0000000000b1'] }]),
    )
    await run(later(10)) // rerun of the sweep
    // A verification goes before a scheduled check (compareDecisions).
    expect(ports.submitted.map((s) => s.shape)).toEqual([
      'verification',
      'newest-check',
      'sweep-narrow',
      'sweep-narrow',
    ])
    for (const s of ports.submitted) {
      expect(s.input.includeDetails).toBe(false)
      expect(s.input.sort === 'newest' || s.input.sort === 'default').toBe(true)
      expect(s.input.listingIds).toBeUndefined()
      expect(s.input.cityId).toBe(s.tags.region)
      expect(s.input.maxListings as number).toBeLessThanOrEqual(5000)
      expect(s.input.maxRequests as number).toBeLessThanOrEqual(1000)
      expect(s.timeoutSecs).toBeGreaterThanOrEqual((s.input.maxRunSeconds as number) + 60)
    }
    expect(ports.submitted[1]?.input.sort).toBe('newest')
    expect(ports.submitted[2]?.input.sort).toBe('default')
  })

  it('reruns a degraded search once, and never reruns a rerun', async () => {
    ports.plan = [
      pair(CHICHESTER, 'gaming pc', 'broad', 0, 1),
      pair(CHICHESTER, 'pc', 'broad', 0, 2),
    ]
    await run(DAY)
    const degraded = {
      id: '01920000-0000-7000-8000-0000000000c1',
      jobId: 1,
      centreId: CHICHESTER,
      term: 'pc',
      status: 'degraded',
    }
    await db.search(degraded)
    const event = { jobId: 1, searchIds: [degraded.id] }
    expect(await db.tx((tx) => onSearchDegraded(tx, [event]))).toBe(1)
    expect(await db.tx((tx) => onSearchDegraded(tx, [event, event]))).toBe(0)
    await run(later(5))
    expect(ports.submitted[1]).toMatchObject({
      shape: 'newest-check',
      input: { searchTerms: ['pc'] },
    })
    // The rerun's own search degrades too: it is not rerun again.
    await db.search({ ...degraded, id: '01920000-0000-7000-8000-0000000000c2', jobId: 2 })
    expect(
      await db.tx((tx) =>
        onSearchDegraded(tx, [{ jobId: 2, searchIds: ['01920000-0000-7000-8000-0000000000c2'] }]),
      ),
    ).toBe(0)
    const reruns = (await listRuns(db.db)).filter((r) => r.reason === 'rerun')
    expect(reruns).toHaveLength(1)
    expect(reruns[0]).toMatchObject({ status: 'submitted', jobId: 2, rerunOf: degraded.id })
  })

  it('applies the throttle order at 80%: free-only regions slow first, paid ones keep pace', async () => {
    ports.plan = [
      pair(CHICHESTER, 'rtx 3090', 'narrow', 1, 1),
      pair(BELFAST, 'rtx 4070', 'narrow', 0, 2),
    ]
    await run(DAY)
    await run(later(5)) // sweeps
    ports.level = levelFor(120_000_000, 150_000_000) // 80% of the $150 month
    expect(ports.level).toBe('slow-free')
    ports.calls = []
    await run(later(60))
    expect(ports.submitted.slice(4).map((s) => s.tags.region)).toEqual([CHICHESTER])
    expect(ports.calls.indexOf('readThrottle')).toBeLessThan(ports.calls.indexOf('submitRun'))
    await run(later(120))
    expect(ports.submitted.slice(5).map((s) => s.tags.region)).toEqual([CHICHESTER, BELFAST])
  })

  it('holds new pairs at hold-new but keeps running pairs, never dropping the new one', async () => {
    ports.plan = [pair(CHICHESTER, 'rtx 3090', 'narrow', 1, 1)]
    await run(DAY)
    ports.level = 'hold-new'
    ports.plan.push(pair(BELFAST, 'rtx 4070', 'narrow', 1, 2))
    const held = await run(later(120))
    expect(held).toMatchObject({ status: 'ran', waiting: [{ centreId: BELFAST, why: 'hold-new' }] })
    expect(ports.submitted.map((s) => s.tags.region)).toEqual([CHICHESTER, CHICHESTER])
    ports.level = 'none'
    await run(later(125))
    expect(ports.submitted.slice(2).map((s) => [s.tags.region, s.shape])).toEqual([
      [BELFAST, 'newest-check'],
      [CHICHESTER, 'sweep-narrow'],
    ])
  })

  it("obeys source-health's ramp cap in term checks per London day, paid regions first", async () => {
    ports.maxChecksPerDay = 3
    ports.plan = [
      pair(BELFAST, 'rtx 4070', 'narrow', 0, 1),
      pair(CHICHESTER, 'rtx 3090', 'narrow', 2, 2),
      pair(CHICHESTER, 'gaming pc', 'broad', 2, 3),
      pair(CHICHESTER, 'pc', 'broad', 2, 4),
    ]
    const first = await run(DAY)
    expect(ports.submitted.map((s) => s.tags.region)).toEqual([CHICHESTER])
    expect(first).toMatchObject({ waiting: [{ centreId: BELFAST, why: 'ramp-cap' }] })
    await run(later(60))
    expect(ports.submitted).toHaveLength(1)
    // The next London day the count starts again.
    await run(new Date('2026-09-26T08:00:00Z'))
    expect(ports.submitted).toHaveLength(2)
  })

  it('submits once when a tick is retried in the same slot', async () => {
    ports.plan = [
      pair(CHICHESTER, 'rtx 3090', 'narrow', 0, 1),
      pair(BELFAST, 'rtx 4070', 'narrow', 0, 2),
    ]
    await run(DAY)
    const retried = await run(later(2))
    expect(retried).toEqual({ status: 'done', tickAt: DAY.toISOString() })
    expect(ports.submitted).toHaveLength(2)
    // A tick that fails after submitting rolls back its claim and the gateway's job together.
    await expect(
      db.tx(async (tx) => {
        await tick(tx, { ports, now: later(5) })
        throw new Error('task crashed after submit')
      }),
    ).rejects.toThrow('task crashed')
    expect((await listRuns(db.db)).length).toBe(2)
  })

  it('records a refused run, keeps the check due and retries it in the next slot', async () => {
    ports.plan = [pair(CHICHESTER, 'rtx 3090', 'narrow', 0, 1)]
    ports.refuse = true
    const refused = await run(DAY)
    expect(refused).toMatchObject({
      runs: [{ status: 'refused', errorCode: 'apify-gateway.refused', jobId: null }],
    })
    ports.refuse = false
    await run(later(5))
    expect(ports.submitted.map((s) => s.shape)).toEqual(['newest-check'])
  })

  it('carries out approved one-offs and verifications once, and settles them', async () => {
    const base = { createdAt: DAY.toISOString(), updatedAt: DAY.toISOString() }
    ports.oneOffs = [
      {
        id: '01920000-0000-7000-8000-0000000000d1',
        purpose: 'gap-fill',
        input: { centreId: CHICHESTER, terms: ['rtx 3090'] },
        approved: true,
        status: 'pending',
        ...base,
      },
      {
        id: '01920000-0000-7000-8000-0000000000d2',
        purpose: 'actor-test',
        input: { centreId: BELFAST, terms: ['pc'] },
        approved: false,
        status: 'pending',
        ...base,
      },
    ]
    await run(DAY)
    await run(later(5))
    expect(ports.submitted.map((s) => [s.tags.region, s.tags.purpose])).toEqual([
      [CHICHESTER, 'one-off:newest'],
    ])
    expect(ports.statusChanges).toEqual([
      { id: '01920000-0000-7000-8000-0000000000d1', status: 'submitted' },
    ])
    ports.jobs.set(1, 'succeeded')
    await run(later(10))
    expect(ports.statusChanges.at(-1)).toEqual({
      id: '01920000-0000-7000-8000-0000000000d1',
      status: 'completed',
    })
  })

  it('orders regions by yield when paid status and kind tie', async () => {
    ports.maxChecksPerDay = 1
    ports.plan = [
      pair(CHICHESTER, 'rtx 3090', 'narrow', 0, 1),
      pair(BELFAST, 'rtx 4070', 'narrow', 0, 2),
    ]
    await db.sql(
      `insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, job_id, created_at)
       values ($1, 'newest', 'newest-check', '{rtx 4070}', 'scheduled', 'submitted', '2026-09-24T12:00:00Z', 90, '2026-09-24T12:00:00Z')`,
      [BELFAST],
    )
    await db.sql(`insert into listing_ingest.v_listings values
      ('01920000-0000-7000-8000-0000000000e1', '2026-09-24T12:01:00Z'),
      ('01920000-0000-7000-8000-0000000000e2', '2026-09-20T12:01:00Z')`)
    await db.sql(`insert into listing_ingest.v_sightings (listing_id, job_id) values
      ('01920000-0000-7000-8000-0000000000e1', 90), ('01920000-0000-7000-8000-0000000000e2', 90)`)
    await run(DAY)
    expect(ports.submitted.map((s) => s.tags.region)).toEqual([BELFAST])
  })
})
