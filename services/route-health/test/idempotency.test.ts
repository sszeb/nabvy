import { routeRuns } from '@nabvy/db/schema/route-health'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordRun } from '../src/handlers'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
  await harness.switches(ALL_ON)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('recordRun (CLAUDE.md, "Idempotent handlers")', () => {
  it('a replayed run (same apifyRunId) writes no new row and returns the same decision', async () => {
    const input = {
      regionId: 'idempotency-region',
      apifyRunId: 'idempotency-run-1',
      detailRoute: { route: 'graphql', detailRequests: 100, detailOk: 99, queryIds: ['q1'] },
      at: '2026-09-24T00:00:00.000Z',
    }
    const first = await recordRun(harness.db, input)
    const second = await recordRun(harness.db, input)
    expect(first?.decision).toEqual(second?.decision)
    expect(second?.switched).toBe(false)

    const rows = await harness.db
      .select()
      .from(routeRuns)
      .where(eq(routeRuns.regionId, 'idempotency-region'))
    expect(rows).toHaveLength(1)
  })

  it('reports switched only on the call that actually moves the route', async () => {
    const regionId = 'idempotency-switch-region'
    const healthy = await recordRun(harness.db, {
      regionId,
      apifyRunId: 'switch-run-1',
      detailRoute: { route: 'graphql', detailRequests: 100, detailOk: 99, queryIds: ['q1'] },
      at: '2026-09-24T00:00:00.000Z',
    })
    expect(healthy?.switched).toBe(false)

    const tripped = await recordRun(harness.db, {
      regionId,
      apifyRunId: 'switch-run-2',
      detailRoute: { route: 'graphql', detailRequests: 30, detailOk: 10, circuitOpen: true },
      at: '2026-09-24T00:01:00.000Z',
    })
    expect([tripped?.decision.route, tripped?.decision.reason, tripped?.switched]).toEqual([
      'page',
      'circuit-open',
      true,
    ])

    // Still on page: no further switch.
    const stillDown = await recordRun(harness.db, {
      regionId,
      apifyRunId: 'switch-run-3',
      detailRoute: { route: 'page' },
      at: '2026-09-24T00:02:00.000Z',
    })
    expect([stillDown?.decision.route, stillDown?.switched]).toEqual(['page', false])
  })

  it('keeps only the most recent 11 runs per region', async () => {
    const regionId = 'idempotency-prune-region'
    for (let i = 0; i < 15; i += 1) {
      await recordRun(harness.db, {
        regionId,
        apifyRunId: `prune-run-${i}`,
        detailRoute: { route: 'graphql', detailRequests: 100, detailOk: 99, queryIds: ['q1'] },
        at: `2026-09-24T00:${String(i).padStart(2, '0')}:00.000Z`,
      })
    }
    const rows = await harness.db.select().from(routeRuns).where(eq(routeRuns.regionId, regionId))
    expect(rows).toHaveLength(11)
    expect(rows.map((r) => r.apifyRunId).sort()).toEqual(
      Array.from({ length: 11 }, (_, i) => `prune-run-${i + 4}`).sort(),
    )
  })
})
