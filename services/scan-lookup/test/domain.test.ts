import { describe, expect, it } from 'vitest'
import { bandsFrom, type GroupFigures, statusOf } from '../src/domain'

const group = (over: Partial<GroupFigures> = {}): GroupFigures => ({
  context: 'standalone',
  condition: 'used_good',
  currency: 'GBP',
  label: 'RTX 3090',
  n: 12,
  median: 25000,
  p25: 23000,
  p75: 27000,
  ...over,
})

describe('bandsFrom', () => {
  it('keeps a group at the band minimum', () => {
    expect(bandsFrom([group({ n: 10 })], 10)).toHaveLength(1)
  })

  it('drops a group one below the band minimum (docs/decisions.md:15)', () => {
    expect(bandsFrom([group({ n: 9 })], 10)).toHaveLength(0)
  })

  it('drops a group with no figures yet, never shows zero (CLAUDE.md, "No invented numbers")', () => {
    expect(bandsFrom([group({ n: 12, median: null, p25: null, p75: null })], 10)).toHaveLength(0)
  })

  it('maps a qualifying group to a facebook band with its own range', () => {
    const [band] = bandsFrom([group()], 10)
    expect(band).toEqual({
      source: 'facebook',
      context: 'standalone',
      condition: 'used_good',
      label: 'RTX 3090',
      n: 12,
      median: 25000,
      rangeLow: 23000,
      rangeHigh: 27000,
      currency: 'GBP',
    })
  })

  it('keeps a standalone and an in_pc group as separate bands', () => {
    const bands = bandsFrom([group({ context: 'standalone' }), group({ context: 'in_pc' })], 10)
    expect(bands.map((b) => b.context).sort()).toEqual(['in_pc', 'standalone'])
  })
})

describe('statusOf', () => {
  it('is priced once at least one band qualifies', () => {
    expect(statusOf(bandsFrom([group()], 10))).toBe('priced')
  })

  it('is not_enough_asks with no bands (never a guessed number)', () => {
    expect(statusOf([])).toBe('not_enough_asks')
  })
})
