import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleRunCollected, type RunCollectedReader } from '../src/handlers'
import { recommendRoute } from '../src/index'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

// A fake RunCollectedReader, so these tests never write `apify_gateway.jobs` — only the
// apify-gateway module may (services/apify-gateway/test/conventions.test.ts). The real reader
// (`realRunCollectedReader`, reading `v_jobs` / `v_run_summaries`) is exercised in production and
// by apify-gateway's own tests of those views; only route-health's own orchestration (kind
// filtering, the region-missing refusal, calling `recordRun`) is this suite's job.
function fakeReader(region: string | undefined, detailRoute: unknown = null): RunCollectedReader {
  return {
    jobRegion: async () => region,
    detailRoute: async () => detailRoute,
  }
}

const throwingReader: RunCollectedReader = {
  jobRegion: async () => {
    throw new Error('jobRegion should not be called for a search-kind run')
  },
  detailRoute: async () => {
    throw new Error('detailRoute should not be called for a search-kind run')
  },
}

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
  await harness.switches(ALL_ON)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('handleRunCollected', () => {
  it('reads the job region and RUN_SUMMARY.detailRoute, then updates the region', async () => {
    const reader = fakeReader('chichester', {
      route: 'graphql',
      detailRequests: 60,
      detailOk: 59,
      queryIds: ['q1'],
    })
    const result = await handleRunCollected(
      harness.db,
      { jobId: 1, apifyRunId: 'handler-run-1', kind: 'details' },
      '2026-09-24T00:00:00.000Z',
      reader,
    )
    expect(result).toEqual({ ok: true, value: { regionId: 'chichester', switched: false } })

    const decision = await recommendRoute(harness.db, 'chichester')
    expect([decision.route, decision.reason, decision.attempts]).toEqual(['graphql', 'healthy', 60])
  })

  it('ignores search-kind runs without reading the job at all: route-health only routes detail runs', async () => {
    const result = await handleRunCollected(
      harness.db,
      { jobId: 2, apifyRunId: 'handler-search-1', kind: 'search' },
      '2026-09-24T00:00:00.000Z',
      throwingReader,
    )
    expect(result).toEqual({ ok: true, value: undefined })
  })

  it('refuses a job with no region tag, so it can be retried once the tag is written', async () => {
    const result = await handleRunCollected(
      harness.db,
      { jobId: 3, apifyRunId: 'handler-no-region', kind: 'details' },
      '2026-09-24T00:00:00.000Z',
      fakeReader(undefined),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('route-health.region_missing')
  })

  it('reports a route switch, from the same recordRun logic idempotency.test.ts covers directly', async () => {
    const first = await handleRunCollected(
      harness.db,
      { jobId: 4, apifyRunId: 'handler-switch-1', kind: 'details' },
      '2026-09-24T00:00:00.000Z',
      fakeReader('portsmouth', {
        route: 'graphql',
        detailRequests: 100,
        detailOk: 99,
        queryIds: ['q1'],
      }),
    )
    expect(first.ok && first.value?.switched).toBe(false)

    const second = await handleRunCollected(
      harness.db,
      { jobId: 5, apifyRunId: 'handler-switch-2', kind: 'details' },
      '2026-09-24T00:01:00.000Z',
      fakeReader('portsmouth', {
        route: 'graphql',
        detailRequests: 30,
        detailOk: 10,
        circuitOpen: true,
      }),
    )
    expect(second).toEqual({ ok: true, value: { regionId: 'portsmouth', switched: true } })
  })
})
