import {
  events,
  module,
  ProductEventsEvent,
  ProductEventsRecord,
} from '@nabvy/contracts/modules/product-events'
import { describe, expect, it } from 'vitest'

const sampleRecord = {
  id: '00000000-0000-7000-8000-000000000001',
  userId: '00000000-0000-7000-8000-000000000002',
  event: 'alert_delivered',
  properties: {
    source: 'facebook',
    channel: 'telegram',
    dealScore: 82,
    freshnessSeconds: 45,
    valuationState: 'valued',
  },
  sessionId: 'session-abc',
  at: '2026-09-24T00:00:00.000Z',
}

describe('product-events contracts', () => {
  it('declares its module name under its own file', () => {
    expect(module).toBe('product-events')
    expect(events.module).toBe('product-events')
  })

  it('publishes no domain events: it is read through v_events (module card, "Outputs")', () => {
    expect(Object.keys(events.definitions)).toHaveLength(0)
  })

  it('parses a valid tracked event', () => {
    expect(
      ProductEventsEvent.safeParse({
        event: 'alert_delivered',
        properties: sampleRecord.properties,
      }).success,
    ).toBe(true)
  })

  it('rejects an event name it does not declare', () => {
    expect(ProductEventsEvent.safeParse({ event: 'listing_viewed', properties: {} }).success).toBe(
      false,
    )
  })

  it('parses a stored row, matching packages/db/src/schema/product-events.ts', () => {
    expect(ProductEventsRecord.parse(sampleRecord)).toEqual(sampleRecord)
  })

  it('rejects a stored row with a null sessionId only when the field is missing entirely', () => {
    expect(ProductEventsRecord.safeParse({ ...sampleRecord, sessionId: null }).success).toBe(true)
    const { sessionId: _sessionId, ...withoutSessionId } = sampleRecord
    expect(ProductEventsRecord.safeParse(withoutSessionId).success).toBe(false)
  })

  it('rejects a stored row with an unknown field', () => {
    expect(ProductEventsRecord.safeParse({ ...sampleRecord, extra: true }).success).toBe(false)
  })
})
