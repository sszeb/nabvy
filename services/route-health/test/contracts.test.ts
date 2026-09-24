import { createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  events,
  module,
  RouteHealthDecision,
  RouteHealthRouteSwitchedEvent,
  RouteHealthRunEntry,
} from '@nabvy/contracts/modules/route-health'
import { describe, expect, it } from 'vitest'

const sampleDecision = {
  regionId: 'chichester',
  route: 'graphql',
  reason: 'healthy',
  successRate: 0.98,
  attempts: 100,
  newQueryIds: [],
  alert: false,
  at: '2026-09-24T00:00:00.000Z',
}

const sampleRunEntry = {
  apifyRunId: 'VkryjpwS6U2GBDh3k',
  route: 'graphql',
  detailRequests: 19,
  detailOk: 19,
  circuitOpen: false,
  queryIds: ['q1'],
  at: '2026-09-24T00:00:00.000Z',
}

describe('route-health contracts', () => {
  it('declares its module name under its own file', () => {
    expect(module).toBe('route-health')
    expect(events.module).toBe('route-health')
  })

  it('round-trips the route-health.route-switched event', () => {
    const envelope = createEvent(
      events,
      'route-health.route-switched',
      1,
      { regionId: 'chichester' },
      { key: 'route-health.route-switched:chichester@2026-09-24T00:00:00.000Z' },
    )
    expect(safeParseEvent(events, envelope)).toEqual({ success: true, data: envelope })
    expect(RouteHealthRouteSwitchedEvent.parse(envelope.payload)).toEqual(envelope.payload)
  })

  it('parses a valid decision', () => {
    expect(RouteHealthDecision.parse(sampleDecision)).toEqual(sampleDecision)
  })

  it('rejects a decision with an unknown field (thin, strict)', () => {
    expect(RouteHealthDecision.safeParse({ ...sampleDecision, extra: true }).success).toBe(false)
  })

  it('rejects a decision with a success rate outside 0..1', () => {
    expect(RouteHealthDecision.safeParse({ ...sampleDecision, successRate: 1.5 }).success).toBe(
      false,
    )
  })

  it('parses a valid run entry, optional fields included or omitted', () => {
    expect(RouteHealthRunEntry.parse(sampleRunEntry)).toEqual(sampleRunEntry)
    const { detailRequests: _detailRequests, ...minimal } = sampleRunEntry
    expect(RouteHealthRunEntry.parse(minimal)).toEqual(minimal)
  })

  it('rejects a run entry missing its Apify run ID', () => {
    const { apifyRunId: _apifyRunId, ...rest } = sampleRunEntry
    expect(RouteHealthRunEntry.safeParse(rest).success).toBe(false)
  })
})
