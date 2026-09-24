import type { IncidentRow, RecordDeadLetterInput } from '@nabvy/contracts/modules/incidents'
import { describe, expect, it } from 'vitest'
import { checkRetryable, toDeadLetterRow } from '../src/domain'

const envelope = {
  id: '00000000-0000-7000-8000-000000000001',
  type: 'listing-ingest.first-seen',
  v: 1,
  at: '2026-09-24T00:00:00.000Z',
  key: 'facebook:123:abc',
  payload: { listingIds: ['00000000-0000-7000-8000-000000000002'] },
}

const input: RecordDeadLetterInput = {
  envelope,
  error: { code: 'listing-ingest.timeout', message: 'the adapter timed out' },
  attempts: 3,
  firstFailedAt: '2026-09-24T00:00:00.000Z',
}

const baseRow: IncidentRow = {
  id: '00000000-0000-7000-8000-000000000003',
  eventType: envelope.type,
  eventKey: envelope.key,
  payload: envelope,
  error: input.error,
  attempts: 3,
  firstFailedAt: '2026-09-24T00:00:00.000Z',
  resolvedAt: null,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
}

describe('toDeadLetterRow', () => {
  it('derives the event type and key from the envelope, and keeps the whole envelope', () => {
    const row = toDeadLetterRow(input)
    expect(row.eventType).toBe(envelope.type)
    expect(row.eventKey).toBe(envelope.key)
    expect(row.payload).toEqual(envelope)
    expect(row.error).toEqual(input.error)
    expect(row.attempts).toBe(3)
    expect(row.firstFailedAt).toEqual(new Date('2026-09-24T00:00:00.000Z'))
  })
})

describe('checkRetryable', () => {
  it('refuses a missing incident', () => {
    const result = checkRetryable(undefined)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('incidents.not-found')
  })

  it('refuses an already-resolved incident', () => {
    const result = checkRetryable({ ...baseRow, resolvedAt: '2026-09-24T01:00:00.000Z' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('incidents.already-resolved')
  })

  it('allows an open incident (the boundary: resolvedAt is exactly null)', () => {
    expect(checkRetryable(baseRow)).toEqual({ ok: true, value: baseRow })
  })
})
