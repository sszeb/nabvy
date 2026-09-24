import { incidents } from '@nabvy/db/schema/incidents'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { record, retry } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

function envelopeFor(key: string) {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    type: 'listing-ingest.first-seen',
    v: 1,
    at: '2026-09-24T00:00:00.000Z',
    key,
    payload: { listingIds: ['00000000-0000-7000-8000-000000000002'] },
  }
}

describe('record (CLAUDE.md, "Idempotent handlers")', () => {
  it('writes one row for the same envelope key called twice', async () => {
    const envelope = envelopeFor('facebook:idempotency-1:abc')
    const input = {
      envelope,
      error: { code: 'listing-ingest.timeout', message: 'first failure' },
      attempts: 3,
      firstFailedAt: '2026-09-24T00:00:00.000Z',
    }

    const first = await harness.as('nabvy_pipeline', (db) => record(db, input))
    const second = await harness.as('nabvy_pipeline', (db) =>
      record(db, {
        ...input,
        error: { code: 'listing-ingest.timeout', message: 'second failure' },
      }),
    )

    expect(second.incident.id).toBe(first.incident.id)
    const rows = await harness.as('postgres', (db) =>
      db.select().from(incidents).where(eq(incidents.eventKey, envelope.key)),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.error).toEqual({ code: 'listing-ingest.timeout', message: 'second failure' })
  })

  it('keeps two incidents when different event types share one key (PR #19 review)', async () => {
    const key = 'facebook:idempotency-5:abc'
    const first = envelopeFor(key)
    const second = { ...envelopeFor(key), type: 'asking-price-position.computed' }
    const baseInput = {
      error: { code: 'listing-ingest.timeout', message: 'boom' },
      attempts: 3,
      firstFailedAt: '2026-09-24T00:00:00.000Z',
    }

    const firstResult = await harness.as('nabvy_pipeline', (db) =>
      record(db, { ...baseInput, envelope: first }),
    )
    const secondResult = await harness.as('nabvy_pipeline', (db) =>
      record(db, { ...baseInput, envelope: second }),
    )

    expect(secondResult.incident.id).not.toBe(firstResult.incident.id)
    const rows = await harness.as('postgres', (db) =>
      db.select().from(incidents).where(eq(incidents.eventKey, key)),
    )
    expect(rows).toHaveLength(2)
  })

  it('reopens an incident that fails again after being retried', async () => {
    const envelope = envelopeFor('facebook:idempotency-2:abc')
    const input = {
      envelope,
      error: { code: 'listing-ingest.timeout', message: 'first failure' },
      attempts: 3,
      firstFailedAt: '2026-09-24T00:00:00.000Z',
    }

    const { incident } = await harness.as('nabvy_pipeline', (db) => record(db, input))
    const retried = await harness.as('nabvy_app', (db) => retry(db, incident.id))
    expect(retried.ok).toBe(true)

    const reopened = await harness.as('nabvy_pipeline', (db) => record(db, input))
    expect(reopened.incident.id).toBe(incident.id)
    expect(reopened.incident.resolvedAt).toBeNull()
  })
})

describe('retry', () => {
  it('re-emits the same envelope that was recorded, and resolves the incident', async () => {
    const envelope = envelopeFor('facebook:idempotency-3:abc')
    const input = {
      envelope,
      error: { code: 'listing-ingest.timeout', message: 'boom' },
      attempts: 3,
      firstFailedAt: '2026-09-24T00:00:00.000Z',
    }

    const { incident } = await harness.as('nabvy_pipeline', (db) => record(db, input))
    const result = await harness.as('nabvy_app', (db) => retry(db, incident.id))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.envelope).toEqual(envelope)
  })

  it('refuses to retry the same incident twice', async () => {
    const envelope = envelopeFor('facebook:idempotency-4:abc')
    const input = {
      envelope,
      error: { code: 'listing-ingest.timeout', message: 'boom' },
      attempts: 3,
      firstFailedAt: '2026-09-24T00:00:00.000Z',
    }

    const { incident } = await harness.as('nabvy_pipeline', (db) => record(db, input))
    const first = await harness.as('nabvy_app', (db) => retry(db, incident.id))
    const second = await harness.as('nabvy_app', (db) => retry(db, incident.id))

    expect(first.ok).toBe(true)
    expect(second).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'incidents.already-resolved' }),
    })
  })

  it('refuses to retry an incident that does not exist', async () => {
    const result = await harness.as('nabvy_app', (db) =>
      retry(db, '00000000-0000-7000-8000-000000000099'),
    )
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'incidents.not-found' }),
    })
  })
})
