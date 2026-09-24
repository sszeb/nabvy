import { describe, expect, it } from 'vitest'
import {
  advise,
  alertKey,
  decimalToMicros,
  floatToMicros,
  forecast,
  levelFor,
  londonMonth,
  overallLevel,
  plan,
  type ThrottleState,
  validUntil,
} from '../src/domain'

const LIMIT = 150_000_000

describe('levelFor', () => {
  it.each([
    [119_999_999, 'none'],
    [120_000_000, 'slow-free'],
    [127_499_999, 'slow-free'],
    [127_500_000, 'slow-paid'],
    [135_000_000, 'slow-sweeps'],
    [142_500_000, 'hold-new'],
    [300_000_000, 'hold-new'],
    [0, 'none'],
  ])('%i of $150 is %s', (committed, level) => {
    expect(levelFor(committed, LIMIT)).toBe(level)
  })
})

describe('overallLevel', () => {
  it('takes the highest level, and fails closed on no budgets', () => {
    expect(overallLevel(['none', 'slow-paid', 'slow-free'])).toBe('slow-paid')
    expect(overallLevel(['none'])).toBe('none')
    expect(overallLevel([])).toBe('hold-new')
  })
})

describe('londonMonth', () => {
  it('starts a summer month at 23:00 UTC the day before (BST)', () => {
    const m = londonMonth(new Date('2026-09-24T12:00:00Z'))
    expect(m.start.toISOString()).toBe('2026-08-31T23:00:00.000Z')
    expect(m.end.toISOString()).toBe('2026-09-30T23:00:00.000Z')
  })
  it('starts a winter month at midnight UTC (GMT), and rolls December into January', () => {
    const m = londonMonth(new Date('2026-12-31T23:59:59Z'))
    expect(m.start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(m.end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
  it('puts 23:30 UTC on 31 August in September (00:30 BST)', () => {
    expect(londonMonth(new Date('2026-08-31T23:30:00Z')).start.toISOString()).toBe(
      '2026-08-31T23:00:00.000Z',
    )
  })
  it('spans the October clock change', () => {
    const m = londonMonth(new Date('2026-10-15T12:00:00Z'))
    expect(m.start.toISOString()).toBe('2026-09-30T23:00:00.000Z')
    expect(m.end.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('amounts', () => {
  it('reads Postgres numerics as micros, rounding up past six places', () => {
    expect(decimalToMicros('0.3363')).toBe(336_300)
    expect(decimalToMicros('150')).toBe(150_000_000)
    expect(decimalToMicros('0.0000001')).toBe(1)
    expect(decimalToMicros('1.0000000')).toBe(1_000_000)
    expect(() => decimalToMicros('-1')).toThrow(RangeError)
  })
  it('reads Apify GB as micro-GB, rounding up', () => {
    expect(floatToMicros(0.0001356257125735283)).toBe(136)
    expect(floatToMicros(8)).toBe(8_000_000)
    expect(() => floatToMicros(Number.NaN)).toThrow(RangeError)
  })
})

describe('forecast', () => {
  const period = londonMonth(new Date('2026-09-24T12:00:00Z'))
  it('extrapolates at the rate so far', () => {
    // 15 of 30 days elapsed: twice the committed spend.
    const half = new Date(period.start.getTime() + 15 * 86_400_000)
    expect(forecast(10_000_000, period, half)).toBe(20_000_000)
  })
  it('treats less than a day as a day', () => {
    const early = new Date(period.start.getTime() + 3_600_000)
    expect(forecast(1_000_000, period, early)).toBe(30_000_000)
  })
  it('never extrapolates past the end', () => {
    expect(forecast(1_000_000, period, new Date(period.end.getTime() + 1))).toBe(1_000_000)
  })
})

describe('plan', () => {
  const t0 = new Date('2026-09-24T12:00:00Z')
  const periodStart = new Date('2026-08-31T23:00:00Z')
  const prev: ThrottleState = {
    level: 'slow-free',
    since: new Date('2026-09-20T00:00:00Z'),
    periodStart,
    committedMicros: 70_000_000,
    forecastMicros: 90_000_000,
    computedAt: t0,
  }
  const same = { ...prev, computedAt: t0 }

  it('writes nothing when nothing changed and no refresh is due', () => {
    expect(plan(prev, same)).toEqual({ write: false, since: prev.since, alert: false })
    expect(plan(prev, { ...same, computedAt: new Date(t0.getTime() + 14 * 60_000) }).write).toBe(
      false,
    )
  })
  it('refreshes after 15 minutes without moving since or alerting', () => {
    const later = { ...same, computedAt: new Date(t0.getTime() + 15 * 60_000) }
    expect(plan(prev, later)).toEqual({ write: true, since: prev.since, alert: false })
  })
  it('writes a new amount at the same level, keeping since', () => {
    expect(plan(prev, { ...same, committedMicros: 71_000_000 })).toEqual({
      write: true,
      since: prev.since,
      alert: false,
    })
  })
  it('alerts when the level rises, and moves since', () => {
    expect(plan(prev, { ...same, level: 'slow-paid' })).toEqual({
      write: true,
      since: t0,
      alert: true,
    })
  })
  it('does not alert when the level falls', () => {
    expect(plan(prev, { ...same, level: 'none' })).toEqual({ write: true, since: t0, alert: false })
  })
  it('alerts on a first computation above none, and not at none', () => {
    expect(plan(null, same).alert).toBe(true)
    expect(plan(null, { ...same, level: 'none' })).toEqual({ write: true, since: t0, alert: false })
  })
  it('alerts again in a new period at the same level', () => {
    const next = { ...same, periodStart: new Date('2026-09-30T23:00:00Z') }
    expect(plan(prev, next)).toEqual({ write: true, since: t0, alert: true })
  })
})

describe('keys and validity', () => {
  it('keys an alert by budget, period and level', () => {
    expect(alertKey('apify-monthly', '2026-08-31T23:00:00.000Z', 'hold-new')).toBe(
      'spend-governor.budget-alerted:apify-monthly@2026-08-31T23:00:00.000Z@hold-new',
    )
  })
  it('keeps a row valid for an hour', () => {
    expect(validUntil(new Date('2026-09-24T12:00:00Z')).toISOString()).toBe(
      '2026-09-24T13:00:00.000Z',
    )
  })
})

describe('advise', () => {
  const b = { provider: 'apify' as const, unit: 'USD' as const }
  it('reports a forecast over the limit and a Scale plan that may pay, once each', () => {
    expect(
      advise([
        { ...b, name: 'apify-monthly', limitMicros: 150_000_000, forecastMicros: 210_000_000 },
        { ...b, name: 'apify-plan-usage', limitMicros: 85_000_000, forecastMicros: 210_000_000 },
        { ...b, name: 'quiet', limitMicros: 85_000_000, forecastMicros: 1 },
        { ...b, name: 'unmeasured', limitMicros: 1, forecastMicros: null },
      ]).map((a) => `${a.budget}:${a.advice}`),
    ).toEqual([
      'apify-monthly:forecast-over-limit',
      'apify-monthly:scale-plan-may-pay',
      'apify-plan-usage:forecast-over-limit',
    ])
  })
})
