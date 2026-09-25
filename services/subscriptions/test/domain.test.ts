import { describe, expect, it } from 'vitest'
import {
  addMonths,
  allowanceWindow,
  entitlementStatus,
  extraAreasOf,
  freeLimits,
  intervalMonthsOf,
  matchPlan,
  netCash,
  startNowValid,
} from '../src/domain'
import { TEST_LADDER } from './support/ladder'

const d = (iso: string) => new Date(`${iso}Z`)

describe('entitlement matrix: Stripe status → entitlement status', () => {
  it.each([
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['canceled', 'free'],
    ['unpaid', 'free'],
    ['incomplete', 'free'],
    ['incomplete_expired', 'free'],
    ['paused', 'free'],
  ] as const)('%s → %s', (stripe, expected) => {
    expect(entitlementStatus(stripe, false)).toBe(expected)
  })

  it('a deleted subscription is Free whatever its last status', () => {
    expect(entitlementStatus('active', true)).toBe('free')
  })
})

describe('plans', () => {
  it('matches monthly and annual prices, never Free, and ignores extra-area items', () => {
    expect(matchPlan(TEST_LADDER, ['price_TestExtraArea', 'price_TestPro'])).toMatchObject({
      plan: { plan: 'pro' },
      annual: false,
      itemIndex: 1,
    })
    expect(matchPlan(TEST_LADDER, ['price_TestProAnnual'])?.annual).toBe(true)
    expect(matchPlan(TEST_LADDER, ['price_Unknown'])).toBeNull()
  })

  it('counts extra areas only on the extra-area price, and none when it is not sold', () => {
    const items = [
      {
        price: { id: 'price_TestPro' },
        quantity: 1,
        current_period_start: 0,
        current_period_end: 1,
      },
      { price: { id: 'price_X' }, quantity: 3, current_period_start: 0, current_period_end: 1 },
    ]
    expect(extraAreasOf(items, 'price_X')).toBe(3)
    expect(extraAreasOf(items, null)).toBe(0)
  })

  it('Free uses the policy row, else the documented fallback with no policy version', () => {
    expect(freeLimits(TEST_LADDER[0]).policyVersion).toBe('test-ladder@1')
    expect(freeLimits(undefined)).toMatchObject({ tier: 'free', wants: 1, policyVersion: null })
  })
})

describe('allowance windows', () => {
  it('clamps to the month end', () => {
    expect(addMonths(d('2031-01-31T10:00:00'), 1)).toEqual(d('2031-02-28T10:00:00'))
  })

  it('knows monthly and annual periods, with a day of slack, and nothing else', () => {
    expect(intervalMonthsOf(d('2030-10-08T00:00:00'), d('2030-11-08T00:00:00'))).toBe(1)
    expect(intervalMonthsOf(d('2030-10-10T00:00:00'), d('2031-10-10T00:00:00'))).toBe(12)
    expect(intervalMonthsOf(d('2030-10-01T00:00:00'), d('2030-10-08T00:00:00'))).toBeNull()
  })

  it('an annual period has twelve monthly windows; the boundaries fall in the next one', () => {
    const start = d('2030-10-10T00:00:00')
    const end = d('2031-10-10T00:00:00')
    expect(allowanceWindow(start, end, 12, start)).toEqual({
      start,
      end: d('2030-11-10T00:00:00'),
    })
    expect(allowanceWindow(start, end, 12, d('2030-11-10T00:00:00'))?.start).toEqual(
      d('2030-11-10T00:00:00'),
    )
    expect(allowanceWindow(start, end, 12, d('2031-10-09T23:59:59'))?.end).toEqual(end)
    expect(allowanceWindow(start, end, 12, end)).toBeNull()
    expect(allowanceWindow(start, end, 12, d('2030-10-09T23:59:59'))).toBeNull()
  })
})

describe('money and consent', () => {
  it('net cash takes the tax off and never goes below zero', () => {
    expect(netCash(2900, [{ amount: 483 }])).toBe(2417)
    expect(netCash(100, [{ amount: 500 }])).toBe(0)
    expect(netCash(1000, null)).toBe(1000)
  })

  it('the "Start my plan now" tick must be an ISO time, fresh and not in the future', () => {
    const now = d('2030-10-01T00:10:00')
    expect(startNowValid('2030-10-01T00:00:00.000Z', now, 600)).toBe(true)
    expect(startNowValid('2030-09-30T23:59:59.000Z', now, 600)).toBe(false)
    expect(startNowValid('2030-10-01T00:11:01.000Z', now, 600)).toBe(false)
    expect(startNowValid(true, now, 600)).toBe(false)
    expect(startNowValid('yes', now, 600)).toBe(false)
    expect(startNowValid(undefined, now, 600)).toBe(false)
  })
})
