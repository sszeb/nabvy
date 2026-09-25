import { vHealth, vRampStage } from '@nabvy/db/schema/source-health'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assessRamp, handleRunCollected, type RunCollectedReader } from '../src/handlers'
import { recommendRampStage } from '../src/index'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off acknowledges events and writes nothing, and
// internal views return no rows; shadow behaves like on for a module with no user-facing view
// (source-health has none). "At least one reader's fixtures still pass with this module off": the
// card names check-scheduler, not built yet, so this checks `recommendRampStage` itself, the
// function a reader calls — its "When off" line ("check-scheduler uses the lowest ramp stage").

const fakeReader: RunCollectedReader = {
  job: async () => ({ regionId: 'chichester', occurredAt: new Date('2026-09-24T00:00:00.000Z') }),
  searchRoutes: async () => [{ route: 'http' }],
  sellerPresence: async () => [true],
  regionDecision: async () => ({ reason: null, newQueryIds: [] }),
}

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('source-health off', () => {
  it('acknowledges apify-gateway.run-collected and writes nothing', async () => {
    await harness.switches({ 'source-health': 'off' })
    const result = await handleRunCollected(
      harness.db,
      { jobId: 1, apifyRunId: 'off-run-1', kind: 'search' },
      '2026-09-24T00:00:00.000Z',
      fakeReader,
    )
    expect(result).toEqual({ ok: true, value: undefined })
    const rows = await harness.db.select().from(vHealth)
    expect(rows).toEqual([])
  })

  it('assessRamp does nothing', async () => {
    await harness.switches({ 'source-health': 'off' })
    const result = await assessRamp(harness.db, new Date('2026-09-24T00:00:00.000Z'))
    expect(result).toBeUndefined()
    const rows = await harness.db.select().from(vRampStage)
    expect(rows).toEqual([])
  })

  it('recommendRampStage falls back to the lowest stage', async () => {
    await harness.switches({ 'source-health': 'off' })
    const stage = await recommendRampStage(harness.db)
    expect([stage.stage, stage.advancedBy]).toEqual([0, null])
  })
})

describe('source-health shadow', () => {
  it('records a job and updates v_health (an internal view; there is no user-facing one)', async () => {
    await harness.switches({ 'source-health': 'shadow' })
    const result = await handleRunCollected(
      harness.db,
      { jobId: 2, apifyRunId: 'shadow-run-1', kind: 'search' },
      '2026-09-24T00:00:00.000Z',
      fakeReader,
    )
    expect(result.ok).toBe(true)
    const rows = await harness.db.select({ day: vHealth.day }).from(vHealth)
    expect(rows.some((r) => r.day === '2026-09-24')).toBe(true)
    await harness.switches(ALL_ON)
  })
})
