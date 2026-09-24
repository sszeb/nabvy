import { describe, expect, it } from 'vitest'
import type { PricePosition } from '@/data/types'
import { describePosition, MIN_COMPARABLE_ASKS, NOT_ENOUGH_ASKS } from '@/lib/price-position'

const base: PricePosition = {
  askMinor: 21000,
  currency: 'GBP',
  comparableCount: 23,
  comparableLabel: 'used RTX 3070 cards, UK, last 30 days',
  percentile: 13,
  range: {
    lowestMinor: 18000,
    lowerQuartileMinor: 22500,
    medianMinor: 25000,
    upperQuartileMinor: 27500,
    highestMinor: 32000,
  },
  windowDays: 30,
}

describe('describePosition', () => {
  it('uses the conservative threshold of ten comparable asks', () => {
    expect(MIN_COMPARABLE_ASKS).toBe(10)
  })

  it('hides the position below ten comparable asks', () => {
    for (const comparableCount of [0, 1, 5, 9]) {
      const view = describePosition({ ...base, comparableCount })
      expect(view.kind).toBe('hidden')
      expect(view.text).toBe(NOT_ENOUGH_ASKS)
      expect(view.text).toBe('Not enough comparable asks')
    }
  })

  it('shows the position from exactly ten comparable asks', () => {
    expect(describePosition({ ...base, comparableCount: 10 }).kind).toBe('shown')
  })

  it('describes a low ask by the share of higher asks', () => {
    const view = describePosition(base)
    expect(view.kind).toBe('shown')
    if (view.kind !== 'shown') return
    expect(view.band).toBe('low')
    expect(view.text).toBe('Lower than 87% of comparable asks')
    expect(view.basis).toBe('23 asks for used RTX 3070 cards, UK, last 30 days')
  })

  it('describes middle and high asks', () => {
    expect(describePosition({ ...base, percentile: 50 }).text).toBe(
      'In the middle of comparable asks',
    )
    expect(describePosition({ ...base, percentile: 78 }).text).toBe(
      'Higher than 78% of comparable asks',
    )
  })

  it('places the marker on a 0..100 scale and clamps asks outside the range', () => {
    const view = describePosition({ ...base, askMinor: 10000 })
    if (view.kind !== 'shown') throw new Error('expected shown')
    expect(view.scale.marker).toBe(0)
    expect(view.scale.median).toBeCloseTo(50, 5)
  })

  it('never uses sale, worth or fair-value wording', () => {
    for (const percentile of [0, 13, 50, 78, 100]) {
      for (const comparableCount of [3, 10, 40]) {
        const { text, basis } = describePosition({ ...base, percentile, comparableCount })
        expect(`${text} ${basis}`).not.toMatch(/worth|fair|sale|sold|value/i)
      }
    }
  })
})
