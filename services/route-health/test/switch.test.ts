import { vDecisions } from '@nabvy/db/schema/route-health'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleRunCollected, type RunCollectedReader, recordRun } from '../src/handlers'
import { recommendRoute } from '../src/index'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off acknowledges events and writes nothing, and
// internal views return no rows; shadow behaves like on for a module with no user-facing view
// (route-health has none). "At least one reader's fixtures still pass with this module off": the
// card names details-queue, not built yet, so this checks `recommendRoute` itself, the function a
// reader calls — its "When off" line ("details-queue uses graphql, the actor's default").

// A fake reader so this suite never writes `apify_gateway.jobs` directly (test/handlers.test.ts).
const fakeReader: RunCollectedReader = {
  jobRegion: async () => 'chichester',
  detailRoute: async () => ({
    route: 'graphql',
    detailRequests: 100,
    detailOk: 99,
    queryIds: ['q1'],
  }),
}

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('route-health off', () => {
  it('acknowledges apify-gateway.run-collected and writes nothing', async () => {
    await harness.switches({ 'route-health': 'off' })
    const result = await handleRunCollected(
      harness.db,
      { jobId: 1, apifyRunId: 'off-run-1', kind: 'details' },
      '2026-09-24T00:00:00.000Z',
      fakeReader,
    )
    expect(result).toEqual({ ok: true, value: undefined })
    const rows = await harness.db.select().from(vDecisions)
    expect(rows).toEqual([])
  })

  it('recommendRoute falls back to the actor default (graphql, insufficient-data)', async () => {
    await harness.switches({ 'route-health': 'off' })
    const decision = await recommendRoute(harness.db, 'chichester')
    expect([decision.route, decision.reason, decision.attempts, decision.alert]).toEqual([
      'graphql',
      'insufficient-data',
      0,
      false,
    ])
  })
})

describe('route-health shadow', () => {
  it('records runs and updates v_decisions (an internal view; there is no user-facing one)', async () => {
    await harness.switches({ 'route-health': 'shadow' })
    const recorded = await recordRun(harness.db, {
      regionId: 'reading',
      apifyRunId: 'shadow-run-1',
      detailRoute: { route: 'graphql', detailRequests: 100, detailOk: 99, queryIds: ['q1'] },
      at: '2026-09-24T00:00:00.000Z',
    })
    expect(recorded?.decision.route).toBe('graphql')
    const rows = await harness.db.select({ regionId: vDecisions.regionId }).from(vDecisions)
    expect(rows.some((r) => r.regionId === 'reading')).toBe(true)
    await harness.switches(ALL_ON)
  })
})
