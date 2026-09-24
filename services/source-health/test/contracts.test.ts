import { createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  events,
  module,
  SourceHealthAlertedEvent,
  SourceHealthDay,
  SourceHealthRampStage,
} from '@nabvy/contracts/modules/source-health'
import { describe, expect, it } from 'vitest'

const sampleDay = {
  day: '2026-09-24',
  totalSearches: 100,
  degradedSearches: 5,
  pctDegraded: 0.05,
  breakerTrips: 1,
  newOperationIds: ['q1'],
  blockedPages: [false, true],
  alerted: ['new-operation-id'],
  updatedAt: '2026-09-24T00:00:00.000Z',
}

const sampleRampStage = {
  stage: 1,
  maxChecksPerDay: 100,
  startedAt: '2026-09-24T00:00:00.000Z',
  advancedBy: '2026-09-23',
}

describe('source-health contracts', () => {
  it('declares its module name under its own file', () => {
    expect(module).toBe('source-health')
    expect(events.module).toBe('source-health')
  })

  it('round-trips the source-health.alerted event', () => {
    const envelope = createEvent(
      events,
      'source-health.alerted',
      1,
      { day: '2026-09-24', reasons: ['degraded-spike'] },
      { key: 'source-health.alerted:2026-09-24:degraded-spike' },
    )
    expect(safeParseEvent(events, envelope)).toEqual({ success: true, data: envelope })
    expect(SourceHealthAlertedEvent.parse(envelope.payload)).toEqual(envelope.payload)
  })

  it('rejects an alerted event with no reasons (thin, but never empty)', () => {
    expect(SourceHealthAlertedEvent.safeParse({ day: '2026-09-24', reasons: [] }).success).toBe(
      false,
    )
  })

  it('parses a valid day', () => {
    expect(SourceHealthDay.parse(sampleDay)).toEqual(sampleDay)
  })

  it('rejects a day with an unknown field (thin, strict)', () => {
    expect(SourceHealthDay.safeParse({ ...sampleDay, extra: true }).success).toBe(false)
  })

  it('rejects a day whose pctDegraded is outside 0..1', () => {
    expect(SourceHealthDay.safeParse({ ...sampleDay, pctDegraded: 1.5 }).success).toBe(false)
  })

  it('parses a valid ramp stage, advancedBy null included', () => {
    expect(SourceHealthRampStage.parse(sampleRampStage)).toEqual(sampleRampStage)
    expect(SourceHealthRampStage.parse({ ...sampleRampStage, advancedBy: null })).toEqual({
      ...sampleRampStage,
      advancedBy: null,
    })
  })

  it('rejects a ramp stage with a negative stage number', () => {
    expect(SourceHealthRampStage.safeParse({ ...sampleRampStage, stage: -1 }).success).toBe(false)
  })
})
