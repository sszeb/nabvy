import { healthDaily } from '@nabvy/db/schema/source-health'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RunCollectedReader } from '../src/handlers'
import { handleRunCollected } from '../src/handlers'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

// CLAUDE.md, "Idempotent handlers": a handler must be safe to run twice. A fake RunCollectedReader
// stands in for apify-gateway/route-health/run-coverage's real views (test/handlers.test.ts has
// the fuller reader tests); only their own modules may write those tables
// (services/apify-gateway/test/conventions.test.ts).

function fakeReader(
  region: string,
  routes: string[],
  presence: boolean[] = [],
  newOperationIds: string[] = [],
): RunCollectedReader {
  return {
    jobExists: async () => true,
    jobRegion: async () => region,
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

describe('handleRunCollected idempotency', () => {
  it('a replayed job (same jobId) writes no new totals and returns the same result', async () => {
    const reader = fakeReader('chichester', ['http', 'browser-fallback'])
    const at = '2026-09-24T12:00:00.000Z'
    const first = await handleRunCollected(harness.db, { jobId: 101, apifyRunId: 'r1', kind: 'search' }, at, reader)
    const second = await handleRunCollected(harness.db, { jobId: 101, apifyRunId: 'r1', kind: 'search' }, at, reader)
    expect(first).toEqual(second)

    const [row] = await harness.db
      .select({ totalSearches: healthDaily.totalSearches, processedJobIds: healthDaily.processedJobIds })
      .from(healthDaily)
      .where(eq(healthDaily.day, '2026-09-24'))
    expect(row?.totalSearches).toBe(2)
    expect(row?.processedJobIds).toEqual([101])
  })

  it('an alert reason fires once per day: a second job crossing the same threshold is not re-alerted', async () => {
    const at = '2026-09-24T13:00:00.000Z'
    const spikeReader = fakeReader('reading', Array(10).fill('browser-fallback'))
    const first = await handleRunCollected(
      harness.db,
      { jobId: 201, apifyRunId: 'r2', kind: 'search' },
      at,
      spikeReader,
    )
    expect(first).toEqual({ ok: true, value: { day: '2026-09-24', alerted: ['degraded-spike'] } })

    const second = await handleRunCollected(
      harness.db,
      { jobId: 202, apifyRunId: 'r3', kind: 'search' },
      at,
      fakeReader('reading', ['browser-fallback']),
    )
    expect(second).toEqual({ ok: true, value: { day: '2026-09-24', alerted: [] } })
  })

  it('a job with no region tag is refused, so it can be retried once the tag is written', async () => {
    const reader: RunCollectedReader = {
      jobExists: async () => true,
      jobRegion: async () => undefined,
      searchRoutes: async () => [],
      sellerPresence: async () => [],
      regionDecision: async () => undefined,
    }
    const result = await handleRunCollected(
      harness.db,
      { jobId: 301, apifyRunId: 'r4', kind: 'search' },
      '2026-09-24T14:00:00.000Z',
      reader,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('source-health.job_not_found')
  })
})
