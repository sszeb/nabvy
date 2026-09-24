import { createEvent } from '@nabvy/contracts'
import { events as gatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recompute } from '../src'
import { onRunSettled } from '../src/handlers'
import { ALL_ON, createTestDatabase, seed, type TestDatabase } from './support/database'

// Rule 8: a recompute is keyed by budget and period. Running the handler twice on the same batch
// at the same time writes nothing the second time; alerts carry the same keys, which the
// transport drops.

let t: TestDatabase
const NOW = '2026-09-24T12:00:00.000Z'
const settledBatch = [1, 2].map((jobId) =>
  createEvent(
    gatewayEvents,
    'apify-gateway.run-settled',
    1,
    { jobId },
    {
      key: `apify-gateway.run-settled:${jobId}`,
    },
  ),
)
const rows = () =>
  t.sql(
    'select budget, level, since, committed_micros, computed_at, updated_at from spend_governor.throttle order by budget',
  )

beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await seed(t, {
    calls: [{ refId: 'r1', reservedMicros: 75_000_000, settledMicros: 70_000_000, at: NOW }],
  })
})
afterEach(async () => {
  await t.close()
})

describe('idempotency', () => {
  it('a replayed batch writes nothing and alerts with the same keys', async () => {
    const deps = { now: NOW, usdGbpRate: 0.75 }
    const first = await onRunSettled(t.db, settledBatch, deps)
    expect(first.written).toHaveLength(3)
    expect(first.events.map((e) => e.key)).toEqual([
      'spend-governor.budget-alerted:apify-plan-usage@2026-08-31T23:00:00.000Z@slow-free',
    ])
    const before = await rows()
    const second = await onRunSettled(t.db, settledBatch, deps)
    expect(second).toEqual({ written: [], events: [] })
    expect(await rows()).toEqual(before)
  })

  it('a later recompute with nothing changed refreshes without alerting or moving since', async () => {
    await recompute(t.db, { now: NOW, usdGbpRate: 0.75 })
    const [before] = await rows()
    const later = await recompute(t.db, { now: '2026-09-24T12:20:00.000Z', usdGbpRate: 0.75 })
    expect(later.ok && later.value.events).toEqual([])
    expect(later.ok && later.value.written).toHaveLength(3)
    const [after] = await rows()
    expect(after?.since).toEqual(before?.since)
  })

  it('ignores batches without a settled run', async () => {
    expect(await onRunSettled(t.db, [], { now: NOW, usdGbpRate: 0.75 })).toEqual({
      written: [],
      events: [],
    })
    expect(await rows()).toEqual([])
  })
})
