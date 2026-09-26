import { createEvent, parseEvent } from '@nabvy/contracts'
import {
  DemandSignalsCell,
  DemandSignalsPublishedEvent,
  DemandSignalsWeekStart,
  events,
  module,
} from '@nabvy/contracts/modules/demand-signals'
import { describe, expect, it } from 'vitest'
import { publishWeek } from '../src'

const cell = {
  weekStart: '2026-09-14',
  centreId: '110092169012550',
  family: 'rtx-3090',
  wants: 12,
  adverts: null,
  suppressed: false,
  ruleVersion: 'ds-1',
  publishedAt: '2026-09-21T03:00:00.000Z',
}

describe('demand-signals contracts', () => {
  it('declares its name and its one event', () => {
    expect(module).toBe('demand-signals')
    expect(events.module).toBe('demand-signals')
    expect(Object.keys(events.definitions)).toEqual(['demand-signals.published'])
  })

  it('takes a week as its Monday', () => {
    expect(DemandSignalsWeekStart.safeParse('2026-09-14').success).toBe(true)
    expect(DemandSignalsWeekStart.safeParse('2026-09-15').success).toBe(false)
    expect(DemandSignalsWeekStart.safeParse('2026-9-14').success).toBe(false)
  })

  it('parses a cell and refuses a count under 10 or a wrong suppressed flag', () => {
    expect(DemandSignalsCell.parse(cell)).toEqual(cell)
    expect(DemandSignalsCell.safeParse({ ...cell, wants: 9 }).success).toBe(false)
    expect(DemandSignalsCell.safeParse({ ...cell, adverts: 0 }).success).toBe(false)
    expect(DemandSignalsCell.safeParse({ ...cell, suppressed: true }).success).toBe(false)
    expect(
      DemandSignalsCell.safeParse({ ...cell, wants: null, adverts: null, suppressed: true })
        .success,
    ).toBe(true)
  })

  it('refuses a user ID, a seller field or a listing ID on a cell', () => {
    for (const extra of ['userId', 'sellerId', 'sellerName', 'listingId']) {
      expect(DemandSignalsCell.safeParse({ ...cell, [extra]: 'x' }).success).toBe(false)
    }
  })

  it('carries only the week in its event (rule 7)', () => {
    expect(Object.keys(DemandSignalsPublishedEvent.shape)).toEqual(['weekStart'])
    expect(
      DemandSignalsPublishedEvent.safeParse({ weekStart: '2026-09-14', wants: 1 }).success,
    ).toBe(false)
  })

  it('round-trips the event through the envelope parser', () => {
    const envelope = createEvent(
      events,
      'demand-signals.published',
      1,
      { weekStart: '2026-09-14' },
      { key: 'demand-signals.published:2026-09-14@ds-1' },
    )
    const parsed = parseEvent(events, JSON.parse(JSON.stringify(envelope)))
    expect(parsed.type).toBe('demand-signals.published')
    expect(parsed.payload).toEqual({ weekStart: '2026-09-14' })
  })

  it('refuses a week that is not a Monday or has not closed, before any read', async () => {
    const now = new Date('2026-09-25T00:00:00Z')
    // A Queryable that is never called: both inputs are refused first.
    expect(await publishWeek({} as never, { weekStart: '2026-09-15' }, now)).toMatchObject({
      ok: false,
      error: { code: 'demand-signals.invalid_input' },
    })
    expect(await publishWeek({} as never, { weekStart: '2026-09-21' }, now)).toMatchObject({
      ok: false,
      error: { code: 'demand-signals.week_not_closed' },
    })
  })
})
