import { describe, expect, it } from 'vitest'
import {
  advertFingerprint,
  candidateEligible,
  clusterFacts,
  clusterKey,
  components,
  confirmBasis,
  descFingerprint,
  hasPriceFingerprint,
  isTextCopy,
  listingFacts,
  memberSetHash,
  normaliseText,
  RULES,
  townGroups,
} from '../src/domain'

describe('normaliseText', () => {
  it('folds case, collapses separators and whitespace', () => {
    expect(normaliseText('  Gaming   PC!!  ')).toBe('gaming pc')
  })

  it('decodes "+" as space only when the text has no other whitespace', () => {
    expect(normaliseText('MSI+AlphaSync+GTX+1660,+Ryzen+7+2700X+Gaming+PC')).toBe(
      'msi alphasync gtx 1660 ryzen 7 2700x gaming pc',
    )
    expect(normaliseText('Gaming PC + Monitor + KBM')).toBe('gaming pc monitor kbm')
  })

  it('keeps digits, so model numbers still separate look-alikes', () => {
    expect(normaliseText('RTX 3070')).not.toBe(normaliseText('RTX 3080'))
  })

  it('masks emails, UK mobile numbers and links, never a matching key', () => {
    expect(normaliseText('call me on 07123 456 789 or a@b.com or https://wa.me/447123456789')).toBe(
      'call me on phone or email or url',
    )
    expect(normaliseText('text 07123456789 now')).toBe(normaliseText('text 07999999999 now'))
  })

  it('applies NFKC before separating', () => {
    // Fullwidth digits (U+FF11 etc.) normalise to ASCII under NFKC.
    expect(normaliseText('１２３')).toBe('123')
  })
})

describe('fingerprints', () => {
  it('hasPriceFingerprint requires a fixed price above zero with a currency', () => {
    expect(hasPriceFingerprint({ moneyKind: 'fixed', priceMinor: 150_00, currency: 'GBP' })).toBe(
      true,
    )
    expect(hasPriceFingerprint({ moneyKind: 'fixed', priceMinor: 0, currency: 'GBP' })).toBe(false)
    expect(hasPriceFingerprint({ moneyKind: 'free', priceMinor: 0, currency: 'GBP' })).toBe(false)
    expect(hasPriceFingerprint({ moneyKind: null, priceMinor: 100, currency: 'GBP' })).toBe(false)
    expect(hasPriceFingerprint({ moneyKind: 'fixed', priceMinor: 100, currency: null })).toBe(false)
  })

  it('advertFingerprint changes with title, price or currency', () => {
    const base = advertFingerprint('gaming pc', 100000, 'GBP')
    expect(advertFingerprint('gaming pc', 100000, 'EUR')).not.toBe(base)
    expect(advertFingerprint('gaming pc', 100001, 'GBP')).not.toBe(base)
    expect(advertFingerprint('other title', 100000, 'GBP')).not.toBe(base)
    expect(advertFingerprint('gaming pc', 100000, 'GBP')).toBe(base)
  })

  it('descFingerprint is deterministic and case/whitespace-sensitive only through normalisation', () => {
    expect(descFingerprint('a description')).toBe(descFingerprint('a description'))
    expect(descFingerprint('a description')).not.toBe(descFingerprint('a different one'))
  })
})

describe('confirmBasis (S3)', () => {
  const rules = RULES
  it('an equal desc_fp at descMinChars or above is exact_text', () => {
    expect(
      confirmBasis({
        titleNormLen: 5,
        descFpA: 'x',
        descFpB: 'x',
        descLenA: rules.descMinChars,
        descLenB: rules.descMinChars,
        similarity: 1,
        rules,
      }),
    ).toBe('exact_text')
  })

  it('an equal desc_fp below descMinChars needs a long title, else it splits as a lookalike', () => {
    const short = { descFpA: 'x', descFpB: 'x', descLenA: 10, descLenB: 10, similarity: 1, rules }
    expect(confirmBasis({ ...short, titleNormLen: rules.titleMinChars })).toBe('exact_text')
    expect(confirmBasis({ ...short, titleNormLen: rules.titleMinChars - 1 })).toBe('lookalike')
  })

  it('different descriptions where either is short are always a lookalike', () => {
    expect(
      confirmBasis({
        titleNormLen: 100,
        descFpA: 'a',
        descFpB: 'b',
        descLenA: rules.descMinChars - 1,
        descLenB: 500,
        similarity: 0.99,
        rules,
      }),
    ).toBe('lookalike')
  })

  it('different, long-enough descriptions confirm by trigram similarity against nearText', () => {
    const long = {
      titleNormLen: 5,
      descFpA: 'a',
      descFpB: 'b',
      descLenA: 200,
      descLenB: 200,
      rules,
    }
    expect(confirmBasis({ ...long, similarity: rules.nearText })).toBe('near_text')
    expect(confirmBasis({ ...long, similarity: rules.nearText - 0.01 })).toBe('lookalike')
  })
})

describe('isTextCopy (S5)', () => {
  const rules = RULES
  it('an equal desc_fp needs both sides at least descMinChars long', () => {
    expect(
      isTextCopy({
        descFpA: 'x',
        descFpB: 'x',
        descLenA: rules.descMinChars,
        descLenB: rules.descMinChars,
        similarity: 1,
        rules,
      }),
    ).toBe(true)
    expect(
      isTextCopy({
        descFpA: 'x',
        descFpB: 'x',
        descLenA: rules.descMinChars - 1,
        descLenB: 500,
        similarity: 1,
        rules,
      }),
    ).toBe(false)
  })

  it('different descriptions need similarity at least textCopy and both sides at least textCopyMinChars', () => {
    const input = {
      descFpA: 'a',
      descFpB: 'b',
      descLenA: rules.textCopyMinChars,
      descLenB: rules.textCopyMinChars,
      rules,
    }
    expect(isTextCopy({ ...input, similarity: rules.textCopy })).toBe(true)
    expect(isTextCopy({ ...input, similarity: rules.textCopy - 0.01 })).toBe(false)
    expect(isTextCopy({ ...input, descLenA: rules.textCopyMinChars - 1, similarity: 1 })).toBe(
      false,
    )
  })
})

describe('candidateEligible (S4)', () => {
  it('needs a long-enough title and the listing in an active hunt area', () => {
    expect(candidateEligible(RULES.titleMinChars, true, RULES)).toBe(true)
    expect(candidateEligible(RULES.titleMinChars - 1, true, RULES)).toBe(false)
    expect(candidateEligible(RULES.titleMinChars, false, RULES)).toBe(false)
  })
})

describe('components (S8)', () => {
  it('groups by confirmed links, and lone nodes stay singletons', () => {
    const groups = components(
      ['a', 'b', 'c', 'd'],
      [
        { a: 'a', b: 'b' },
        { a: 'b', b: 'c' },
      ],
    )
    const sorted = groups.map((g) => [...g].sort())
    expect(sorted).toContainEqual(['a', 'b', 'c'])
    expect(sorted).toContainEqual(['d'])
  })
})

describe('clusterKey and memberSetHash', () => {
  it('is deterministic on the earliest-listed member, ties broken by source listing ID', () => {
    const members = [
      { listingId: '1', sourceListingId: '200', listedAt: new Date('2026-01-02') },
      { listingId: '2', sourceListingId: '100', listedAt: new Date('2026-01-01') },
    ]
    const key = clusterKey('copy-advert@1', members)
    expect(key).toBe(clusterKey('copy-advert@1', [...members].reverse()))
  })

  it('memberSetHash is order-independent', () => {
    expect(memberSetHash(['b', 'a'])).toBe(memberSetHash(['a', 'b']))
    expect(memberSetHash(['a', 'b'])).not.toBe(memberSetHash(['a', 'c']))
  })
})

describe('townGroups and facts (4.8)', () => {
  it('two city pages sharing any label count as one town', () => {
    const groups = townGroups([
      { cityPageId: 'p1', labels: ['Southampton'] },
      { cityPageId: 'p2', labels: ['Southampton', 'Eastleigh'] },
      { cityPageId: 'p3', labels: ['Manchester'] },
    ])
    expect(groups.get('p1')).toBe(groups.get('p2'))
    expect(groups.get('p3')).not.toBe(groups.get('p1'))
  })

  it('clusterFacts counts towns, span and marks mass-posted at massPostedMinTowns', () => {
    const townOf = townGroups([
      { cityPageId: 'p1', labels: ['Town A'] },
      { cityPageId: 'p2', labels: ['Town B'] },
    ])
    const members = [
      {
        listingId: '1',
        sourceListingId: 's1',
        cityPageId: 'p1',
        listedAt: new Date('2026-01-01'),
        lat: 51,
        lng: -1,
      },
      {
        listingId: '2',
        sourceListingId: 's2',
        cityPageId: 'p2',
        listedAt: new Date('2026-01-03'),
        lat: 52,
        lng: 0,
      },
    ]
    const facts = clusterFacts(members, townOf, RULES)
    expect(facts.townCount).toBe(2)
    expect(facts.spanDays).toBe(2)
    expect(facts.massPosted).toBe(true)
    expect(facts.spreadKm).toBeGreaterThan(0)
  })

  it('a same-town relist adds no town and no days to the flagged listing (never a count of past listings)', () => {
    const townOf = townGroups([{ cityPageId: 'p1', labels: ['Town A'] }])
    const target = {
      listingId: '1',
      sourceListingId: 's1',
      cityPageId: 'p1',
      listedAt: new Date('2026-01-01'),
      lat: null,
      lng: null,
    }
    const relist = {
      listingId: '2',
      sourceListingId: 's2',
      cityPageId: 'p1',
      listedAt: new Date('2026-01-26'),
      lat: null,
      lng: null,
    }
    const facts = listingFacts(target, [target, relist], townOf)
    expect(facts.towns).toBe(1)
    expect(facts.spanDays).toBe(0)
  })

  it("a listing's per-listing towns excludes its own town but counts every other one once", () => {
    const townOf = townGroups([
      { cityPageId: 'p1', labels: ['Town A'] },
      { cityPageId: 'p2', labels: ['Town B'] },
      { cityPageId: 'p3', labels: ['Town C'] },
    ])
    const target = {
      listingId: '1',
      sourceListingId: 's1',
      cityPageId: 'p1',
      listedAt: new Date('2026-01-01'),
      lat: null,
      lng: null,
    }
    const other1 = {
      listingId: '2',
      sourceListingId: 's2',
      cityPageId: 'p2',
      listedAt: new Date('2026-01-02'),
      lat: null,
      lng: null,
    }
    const other2 = {
      listingId: '3',
      sourceListingId: 's3',
      cityPageId: 'p3',
      listedAt: new Date('2026-01-03'),
      lat: null,
      lng: null,
    }
    const facts = listingFacts(target, [target, other1, other2], townOf)
    expect(facts.towns).toBe(3)
    expect(facts.spanDays).toBe(2)
  })
})
