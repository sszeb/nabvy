import { describe, expect, it } from 'vitest'
import { newGroupKeyOf, place, positionable, robustZ, shown } from '../src'

describe('place', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => 150000 + 5000 * i)

  it('puts the 4th of 12 at rank 4, about the 29th percentile (PARTS_INTELLIGENCE.md:74-79)', () => {
    expect(place(165000, twelve)).toEqual({ rank: 4, percentile: 29.2 })
  })

  it('gives equal asks one rank and the mid-rank percentile', () => {
    expect(place(100, [100, 100, 200, 300])).toEqual({ rank: 1, percentile: 25 })
  })

  it('places an ask outside the counted set (an outlier) past either end', () => {
    expect(place(999999, twelve)).toEqual({ rank: 13, percentile: 100 })
    expect(place(1, twelve)).toEqual({ rank: 1, percentile: 0 })
  })

  it('has no place without counted asks', () => {
    expect(place(100, [])).toEqual({ rank: null, percentile: null })
  })
})

describe('robustZ', () => {
  it('scales the distance from the median by 1.4826·MAD', () => {
    expect(robustZ(165000, 177500, 15000, 1.4826)).toBe(-0.56)
  })

  it('is null with no median or a zero MAD', () => {
    expect(robustZ(100, null, 10, 1.4826)).toBeNull()
    expect(robustZ(100, 100, 0, 1.4826)).toBeNull()
    expect(robustZ(100, 100, null, 1.4826)).toBeNull()
  })
})

describe('shown', () => {
  it('shows at n = 10 and hides at n = 9 (nabvy/docs/decisions.md:15)', () => {
    expect(shown(10, 10)).toBe(true)
    expect(shown(9, 10)).toBe(false)
  })
})

describe('positionable', () => {
  it('positions counted asks and asks the group set aside', () => {
    for (const excluded of ['relist', 'copy', 'seller', 'outlier']) {
      expect(positionable({ listingId: 'a', askMinor: 1, counted: false, excluded })).toBe(true)
    }
    expect(positionable({ listingId: 'a', askMinor: 1, counted: true, excluded: null })).toBe(true)
  })

  it('never positions asks left out for the listing’s own reason', () => {
    for (const excluded of ['noise', 'sold', 'suppressed', 'stale', 'zero_price', 'promoted']) {
      expect(positionable({ listingId: 'a', askMinor: 1, counted: false, excluded })).toBe(false)
    }
  })
})

describe('newGroupKeyOf', () => {
  it('names the same item’s new-condition group', () => {
    expect(newGroupKeyOf('gpu:rtx-3090|standalone|used_good|GB|GBP|30d')).toBe(
      'gpu:rtx-3090|standalone|new|GB|GBP|30d',
    )
  })

  it('is null for a new group or a malformed key', () => {
    expect(newGroupKeyOf('gpu:rtx-3090|standalone|new|GB|GBP|30d')).toBeNull()
    expect(newGroupKeyOf('nonsense')).toBeNull()
  })
})
