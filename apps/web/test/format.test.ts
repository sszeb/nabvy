import { describe, expect, it } from 'vitest'
import { formatDistance, formatDuration, formatMoment, formatMoney } from '@/lib/format'
import { freshnessText } from '@/lib/freshness'

describe('freshness stamp', () => {
  it('reads "listed 14:02 · found 14:05 · delivered 14:05" in UK time', () => {
    expect(
      freshnessText({
        listedAt: '2026-09-24T13:02:00Z',
        foundAt: '2026-09-24T13:05:00Z',
        deliveredAt: '2026-09-24T13:05:00Z',
      }),
    ).toBe('listed 14:02 · found 14:05 · delivered 14:05')
  })

  it('leaves out a stage that has not happened', () => {
    expect(
      freshnessText({ listedAt: '2026-01-10T09:00:00Z', foundAt: '2026-01-10T09:04:00Z' }),
    ).toBe('listed 09:00 · found 09:04')
  })
})

describe('formatting', () => {
  it('formats GBP and EUR without converting between them', () => {
    expect(formatMoney({ amountMinor: 21000, currency: 'GBP' })).toBe('£210')
    expect(formatMoney({ amountMinor: 21050, currency: 'GBP' })).toBe('£210.50')
    expect(formatMoney({ amountMinor: 26000, currency: 'EUR' })).toBe('€260')
  })

  it('rounds distances to whole kilometres, never below 1', () => {
    expect(formatDistance(0.2)).toBe('1 km away')
    expect(formatDistance(9.6)).toBe('10 km away')
  })

  it('shows the date only when the moment is not on the as-of day', () => {
    const asOf = '2026-09-24T13:30:00Z'
    expect(formatMoment('2026-09-24T08:44:00Z', asOf)).toBe('09:44')
    expect(formatMoment('2026-09-23T19:12:00Z', asOf)).toBe('23 Sept, 20:12')
  })

  it('formats durations', () => {
    expect(formatDuration('2026-09-24T13:02:00Z', '2026-09-24T13:05:00Z')).toBe('3 min')
    expect(formatDuration('2026-09-24T11:00:00Z', '2026-09-24T13:05:00Z')).toBe('2 h 5 min')
  })
})
