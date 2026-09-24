import { createEvent } from '@nabvy/contracts'
import { events as gatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import { ingest } from '@nabvy/listing-ingest'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assess, runCollectedHandler } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const recorded = loadRun(RECORDED)
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const counts = async () => {
  const [row] = await t.sql(
    `select (select count(*)::int from run_coverage.search_outcomes) as outcomes,
            (select count(*)::int from run_coverage.scope_baselines) as baselines,
            (select max(updated_at) from run_coverage.scope_baselines) as touched`,
  )
  return row
}

const degradedRun = () =>
  t.collected(recorded, recorded.dataset, {
    runSummary: {
      ...recorded.runSummary,
      searches: [{ ...(recorded.runSummary.searches as object[])[0], route: 'browser-fallback' }],
    },
  })

describe('idempotency', () => {
  it('a second run of the same job writes nothing and returns the same event keys', async () => {
    const jobId = await degradedRun()
    await ingest(t.db, { jobId, kind: 'search' })
    const first = await assess(t.db, { jobId, kind: 'search' })
    const after = await counts()
    const second = await assess(t.db, { jobId, kind: 'search' })
    if (!first.ok || !second.ok) throw new Error('assess failed')
    expect(first.value.written).toBe(1)
    expect(second.value.written).toBe(0)
    expect(await counts()).toEqual(after)
    expect(second.value.events.map((e) => e.key)).toEqual([
      `run-coverage.search-degraded:${jobId}:0`,
    ])
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
  })

  it('a replayed baseline read changes nothing', async () => {
    const jobId = await t.collected(recorded)
    await ingest(t.db, { jobId, kind: 'search' })
    await assess(t.db, { jobId, kind: 'search' })
    const after = await counts()
    await assess(t.db, { jobId, kind: 'search' })
    expect(await counts()).toEqual(after)
  })

  it('an earlier read judged late takes the bounded baseline back', async () => {
    const later = await t.collected(recorded, recorded.dataset, {
      runSummary: { ...recorded.runSummary, collectedAt: '2026-09-25T01:00:00.000Z' },
    })
    const earlier = await t.collected(recorded)
    for (const jobId of [later, earlier]) {
      await ingest(t.db, { jobId, kind: 'search' })
      await assess(t.db, { jobId, kind: 'search' })
    }
    const [row] = await t.asPipeline('select job_id, basis from run_coverage.v_scope_baselines')
    expect(row).toEqual({ job_id: earlier, basis: 'bounded' })
  })

  it('waits for listing-ingest: a run whose sightings are not stored yet is retried', async () => {
    const jobId = await t.collected(recorded)
    const early = await assess(t.db, { jobId, kind: 'search' })
    expect(early).toMatchObject({ ok: false, error: { code: 'run-coverage.not_ingested' } })
    expect((await counts())?.outcomes).toBe(0)
    await ingest(t.db, { jobId, kind: 'search' })
    expect((await assess(t.db, { jobId, kind: 'search' })).ok).toBe(true)
  })

  it('on the last attempt, a run listing-ingest never stored is judged without the gap check', async () => {
    const jobId = await t.collected(recorded)
    const result = await assess(t.db, { jobId, kind: 'search', lastAttempt: true })
    expect(result.ok && result.value.statuses).toEqual([{ searchIndex: 0, status: 'capped' }])
    const [row] = await t.asPipeline('select reasons from run_coverage.v_search_coverage')
    expect(row?.reasons).toEqual(['overlap-unchecked'])
  })

  it('a details run is acknowledged and skipped', async () => {
    const jobId = await t.collected(recorded)
    const result = await assess(t.db, { jobId, kind: 'details' })
    expect(result).toMatchObject({ ok: true, value: { open: false, written: 0 } })
  })

  it('a job the gateway does not show is an error', async () => {
    expect(await assess(t.db, { jobId: 999, kind: 'search' })).toMatchObject({
      ok: false,
      error: { code: 'run-coverage.job_not_found' },
    })
  })

  it('the handler publishes once; a redelivery publishes nothing new', async () => {
    const jobId = await degradedRun()
    await ingest(t.db, { jobId, kind: 'search' })
    const publisher = createMemoryPublisher()
    const handler = runCollectedHandler({ transaction: (fn) => t.db.transaction(fn) })
    const envelope = createEvent(
      gatewayEvents,
      'apify-gateway.run-collected',
      1,
      { jobId, apifyRunId: recorded.apifyRunId, kind: 'search' },
      { key: `apify-gateway.run-collected:${jobId}` },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-24T02:00:00.000Z' }
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('run-coverage.search-degraded')).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(1)
  })
})
