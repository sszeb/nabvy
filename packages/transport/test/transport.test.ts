import { readFileSync } from 'node:fs'
import {
  batchKey,
  createEvent,
  DeadLetter,
  defineEvents,
  type EventEnvelope,
  err,
  HandledEvent,
  listingKey,
  ok,
  Source,
  type TStamps,
  Uuid,
} from '@nabvy/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createMemoryPublisher,
  createTriggerPublisher,
  type DeadLetterSink,
  defineHandler,
  emit,
  RetryableEventError,
  type TriggerItem,
} from '../src'

// A thin-event hop run against a fixture batch of 120 listings: a producer publishes
// `listing-ingest.first-seen`, a consumer (shaped like `details-selector`) upserts one row per
// listing keyed on source + sourceListingId + contentHash, stamps T2 and emits its own event.

const Listing = z.strictObject({
  listingId: Uuid,
  source: Source,
  sourceListingId: z.string(),
  contentHash: z.string(),
  t1Fetched: z.string(),
})
const fixture = z
  .object({ listings: z.array(Listing).min(100).max(500) })
  .parse(
    JSON.parse(readFileSync(new URL('./fixtures/listing-batch.json', import.meta.url), 'utf8')),
  )
const byId = new Map(fixture.listings.map((l) => [l.listingId, l]))

const ingest = defineEvents('listing-ingest', {
  'listing-ingest.first-seen': { 1: z.object({ listingIds: z.array(Uuid).min(1).max(500) }) },
})
const selector = defineEvents('details-selector', {
  'details-selector.selected': { 1: z.object({ listingIds: z.array(Uuid).min(1).max(500) }) },
})
const incidents = defineEvents('incidents', {
  'incidents.dead-lettered': { 1: z.object({ incidentIds: z.array(Uuid).min(1).max(500) }) },
})

const T = (s: number) => new Date(Date.UTC(2026, 8, 24, 1, 41, s))
const attempt = (n: number) => ({ attempt: n, maxAttempts: 3, firstAttemptAt: T(0).toISOString() })

async function firstSeen() {
  const keys = fixture.listings.map(listingKey)
  return createEvent(
    ingest,
    'listing-ingest.first-seen',
    1,
    { listingIds: fixture.listings.map((l) => l.listingId) },
    { key: await batchKey('listing-ingest.first-seen', keys) },
  )
}

/** The consumer's own table: one row per listing version, stamps kept earliest-first. */
function selectorModule(options: { failUntilAttempt?: number } = {}) {
  const rows = new Map<string, { listingId: string; stamps: TStamps }>()
  let writes = 0
  const handler = defineHandler({
    consumer: 'details-selector',
    registry: ingest,
    type: 'listing-ingest.first-seen',
    stamp: 't2Candidate',
    async handle(event, ctx) {
      if (ctx.attempt.attempt < (options.failUntilAttempt ?? 0)) throw new Error('database gone')
      const listings = event.payload.listingIds.map((id) => byId.get(id))
      if (listings.some((l) => l === undefined)) {
        return err({ code: 'details-selector.unknown_listing', message: 'not in the registry' })
      }
      const keys: string[] = []
      for (const listing of listings as z.infer<typeof Listing>[]) {
        const key = listingKey(listing)
        keys.push(key)
        const existing = rows.get(key)
        const stamps = ctx.stamp(existing?.stamps ?? { t1Fetched: listing.t1Fetched })
        if (existing && existing.stamps.t2Candidate === stamps.t2Candidate) continue // no-op
        rows.set(key, { listingId: listing.listingId, stamps })
        writes++
      }
      ctx.emit(
        createEvent(
          selector,
          'details-selector.selected',
          1,
          { listingIds: event.payload.listingIds },
          { key: await batchKey('details-selector.selected', keys) },
        ),
      )
      return ok(undefined)
    },
  })
  return { handler, rows, writes: () => writes }
}

function incidentsSink() {
  const recorded: DeadLetter[] = []
  const sink: DeadLetterSink = {
    async record(input) {
      recorded.push(DeadLetter.parse(input))
      const event = createEvent(
        incidents,
        'incidents.dead-lettered',
        1,
        { incidentIds: ['01926f3a-8b7c-7d4e-9f00-00000000abcd'] },
        { key: input.envelope.key },
      )
      return { event }
    },
  }
  return { sink, recorded }
}

describe('handler wrapper', () => {
  it('handles a batch, stamps T2 once per listing and emits one event', async () => {
    const publisher = createMemoryPublisher()
    const { sink, recorded } = incidentsSink()
    const consumer = selectorModule()
    const event = await firstSeen()

    const outcome = await consumer.handler.run(event, attempt(1), {
      publisher,
      deadLetters: sink,
      now: () => T(5),
    })

    expect(HandledEvent.parse(outcome)).toEqual({
      status: 'handled',
      eventId: event.id,
      key: event.key,
      at: T(5).toISOString(),
      emitted: 1,
    })
    expect(consumer.rows.size).toBe(120)
    expect(consumer.writes()).toBe(120)
    for (const row of consumer.rows.values()) {
      expect(row.stamps.t2Candidate).toBe(T(5).toISOString())
      expect(row.stamps.t1Fetched).toBe('2026-09-24T01:40:00.000Z')
    }
    expect(publisher.ofType('details-selector.selected')).toHaveLength(1)
    expect(recorded).toHaveLength(0)
  })

  it('is a no-op when the same event is handled twice', async () => {
    const publisher = createMemoryPublisher()
    const { sink } = incidentsSink()
    const consumer = selectorModule()
    const event = await firstSeen()

    await consumer.handler.run(event, attempt(1), { publisher, deadLetters: sink, now: () => T(5) })
    const before = structuredClone([...consumer.rows])
    // Redelivered later, as a retry or a replay would be: same envelope, later clock.
    const second = await consumer.handler.run(event, attempt(1), {
      publisher,
      deadLetters: sink,
      now: () => T(50),
    })

    expect(second.status).toBe('handled')
    expect(consumer.writes()).toBe(120) // nothing written the second time
    expect([...consumer.rows]).toEqual(before) // T2 not moved later
    expect(publisher.ofType('details-selector.selected')).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(1) // same key, dropped by the transport
  })

  it('throws for a retry before the last attempt, then dead-letters to incidents', async () => {
    const publisher = createMemoryPublisher()
    const { sink, recorded } = incidentsSink()
    const consumer = selectorModule({ failUntilAttempt: 99 })
    const event = await firstSeen()
    const deps = { publisher, deadLetters: sink, now: () => T(5) }

    await expect(consumer.handler.run(event, attempt(1), deps)).rejects.toBeInstanceOf(
      RetryableEventError,
    )
    await expect(consumer.handler.run(event, attempt(2), deps)).rejects.toThrow(
      'transport.handler_threw: database gone',
    )
    const outcome = await consumer.handler.run(event, attempt(3), deps)

    expect(outcome).toMatchObject({ status: 'dead-lettered', attempts: 3, key: event.key })
    expect(recorded).toEqual([
      {
        envelope: event,
        error: { code: 'transport.handler_threw', message: 'database gone' },
        attempts: 3,
        firstFailedAt: T(0).toISOString(),
      },
    ])
    expect(publisher.ofType('incidents.dead-lettered')).toHaveLength(1)
    expect(publisher.ofType('details-selector.selected')).toHaveLength(0)
    expect(consumer.rows.size).toBe(0)
  })

  it('recovers on a later attempt without dead-lettering', async () => {
    const publisher = createMemoryPublisher()
    const { sink, recorded } = incidentsSink()
    const consumer = selectorModule({ failUntilAttempt: 2 })
    const event = await firstSeen()
    const deps = { publisher, deadLetters: sink }

    await expect(consumer.handler.run(event, attempt(1), deps)).rejects.toThrow()
    expect((await consumer.handler.run(event, attempt(2), deps)).status).toBe('handled')
    expect(recorded).toHaveLength(0)
  })

  it("dead-letters a handler's expected failure on the last attempt with its own code", async () => {
    const { sink, recorded } = incidentsSink()
    const consumer = selectorModule()
    const event = createEvent(
      ingest,
      'listing-ingest.first-seen',
      1,
      { listingIds: ['01926f3a-8b7c-7d4e-9f00-ffffffffffff'] },
      { key: 'listing-ingest.first-seen:unknown' },
    )
    const outcome = await consumer.handler.run(event, attempt(3), {
      publisher: createMemoryPublisher(),
      deadLetters: sink,
    })
    expect(outcome).toMatchObject({ error: { code: 'details-selector.unknown_listing' } })
    expect(recorded).toHaveLength(1)
  })

  it('dead-letters an invalid payload at once, without retrying', async () => {
    const { sink, recorded } = incidentsSink()
    const consumer = selectorModule()
    const event = { ...(await firstSeen()), payload: { listingIds: [] } }
    const outcome = await consumer.handler.run(event, attempt(1), {
      publisher: createMemoryPublisher(),
      deadLetters: sink,
    })
    expect(outcome).toMatchObject({
      status: 'dead-lettered',
      attempts: 1,
      error: { code: 'transport.invalid_event' },
    })
    expect(recorded[0]?.envelope).toEqual(event)
  })

  it('dead-letters an event of another type', async () => {
    const { sink } = incidentsSink()
    const consumer = selectorModule()
    const other = createEvent(
      incidents,
      'incidents.dead-lettered',
      1,
      { incidentIds: ['01926f3a-8b7c-7d4e-9f00-00000000abcd'] },
      { key: 'k' },
    )
    const outcome = await consumer.handler.run(other, attempt(1), {
      publisher: createMemoryPublisher(),
      deadLetters: sink,
    })
    expect(outcome).toMatchObject({ error: { code: 'transport.invalid_event' } })
  })

  it('rejects a malformed envelope without dead-lettering it', async () => {
    const { sink, recorded } = incidentsSink()
    const outcome = await selectorModule().handler.run({ type: 'nope' }, attempt(1), {
      publisher: createMemoryPublisher(),
      deadLetters: sink,
    })
    expect(outcome.status).toBe('rejected')
    expect(recorded).toHaveLength(0)
  })

  it('retries when the emitted events cannot be published', async () => {
    const { sink } = incidentsSink()
    const failing = {
      async publish() {
        throw new Error('trigger.dev unavailable')
      },
    }
    await expect(
      selectorModule().handler.run(await firstSeen(), attempt(1), {
        publisher: failing,
        deadLetters: sink,
      }),
    ).rejects.toThrow('transport.publish_failed')
  })

  it('refuses a handler for an event the producer does not declare', () => {
    expect(() =>
      defineHandler({
        consumer: 'details-selector',
        registry: ingest,
        type: 'listing-ingest.nope' as 'listing-ingest.first-seen',
        handle: async () => ok(undefined),
      }),
    ).toThrow('declares no event')
  })

  it('refuses to stamp for a handler that declared no stamp', async () => {
    const { sink } = incidentsSink()
    const handler = defineHandler({
      consumer: 'copy-advert',
      registry: ingest,
      type: 'listing-ingest.first-seen',
      async handle(_event, ctx) {
        ctx.stamp({})
        return ok(undefined)
      },
    })
    const outcome = await handler.run(await firstSeen(), attempt(3), {
      publisher: createMemoryPublisher(),
      deadLetters: sink,
    })
    expect(outcome).toMatchObject({ error: { message: expect.stringContaining('no stamp') } })
  })
})

describe('publishers', () => {
  it('emit() builds the latest version and publishes it once per key', async () => {
    const publisher = createMemoryPublisher()
    const payload = { listingIds: fixture.listings.slice(0, 3).map((l) => l.listingId) }
    const first = await emit(publisher, ingest, 'listing-ingest.first-seen', payload, { key: 'a' })
    await emit(publisher, ingest, 'listing-ingest.first-seen', payload, { key: 'a' })
    expect(first.v).toBe(1)
    expect(publisher.published).toEqual([first])
    expect(publisher.duplicates).toHaveLength(1)
  })

  it('emit() refuses a fat payload', async () => {
    await expect(
      emit(
        createMemoryPublisher(),
        ingest,
        'listing-ingest.first-seen',
        { listingIds: [] },
        {
          key: 'a',
        },
      ),
    ).rejects.toThrow()
  })

  it('the Trigger.dev publisher batches per task, keyed by the envelope key', async () => {
    const calls: { taskId: string; items: readonly TriggerItem[] }[] = []
    const publisher = createTriggerPublisher({
      async batchTrigger(taskId, items) {
        calls.push({ taskId, items })
      },
    })
    const many: EventEnvelope[] = []
    for (let i = 0; i < 501; i++) {
      many.push(
        createEvent(
          ingest,
          'listing-ingest.first-seen',
          1,
          { listingIds: [fixture.listings[i % 120]?.listingId ?? ''] },
          { key: `k${i}` },
        ),
      )
    }
    const dead = createEvent(
      incidents,
      'incidents.dead-lettered',
      1,
      { incidentIds: ['01926f3a-8b7c-7d4e-9f00-00000000abcd'] },
      { key: 'd' },
    )
    await publisher.publish([...many.slice(0, 2), dead, ...many.slice(2)])

    expect(calls.map((c) => [c.taskId, c.items.length])).toEqual([
      ['listing-ingest-first-seen', 500],
      ['listing-ingest-first-seen', 1],
      ['incidents-dead-lettered', 1],
    ])
    expect(calls[0]?.items[0]).toEqual({ payload: many[0], idempotencyKey: 'k0' })
  })
})
