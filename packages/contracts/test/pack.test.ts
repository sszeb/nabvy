import { describe, expect, it } from 'vitest'
import { GpuPcFacts, PatternItem, RiskRule } from '../src/modules/packs'

describe('GpuPcFacts', () => {
  const facts = {
    itemType: 'pc',
    gpu: { vendor: 'nvidia', model: 'RTX 3070', vramGb: 8, variant: null },
    cpu: { vendor: 'intel', model: 'i7-12700K' },
    ramGb: 32,
    storage: [{ type: 'nvme', gb: 1000 }],
    psuWatts: null,
    caseModel: null,
    condition: 'used_working',
    tested: true,
    boxed: null,
    includesItems: ['keyboard'],
    mentionsMining: false,
    mentionsDeposit: false,
    wantedPost: false,
    partsOnly: false,
    emptyBox: false,
  }

  it('round-trips a sample', () => {
    expect(GpuPcFacts.parse(facts)).toEqual(facts)
  })

  it('rejects an unknown condition', () => {
    expect(GpuPcFacts.safeParse({ ...facts, condition: 'mint' }).success).toBe(false)
  })
})

describe('RiskRule', () => {
  it('keeps seller-derived flags internal', () => {
    const base = { flag: 'reused_photos', test: 'reused_photos' }
    expect(RiskRule.safeParse({ ...base, action: 'internal' }).success).toBe(true)
    expect(RiskRule.safeParse({ ...base, action: 'weight', weight: 0.2 }).success).toBe(false)
    expect(RiskRule.safeParse({ ...base, action: 'drop' }).success).toBe(false)
  })
})

describe('PatternItem', () => {
  it('accepts a compiling regex or a reference', () => {
    expect(PatternItem.safeParse('\\brtx\\b').success).toBe(true)
    expect(PatternItem.safeParse({ ref: 'listingKind.wantedTitle' }).success).toBe(true)
    expect(PatternItem.safeParse('(unclosed').success).toBe(false)
    expect(PatternItem.safeParse({ ref: 'other.thing' }).success).toBe(false)
  })
})
