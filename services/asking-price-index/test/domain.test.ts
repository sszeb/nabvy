import { describe, expect, it } from 'vitest'
import {
  exclusionOf,
  fences,
  figures,
  formatGroupKey,
  groupCondition,
  groupContext,
  groupKeysOf,
  isStale,
  type ListingFacts,
  quantile,
  sampleOriginOf,
  splitHalfStable,
} from '../src/domain'

const facts = (over: Partial<ListingFacts> = {}): ListingFacts => ({
  listingId: 'a',
  priceMinor: 60000,
  currency: 'GBP',
  moneyKind: 'fixed',
  availability: 'live',
  binding: 'verified',
  cityPageId: 'gb-town',
  lastSeenAt: new Date('2026-09-25T00:00:00Z'),
  cardHash: 'c',
  foundByTerms: ['3090'],
  title: 'RTX 3090',
  evidenceHash: 'e',
  condition: 'used_good',
  description: null,
  form: 'part',
  offered: ['gpu:rtx-3090'],
  noise: false,
  country: 'GB',
  relistGroup: null,
  copyCluster: null,
  suppressed: false,
  promoted: false,
  ...over,
})
const options = { iqrFence: 1.5, thinShare: 1 / 3, onePerSellerKey: true }
const member = (listingId: string, askMinor: number, over = {}) => ({
  listingId,
  askMinor,
  excluded: null,
  collapseKey: `listing:${listingId}`,
  seenAt: new Date('2026-09-25T00:00:00Z'),
  ...over,
})

describe('groupCondition', () => {
  it('lowers new to used_good when the text says used', () => {
    expect(groupCondition('new', 'Only used for 1 month')).toBe('used_good')
    expect(groupCondition('used_like_new', 'used twice')).toBe('used_good')
  })
  it('keeps the attribute when the text says never used, or says nothing', () => {
    expect(groupCondition('new', 'Never used, sealed')).toBe('new')
    expect(groupCondition('new', 'Unused')).toBe('new')
    expect(groupCondition('used_fair', 'brand new')).toBe('used_fair')
  })
  it('returns null for an unknown or missing attribute', () => {
    expect(groupCondition(null, 'used')).toBeNull()
    expect(groupCondition('refurbished', '')).toBeNull()
  })
})

describe('groupContext and group keys', () => {
  it('keeps bundles apart from PCs', () => {
    expect(groupContext('part', 1)).toBe('standalone')
    expect(groupContext('part', 2)).toBe('bundle')
    expect(groupContext('bundle', 1)).toBe('bundle')
    expect(groupContext('system', 1)).toBe('in_pc')
    expect(groupContext('box_only', 1)).toBeNull()
    expect(groupContext('system', 0)).toBeNull()
  })
  it('keys on currency and country and never converts EUR', () => {
    const [gb] = groupKeysOf(facts(), 30)
    const [ie] = groupKeysOf(facts({ currency: 'EUR', country: 'IE' }), 30)
    expect(gb && formatGroupKey(gb)).toBe('gpu:rtx-3090|standalone|used_good|GB|GBP|30d')
    expect(ie && formatGroupKey(ie)).toBe('gpu:rtx-3090|standalone|used_good|IE|EUR|30d')
  })
  it('joins no group without a country or condition', () => {
    expect(groupKeysOf(facts({ country: null }), 30)).toEqual([])
    expect(groupKeysOf(facts({ condition: null }), 30)).toEqual([])
  })
})

describe('exclusionOf', () => {
  it('leaves out noise, sold, £0, non-fixed, unverified, promoted and suppressed', () => {
    expect(exclusionOf(facts())).toBeNull()
    expect(exclusionOf(facts({ suppressed: true, noise: true }))).toBe('suppressed')
    expect(exclusionOf(facts({ noise: true }))).toBe('noise')
    expect(exclusionOf(facts({ availability: 'sold' }))).toBe('sold')
    expect(exclusionOf(facts({ priceMinor: 0 }))).toBe('zero_price')
    expect(exclusionOf(facts({ moneyKind: 'range' }))).toBe('money_kind')
    expect(exclusionOf(facts({ binding: null }))).toBe('unverified_binding')
    expect(exclusionOf(facts({ promoted: true }))).toBe('promoted')
  })
  it('marks an ask stale only past the window', () => {
    const asOf = new Date('2026-09-26T00:00:00Z')
    expect(isStale(new Date('2026-08-27T00:00:00Z'), asOf, 30)).toBe(false)
    expect(isStale(new Date('2026-08-26T23:59:59Z'), asOf, 30)).toBe(true)
  })
})

describe('figures', () => {
  it('uses type-7 quantiles and Tukey fences at k = 1.5', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(fences([10, 20, 30, 40, 50], 1.5)).toEqual({ low: -10, high: 70 })
  })
  it('keeps a value exactly on the fence and cuts one just outside', () => {
    const on = figures(
      [10, 20, 30, 40, 50, 100].map((v, i) => member(`m${i}`, v)),
      options,
    )
    // Q1 = 22.5, Q3 = 47.5, IQR = 25, high fence = 85: 100 is cut.
    expect(on.outcomes.find((o) => o.listingId === 'm5')?.excluded).toBe('outlier')
    const edge = figures(
      [10, 20, 30, 40, 50, 85].map((v, i) => member(`m${i}`, v)),
      options,
    )
    // Same quartiles (22.5, 47.5), so the high fence is again 85: an ask of exactly 85 is kept.
    expect(edge.figures.n).toBe(6)
  })
  it('does not fence fewer than four asks', () => {
    expect(figures([member('a', 1), member('b', 1000)], options).figures.n).toBe(2)
  })
  it('counts one ask per collapse key, the newest seen', () => {
    const { outcomes, figures: f } = figures(
      [
        member('a', 100, { collapseKey: 'relist:g', seenAt: new Date('2026-09-20') }),
        member('b', 200, { collapseKey: 'relist:g', seenAt: new Date('2026-09-21') }),
        member('c', 300, { collapseKey: 'copy:k' }),
        member('d', 300, { collapseKey: 'copy:k' }),
      ],
      options,
    )
    expect(f.n).toBe(2)
    expect(outcomes.map((o) => o.excluded)).toEqual(['relist', null, null, 'copy'])
  })
  it('keeps one ask per seller key and marks a dominated group thin', () => {
    const keyed = figures(
      [
        member('a', 100, { sellerKey: 'k1' }),
        member('b', 110, { sellerKey: 'k1' }),
        member('c', 120, { sellerKey: 'k2' }),
      ],
      options,
    )
    expect(keyed.outcomes.find((o) => o.listingId === 'b')?.excluded).toBe('seller')
    expect(keyed.figures.thin).toBe(true) // k1 supplies 1 of 2 counted asks, over a third
    const spread = figures(
      ['k1', 'k2', 'k3', 'k4'].map((k, i) => member(`m${i}`, 100 + i, { sellerKey: k })),
      options,
    )
    expect(spread.figures.thin).toBe(false)
  })
  it('returns null figures for a group with nothing counted', () => {
    expect(figures([member('a', 1, { excluded: 'sold' })], options).figures).toMatchObject({
      n: 0,
      median: null,
    })
  })
})

describe('sampleOriginOf and splitHalfStable', () => {
  it('is on target when a search term names the item', () => {
    const item = { name: 'RTX 3090', aliases: ['3090'] }
    expect(sampleOriginOf(['3090'], item)).toBe('on_target')
    expect(sampleOriginOf(['gaming pc'], item)).toBe('by_catch')
    expect(sampleOriginOf(['3090'], undefined)).toBe('by_catch')
  })
  it('checks stability only at n >= 10', () => {
    const asks = Array.from({ length: 10 }, (_, i) => ({ listingId: `l${i}`, askMinor: 100 + i }))
    expect(splitHalfStable(asks, 0.25, 10)).toBe(true)
    expect(splitHalfStable(asks.slice(0, 9), 0.25, 10)).toBeNull()
    const skewed = asks.map((a, i) => ({ ...a, askMinor: i % 2 ? 1000 : 100 }))
    expect(splitHalfStable(skewed, 0.25, 10)).toBe(false)
  })
})
