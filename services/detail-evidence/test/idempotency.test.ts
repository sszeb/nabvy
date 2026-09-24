import { createEvent } from '@nabvy/contracts'
import { events as gatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { record, runCollectedHandler } from '../src'
import {
  ALL_ON,
  collectedAndIngested,
  createTestDatabase,
  later,
  loadRun,
  RECORDED,
  type TestDatabase,
  withFields,
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
    `select (select count(*)::int from detail_evidence.evidence) as versions,
            (select count(*)::int from detail_evidence.fetches) as fetches,
            (select max(updated_at) from detail_evidence.evidence) as touched`,
  )
  return row
}

describe('idempotency', () => {
  it('a second run of the same job writes nothing and returns the same event keys', async () => {
    const jobId = await collectedAndIngested(t, recorded)
    const first = await record(t.db, { jobId })
    const after = await counts()
    const second = await record(t.db, { jobId })
    if (!first.ok || !second.ok) throw new Error('record failed')
    expect(after).toMatchObject({ versions: 20, fetches: 20 })
    expect(await counts()).toEqual(after)
    expect(second.value.versionsWritten + second.value.fetchesWritten).toBe(0)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(second.value.changed).toEqual(first.value.changed)
  })

  it('a replayed later job, with the version already seen, writes nothing', async () => {
    await record(t.db, { jobId: await collectedAndIngested(t, recorded) })
    const next = await collectedAndIngested(
      t,
      recorded,
      later(recorded.dataset, '2026-09-25T00:00:00.000Z'),
    )
    await record(t.db, { jobId: next })
    const after = await counts()
    await record(t.db, { jobId: next })
    expect(await counts()).toEqual(after)
  })

  it('a late replay of an older run announces nothing and keeps the current version', async () => {
    const edited = withFields(
      later(recorded.dataset, '2026-09-25T00:00:00.000Z'),
      '1756692548940192',
      { description: 'Edited later.' },
    )
    const older = await t.collected(recorded)
    const newer = await collectedAndIngested(t, recorded, edited)
    expect((await record(t.db, { jobId: newer })).ok).toBe(true)
    const late = await record(t.db, { jobId: older })
    if (!late.ok) throw new Error('record failed')
    expect(late.value.changed).toEqual([])
    const [row] = await t.asPipeline(
      `select x.description from detail_evidence.v_current c
       join detail_evidence.v_text x using (listing_id, evidence_hash)
       where c.source_listing_id = '1756692548940192'`,
    )
    expect(row?.description).toBe('Edited later.')
    const [kept] = await t.asPipeline(
      `select first_seen_at, item_job_id from detail_evidence.v_current
       where source_listing_id = '1816901372840238'`,
    )
    expect(new Date(kept?.first_seen_at as string).toISOString()).toBe('2026-09-24T01:40:43.415Z')
    expect(kept?.item_job_id).toBe(older)
  })

  it('a later full_verified fetch of the same text marks a partial version complete', async () => {
    const partial = withFields(recorded.dataset, '1756692548940192', {
      descriptionStatus: 'partial',
    })
    await record(t.db, { jobId: await collectedAndIngested(t, recorded, partial) })
    const next = await collectedAndIngested(
      t,
      recorded,
      later(recorded.dataset, '2026-09-25T00:00:00.000Z'),
    )
    const result = await record(t.db, { jobId: next })
    if (!result.ok) throw new Error('record failed')
    expect(result.value.versionsWritten).toBe(0)
    expect(result.value.changed).toEqual([])
    const [row] = await t.asPipeline(
      `select description_status from detail_evidence.v_current
       where source_listing_id = '1756692548940192'`,
    )
    expect(row?.description_status).toBe('full_verified')
    const after = await counts()
    await record(t.db, { jobId: next })
    expect(await counts()).toEqual(after)
  })

  it('the handler publishes once; a redelivery publishes nothing new', async () => {
    const jobId = await collectedAndIngested(t, recorded)
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
    expect(publisher.ofType('detail-evidence.changed')).toHaveLength(1)
    expect(publisher.published[0]?.payload).toMatchObject({ listingIds: expect.any(Array) })
    expect(publisher.duplicates).toHaveLength(1)
    expect(await counts()).toMatchObject({ versions: 20, fetches: 20 })
  })

  it('a job whose listings are not ingested yet fails before writing, so it is retried', async () => {
    const jobId = await t.collected(recorded)
    const result = await record(t.db, { jobId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('detail-evidence.listing_not_ingested')
    expect(await counts()).toMatchObject({ versions: 0, fetches: 0 })
  })

  it('a job the gateway does not show fails, so it is retried rather than dropped', async () => {
    const result = await record(t.db, { jobId: 999 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('detail-evidence.job_not_found')
  })
})
