import { describe, expect, it } from 'vitest'
import {
  bestOffer,
  covers,
  discounted,
  emptyPolicy,
  floorCost,
  floorCredits,
  floorViolations,
  freeTierChecks,
  netOfGrossMinor,
  newViolations,
  type Policy,
  type Settings,
  settingsOf,
  topupCredits,
  watchPriceFor,
} from '../src/domain'

// Pure rules, with boundary values. Numbers follow docs/design/pricing-model.md ("Unit
// economics": net = fee ÷ 1.2 − (2.7% × fee + 20p)) and the seeded initial policy.

const S: Settings = {
  minMarginBps: 20_000,
  vatBps: 2_000,
  paymentFeeBps: 270,
  paymentFeeFixedMinor: 20,
  roundTheClockBps: 15_000,
}
const v = <T>(key: string, value: T) => ({ key, version: 1, value })

function policy(): Policy {
  const p = emptyPolicy()
  p.settings.set('min-margin-bps', v('min-margin-bps', { value: S.minMarginBps }))
  p.settings.set('vat-bps', v('vat-bps', { value: S.vatBps }))
  p.settings.set('payment-fee-bps', v('payment-fee-bps', { value: S.paymentFeeBps }))
  p.settings.set('payment-fee-fixed-minor', v('payment-fee-fixed-minor', { value: 20 }))
  p.settings.set('round-the-clock-bps', v('round-the-clock-bps', { value: 15_000 }))
  p.tiers.set(
    'starter',
    v('starter', {
      baseCadenceMinutes: 120,
      floorCadenceMinutes: 60,
      bundledCredits: 1200,
      monthlyPriceMinor: 1200,
      yearlyPriceMinor: 12000,
      topupGrossMicrosPerCredit: 10_000,
      topupNetMicrosPerCredit: 7_900,
      areas: 2,
      wants: 10,
      roundTheClock: false,
    }),
  )
  p.prices.set(
    'lookup',
    v('lookup', { unit: 'each' as const, credits: 10, costBasis: 'check', costUnits: 1 }),
  )
  p.prices.set(
    'watch-60',
    v('watch-60', { unit: 'area-month' as const, credits: 300, cadenceMinutes: 60 }),
  )
  p.prices.set(
    'watch-5',
    v('watch-5', { unit: 'area-month' as const, credits: 2000, cadenceMinutes: 5 }),
  )
  return p
}
const costs = new Map([['check', 13_100]])

describe('money arithmetic', () => {
  it('nets a fee of VAT and payment fees: £12 leaves 947p (pricing-model: £9.48)', () => {
    expect(netOfGrossMinor(1200, S)).toBe(947)
    expect(netOfGrossMinor(0, S)).toBe(0)
    expect(netOfGrossMinor(10, S)).toBe(0) // never below zero
  })

  it('rounds a discount up, in Nabvy’s favour', () => {
    expect(discounted(15, 1000)).toBe(14)
    expect(discounted(50, 5000)).toBe(25)
    expect(discounted(3, 5000)).toBe(2)
  })

  it('covers exactly at the margin and not one micro below', () => {
    const rate = { num: 2620n, den: 1n } // 0.262p a credit
    expect(covers(rate, 10, 13_100, 20_000)).toBe(true) // 2.62p = 2 × 1.31p
    expect(covers({ num: 2619n, den: 1n }, 10, 13_100, 20_000)).toBe(false)
    expect(floorCredits(rate, 13_100, 20_000)).toBe(10)
    expect(floorCredits({ num: 2619n, den: 1n }, 13_100, 20_000)).toBe(11)
  })

  it('uses the higher of measured and recorded cost', () => {
    const basis = {
      provider: 'apify' as const,
      module: null,
      fallbackGbpMicros: 13_100,
      windowDays: 7,
      minSamples: 20,
    }
    expect(floorCost(basis, null)).toBe(13_100)
    expect(floorCost(basis, 9_000)).toBe(13_100)
    expect(floorCost(basis, 30_000)).toBe(30_000)
  })
})

describe('the floor', () => {
  it('passes the starter ladder and refuses a lookup one credit below its floor', () => {
    const p = policy()
    expect(floorViolations(p, costs)).toEqual([])
    // Starter's lowest rate is its monthly fee: 947p ÷ 1200 = 0.789p; 2 × 1.31p needs 4 credits.
    p.prices.set(
      'lookup',
      v('lookup', { unit: 'each' as const, credits: 3, costBasis: 'check', costUnits: 1 }),
    )
    expect(floorViolations(p, costs).map((x) => x.id)).toContain(
      'price/lookup@tier/starter:monthly',
    )
    p.prices.set(
      'lookup',
      v('lookup', { unit: 'each' as const, credits: 4, costBasis: 'check', costUnits: 1 }),
    )
    expect(floorViolations(p, costs)).toEqual([])
  })

  it('refuses a margin of 1x or less and a missing setting', () => {
    const p = policy()
    p.settings.set('min-margin-bps', v('min-margin-bps', { value: 10_000 }))
    expect(floorViolations(p, costs).map((x) => x.id)).toContain('setting/min-margin-bps')
    p.settings.delete('vat-bps')
    expect(settingsOf(p)).toEqual({ missing: ['vat-bps'] })
    expect(floorViolations(p, costs).map((x) => x.id)).toEqual(['setting/vat-bps'])
  })

  it('refuses a price naming an unknown cost basis, and a free action that costs', () => {
    const p = policy()
    p.prices.set(
      'scan',
      v('scan', { unit: 'each' as const, credits: 15, costBasis: 'nope', costUnits: 1 }),
    )
    p.prices.set(
      'free',
      v('free', { unit: 'each' as const, credits: 0, costBasis: 'check', costUnits: 1 }),
    )
    const ids = floorViolations(p, costs).map((x) => x.id)
    expect(ids).toContain('price/scan:basis')
    expect(ids).toContain('price/free:free')
  })

  it('needs a watching price at or faster than each plan floor', () => {
    const p = policy()
    p.prices.delete('watch-60')
    expect(floorViolations(p, costs)).toEqual([]) // watch-5 is faster than Starter's 60-minute floor
    p.prices.delete('watch-5')
    expect(floorViolations(p, costs).map((x) => x.id)).toEqual(['tier/starter:floor-price'])
  })

  it('refuses a change that leaves a breach on the changed row, even an old one', () => {
    const before = [{ id: 'a', rows: ['price/x'], message: '' }]
    const after = [
      { id: 'a', rows: ['price/x'], message: '' },
      { id: 'b', rows: ['price/y'], message: '' },
    ]
    expect(newViolations(before, after, 'price/z').map((x) => x.id)).toEqual(['b'])
    expect(newViolations(before, after, 'price/x').map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('free tier', () => {
  it('counts the coordinator’s bursts: 52, 33 and 33 checks', () => {
    const shape = (fast: number, slow: number) => [
      { cadenceMinutes: 1, minutes: fast },
      { cadenceMinutes: 5, minutes: fast * 5 },
      { cadenceMinutes: 15, minutes: 120 },
      { cadenceMinutes: 60, minutes: slow },
    ]
    const ft = {
      wantCount: 1,
      windowCount: 3,
      windowMinutes: 480,
      resetHours: 72,
      bursts: [shape(20, 240), shape(10, 300)],
      lifetimeCapPence: 200,
      userWeekCapPence: null,
      userMonthCapPence: null,
      poolDayFloorPence: 2000,
      poolRevenueShareBps: 500,
      poolWeekPence: null,
      poolMonthPence: null,
      signupsPerIpDay: null,
      signupsPerDeviceDay: null,
      signupsPerEmailDomainDay: null,
    }
    expect(freeTierChecks(ft)).toEqual([52, 33, 33])
  })
})

describe('watching, offers and top-ups', () => {
  it('prices a cadence at the nearest priced step at or faster than it', () => {
    const p = policy()
    expect(watchPriceFor(p, 60)?.key).toBe('watch-60')
    expect(watchPriceFor(p, 59)?.key).toBe('watch-5')
    expect(watchPriceFor(p, 5)?.key).toBe('watch-5')
    expect(watchPriceFor(p, 4)).toBeNull()
  })

  it('picks the largest live offer for the user, their plan or everyone', () => {
    const p = policy()
    const now = new Date('2026-09-24T12:00:00Z')
    const offer = (
      userId: string | null,
      segment: string | null,
      discountBps: number,
      endsAt: string,
    ) => ({
      userId,
      segment,
      item: 'price:lookup',
      discountBps,
      startsAt: '2026-09-24T11:00:00Z',
      endsAt,
    })
    const U = '00000000-0000-4000-8000-000000000001'
    p.offers.set('all', v('all', offer(null, 'all', 1000, '2026-09-24T13:00:00Z')))
    p.offers.set('pro', v('pro', offer(null, 'plan:pro', 2000, '2026-09-24T13:00:00Z')))
    p.offers.set('mine', v('mine', offer(U, null, 3000, '2026-09-24T12:00:00Z'))) // ends now
    expect(bestOffer(p, 'price:lookup', U, null, now)?.key).toBe('all')
    expect(bestOffer(p, 'price:lookup', U, 'pro', now)?.key).toBe('pro')
    expect(bestOffer(p, 'price:lookup', U, 'pro', new Date('2026-09-24T11:59:59Z'))?.key).toBe(
      'mine',
    )
    expect(bestOffer(p, 'price:other', U, 'pro', now)).toBeNull()
  })

  it('turns net top-up cash into credits at the tier rate, with the best pack reached', () => {
    const p = policy()
    const tier = p.tiers.get('starter')
    if (!tier) throw new Error('no tier')
    expect(topupCredits(p, S, tier, 786)).toEqual({ credits: 994, pack: null }) // £10 at 0.79p net
    p.bundles.set('big', v('big', { tier: null, grossMinor: 2500, discountBps: 1000 }))
    expect(topupCredits(p, S, tier, 786).credits).toBe(994) // below the pack's net price
    const net25 = netOfGrossMinor(2500, S)
    expect(topupCredits(p, S, tier, net25)).toEqual({
      credits: Math.floor((net25 * 10_000) / (7_900 * 0.9)),
      pack: p.bundles.get('big'),
    })
  })
})
