import { healthDaily, processedJobs } from '@nabvy/db/schema/source-health'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RunCollectedReader } from '../src/handlers'
import { handleRunCollected } from '../src/handlers'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

// CLAUDE.md, "Idempotent handlers": a handler must be safe to run twice. A fake RunCollectedReader
// stands in for apify-gateway/route-health/run-coverage's real views; only their own modules may
// write those tables (services/apify-gateway/test/conventions.test.ts). The job's own time
// (`occurredAt`, apify-gateway's settled_at) fixes its day; the delivery time `at` never does.

function fakeReader(
  region: string,
  routes: string[],
  presence: boolean[] = [],
  newOperationIds: string[] = [],
  occurredAt = '2026-09-24T12:00:00.000Z',
): RunCollectedReader {
  return {
    job: async () => ({ regionId: region, occurredAt: new Date(occurredAt) }),
    searchRoutes: async () => routes.map((route) => ({ route })),
    sellerPresence: async () => presence,
    regionDecision: async () => ({ reason: null, newQueryIds: newOperationIds }),
  }
}

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
  await harness.switches(ALL_ON)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

async function dayRow(day: string) {
  const [row] = await harness.db
    .select({
      totalSearches: healthDaily.totalSearches,
      degradedSearches: healthDaily.degradedSearches,
      newOperationIds: healthDaily.newOperationIds,
      blockedPages: healthDaily.blockedPages,
      alerted: healthDaily.alerted,
    })
    .from(healthDaily)
    .where(eq(healthDaily.day, day))
  return row
}

async function processed(jobId: number) {
  const [row] = await harness.db
    .select({ day: processedJobs.day })
    .from(processedJobs)
    .where(eq(processedJobs.jobId, jobId))
  return row?.day
}

describe('handleRunCollected idempotency', () => {
  it('a replayed job (same jobId) writes no new totals and returns the same result', async () => {
    const reader = fakeReader('chichester', ['http', 'http'])
    const at = '2026-09-24T12:00:00.000Z'
    const first = await handleRunCollected(
      harness.db,
      { jobId: 101, apifyRunId: 'r1', kind: 'search' },
      at,
      reader,
    )
    const second = await handleRunCollected(
      harness.db,
      { jobId: 101, apifyRunId: 'r1', kind: 'search' },
      at,
      reader,
    )
    expect(first).toEqual({ ok: true, value: { day: '2026-09-24', alerted: [] } })
    expect(first).toEqual(second)
    expect((await dayRow('2026-09-24'))?.totalSearches).toBe(2)
    expect(await processed(101)).toBe('2026-09-24')
  })

  it("a redelivery after London midnight adds nothing to the new day (the day is the job's own time)", async () => {
    const reader = fakeReader('chichester', ['http', 'failed'], [], [], '2026-09-30T20:00:00.000Z')
    const first = await handleRunCollected(
      harness.db,
      { jobId: 111, apifyRunId: 'r1b', kind: 'search' },
      '2026-09-30T20:05:00.000Z',
      reader,
    )
    expect(first).toEqual({ ok: true, value: { day: '2026-09-30', alerted: ['degraded-spike'] } })

    // Delivered again at 00:10 London on 1 October: still the job of 30 September, still a no-op,
    // and the alert it fired is not fired again.
    const replay = await handleRunCollected(
      harness.db,
      { jobId: 111, apifyRunId: 'r1b', kind: 'search' },
      '2026-09-30T23:10:00.000Z',
      reader,
    )
    expect(replay).toEqual({ ok: true, value: { day: '2026-09-30', alerted: [] } })
    expect(await dayRow('2026-10-01')).toBeUndefined()
    expect((await dayRow('2026-09-30'))?.totalSearches).toBe(2)
    expect(await processed(111)).toBe('2026-09-30')
  })

  it('a job settled after midnight counts on its own day, not on the delivery day', async () => {
    const reader = fakeReader('reading', ['http'], [], [], '2026-10-04T23:30:00.000Z') // 00:30 BST on the 5th
    const result = await handleRunCollected(
      harness.db,
      { jobId: 121, apifyRunId: 'r1c', kind: 'search' },
      '2026-10-04T23:35:00.000Z',
      reader,
    )
    expect(result).toEqual({ ok: true, value: { day: '2026-10-05', alerted: [] } })
    expect(await dayRow('2026-10-04')).toBeUndefined()
  })

  it('two jobs against one day at once both land: counts add up and the alert fires exactly once', async () => {
    const at = '2026-09-25T13:00:00.000Z'
    const occurredAt = '2026-09-25T12:00:00.000Z'
    const left = fakeReader(
      'reading',
      ['browser-fallback', 'browser-fallback', 'http'],
      [true, false],
      ['q-left', 'q-shared'],
      occurredAt,
    )
    const right = fakeReader(
      'reading',
      ['failed', 'http', 'http', 'http'],
      [true, true],
      ['q-shared', 'q-right'],
      occurredAt,
    )
    const results = await Promise.all([
      handleRunCollected(harness.db, { jobId: 201, apifyRunId: 'r2', kind: 'search' }, at, left),
      handleRunCollected(harness.db, { jobId: 202, apifyRunId: 'r3', kind: 'search' }, at, right),
    ])
    const alerted = results.flatMap((r) => (r.ok && r.value ? r.value.alerted : []))
    expect(alerted.filter((reason) => reason === 'degraded-spike')).toHaveLength(1)
    expect(alerted.filter((reason) => reason === 'new-operation-id')).toHaveLength(1)

    const row = await dayRow('2026-09-25')
    expect(row?.totalSearches).toBe(7)
    expect(row?.degradedSearches).toBe(3)
    expect([...(row?.newOperationIds ?? [])].sort()).toEqual(['q-left', 'q-right', 'q-shared'])
    expect([...(row?.blockedPages ?? [])].sort()).toEqual([false, true])
    expect([...(row?.alerted ?? [])].sort()).toEqual(['degraded-spike', 'new-operation-id'])
    expect(await processed(201)).toBe('2026-09-25')
    expect(await processed(202)).toBe('2026-09-25')
  })

  it('an alert reason fires once per day: a later job crossing the same threshold is not re-alerted', async () => {
    const at = '2026-09-25T14:00:00.000Z'
    const later = await handleRunCollected(
      harness.db,
      { jobId: 203, apifyRunId: 'r4', kind: 'search' },
      at,
      fakeReader('reading', ['browser-fallback'], [], ['q-left'], '2026-09-25T13:30:00.000Z'),
    )
    expect(later).toEqual({ ok: true, value: { day: '2026-09-25', alerted: [] } })
    expect((await dayRow('2026-09-25'))?.totalSearches).toBe(8)
  })

  it('a details job is acknowledged and not counted (its rows are not search pages)', async () => {
    const result = await handleRunCollected(
      harness.db,
      { jobId: 301, apifyRunId: 'r5', kind: 'details' },
      '2026-09-26T10:00:00.000Z',
      fakeReader('reading', ['failed'], [false, false], ['q-details'], '2026-09-26T09:00:00.000Z'),
    )
    expect(result).toEqual({ ok: true, value: undefined })
    expect(await dayRow('2026-09-26')).toBeUndefined()
    expect(await processed(301)).toBeUndefined()
  })

  it('a job with no region tag is refused, so it can be retried once the tag is written', async () => {
    const reader: RunCollectedReader = {
      job: async () => ({ regionId: undefined, occurredAt: new Date('2026-09-24T14:00:00.000Z') }),
      searchRoutes: async () => [],
      sellerPresence: async () => [],
      regionDecision: async () => undefined,
    }
    const result = await handleRunCollected(
      harness.db,
      { jobId: 401, apifyRunId: 'r6', kind: 'search' },
      '2026-09-24T14:00:00.000Z',
      reader,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('source-health.job_not_found')
    expect(await processed(401)).toBeUndefined()
  })

  it('a job apify-gateway has no row for yet is refused', async () => {
    const reader: RunCollectedReader = {
      job: async () => undefined,
      searchRoutes: async () => [],
      sellerPresence: async () => [],
      regionDecision: async () => undefined,
    }
    const result = await handleRunCollected(
      harness.db,
      { jobId: 402, apifyRunId: 'r7', kind: 'search' },
      '2026-09-24T14:00:00.000Z',
      reader,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('source-health.job_not_found')
  })
})
