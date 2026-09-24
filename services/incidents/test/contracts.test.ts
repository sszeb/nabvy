import { createEvent, safeParseEvent } from '@nabvy/contracts'
import { events, IncidentRow, module } from '@nabvy/contracts/modules/incidents'
import { describe, expect, it } from 'vitest'

const sampleRow = {
  id: '00000000-0000-7000-8000-000000000001',
  eventType: 'listing-ingest.first-seen',
  eventKey: 'facebook:123:abc',
  payload: {
    id: '00000000-0000-7000-8000-000000000002',
    type: 'listing-ingest.first-seen',
    v: 1,
    at: '2026-09-24T00:00:00.000Z',
    key: 'facebook:123:abc',
    payload: { listingIds: ['00000000-0000-7000-8000-000000000003'] },
  },
  error: { code: 'listing-ingest.timeout', message: 'the adapter timed out' },
  attempts: 3,
  firstFailedAt: '2026-09-24T00:00:00.000Z',
  resolvedAt: null,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
}

describe('incidents contracts', () => {
  it('declares its module name under its own file', () => {
    expect(module).toBe('incidents')
    expect(events.module).toBe('incidents')
  })

  it('round-trips the incidents.dead-lettered event', () => {
    const envelope = createEvent(
      events,
      'incidents.dead-lettered',
      1,
      { incidentIds: ['00000000-0000-7000-8000-000000000001'] },
      { key: 'facebook:123:abc' },
    )
    expect(safeParseEvent(events, envelope)).toEqual({ success: true, data: envelope })
  })

  it('rejects a dead-lettered event with an empty incident list', () => {
    expect(() =>
      createEvent(events, 'incidents.dead-lettered', 1, { incidentIds: [] }, { key: 'x' }),
    ).toThrow()
  })

  it('parses a valid incident row', () => {
    expect(IncidentRow.parse(sampleRow)).toEqual(sampleRow)
  })

  it('rejects an incident row missing a required field', () => {
    const { attempts: _attempts, ...rest } = sampleRow
    expect(IncidentRow.safeParse(rest).success).toBe(false)
  })

  it('rejects an incident row with an unknown field', () => {
    expect(IncidentRow.safeParse({ ...sampleRow, extra: true }).success).toBe(false)
  })
})
