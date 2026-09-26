import { createEvent } from '@nabvy/contracts'
import { events as partsRulesEvents } from '@nabvy/contracts/modules/parts-rules'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PARTS_AI_PROMPT_VERSION, type PartsAiResponse, partsRulesRanHandler, run } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  openThrottle,
  RECORDED,
  type TestDatabase,
  USD_GBP_RATE,
  withFields,
} from './support/database'
import { loadRecording, recordedClient } from './support/model'

// Idempotency on (listing, evidence hash, prompt version): a replayed batch calls nothing, writes
// nothing and returns the same event keys, in any order; a new version of one listing is called
// alone; the handler publishes once.

const recorded = loadRun(RECORDED)
const responses = loadRecording('current').responses
const ctx = { usdGbpRate: USD_GBP_RATE }
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await openThrottle(t)
})
afterEach(async () => {
  await t.close()
})

const counts = async () => {
  const [row] = await t.sql(
    `select (select count(*)::int from parts_ai.calls) as calls,
            (select count(*)::int from parts_ai.ai_parts) as parts,
            (select count(*)::int from cost_meter.provider_calls where module = 'parts-ai') as metered`,
  )
  return row
}

describe('idempotency', () => {
  it('a replayed batch calls nothing, writes nothing and returns the same event keys', async () => {
    const listingIds = await detailed(t, recorded)
    const client = await recordedClient(t, responses)
    const first = await run(t.db, { listingIds }, { client }, ctx)
    const after = await counts()
    const second = await run(t.db, { listingIds: [...listingIds].reverse() }, { client }, ctx)
    if (!first.ok || !second.ok) throw new Error('run failed')
    expect(first.value).toMatchObject({ called: 12, extracted: 12, openVersions: 12 })
    expect(after).toEqual({ calls: 12, parts: 8, metered: 12 })
    expect(second.value).toMatchObject({ called: 0, cached: 12 })
    expect(client.calls).toHaveLength(12)
    expect(await counts()).toEqual(after)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
  })

  it('out of order: a later batch naming earlier listings calls only the new ones', async () => {
    const listingIds = await detailed(t, recorded)
    const client = await recordedClient(t, responses)
    const firstHalf = listingIds.slice(0, 10)
    const a = await run(t.db, { listingIds: listingIds.slice(10) }, { client }, ctx)
    const b = await run(t.db, { listingIds: firstHalf }, { client }, ctx)
    const all = await run(t.db, { listingIds }, { client }, ctx)
    if (!a.ok || !b.ok || !all.ok) throw new Error('run failed')
    expect(a.value.called + b.value.called).toBe(12)
    expect(all.value).toMatchObject({ called: 0, cached: 12 })
    expect(client.calls).toHaveLength(12)
    expect(new Set(client.calls.map((c) => c.traceKey)).size).toBe(12)
  })

  it('a new version of one listing is called alone, under a new key', async () => {
    const listingIds = await detailed(t, recorded)
    const client = await recordedClient(t, responses)
    const first = await run(t.db, { listingIds }, { client }, ctx)
    const edited = withFields(recorded.dataset, '1380502417485603', {
      collectedAt: '2026-09-25T00:00:00.000Z',
      description: 'Specs are in video. The graphics card is a good one.',
    })
    const changed = await detailed(
      t,
      { ...recorded, apifyRunId: `${recorded.apifyRunId}-2` },
      edited,
    )
    expect(changed).toHaveLength(1)
    const [hash] = await t.asPipeline(
      'select evidence_hash from detail_evidence.v_current where listing_id = $1',
      [changed[0]],
    )
    const next = await recordedClient(t, {
      '1380502417485603': {
        ...(responses['1380502417485603'] as PartsAiResponse),
        responseId: 'msg_rec_edit',
      },
    })
    const second = await run(t.db, { listingIds }, { client: next }, ctx)
    if (!first.ok || !second.ok) throw new Error('run failed')
    expect(second.value).toMatchObject({ called: 1, cached: 11 })
    expect(next.calls.map((c) => c.traceKey)).toEqual([hash?.evidence_hash])
    expect(second.value.events[0]?.key).not.toBe(first.value.events[0]?.key)
  })

  it('the prompt version is part of the key', async () => {
    await run(
      t.db,
      { listingIds: await detailed(t, recorded) },
      { client: await recordedClient(t, responses) },
      ctx,
    )
    const rows = await t.sql('select distinct prompt_version from parts_ai.calls')
    expect(rows).toEqual([{ prompt_version: PARTS_AI_PROMPT_VERSION }])
  })

  it('the handler publishes once; a redelivery calls and publishes nothing new', async () => {
    const listingIds = await detailed(t, recorded)
    const client = await recordedClient(t, responses)
    const publisher = createMemoryPublisher()
    const handler = partsRulesRanHandler({
      transaction: (fn) => t.db.transaction(fn),
      client,
      usdGbpRate: USD_GBP_RATE,
    })
    const envelope = createEvent(
      partsRulesEvents,
      'parts-rules.ran',
      1,
      { listingIds },
      { key: 'parts-rules.ran:r1.00000000:x:0' },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-24T02:00:00.000Z' }
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('parts-ai.extracted')).toHaveLength(1)
    expect(publisher.published[0]?.payload).toEqual({ listingIds: expect.any(Array) })
    expect(client.calls).toHaveLength(12)
    expect(await counts()).toMatchObject({ calls: 12 })
  })

  it('a batch over 500 listing IDs is refused before reading anything', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    const client = await recordedClient(t, responses)
    const result = await run(t.db, { listingIds: ids }, { client }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('parts-ai.too_many_listings')
  })

  it('listings with no current version or no rule run are skipped', async () => {
    const client = await recordedClient(t, responses)
    const result = await run(
      t.db,
      { listingIds: ['00000000-0000-7000-8000-000000000001'] },
      { client },
      ctx,
    )
    expect(result).toMatchObject({ ok: true, value: { openVersions: 0, called: 0, events: [] } })
  })
})
