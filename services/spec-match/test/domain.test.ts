import { SPEC_MATCH_RULES } from '@nabvy/config/modules/spec-match'
import type { WantManagerCriterion } from '@nabvy/contracts/modules/want-manager'
import { describe, expect, it } from 'vitest'
import {
  catalogueFit,
  compareBy,
  distanceCriterion,
  evaluate,
  type ListingInput,
  originOf,
  type PartInput,
  partCriterion,
  priceCriterion,
  ruleVersion,
  type SortFacts,
  verdictOf,
  type WantInput,
} from '../src/domain'

// The pure rules (README.md, "Rules and thresholds"), including the boundary of every threshold.

const gpu = (catalogueId: string | null, family: string | null = null, orBetter = false) =>
  ({ partType: 'gpu', catalogueId, family, minAttr: null, orBetter }) as WantManagerCriterion
const ram = (sizeGb?: number, generation?: string) =>
  ({
    partType: 'ram',
    catalogueId: null,
    family: null,
    minAttr: { ...(sizeGb ? { sizeGb } : {}), ...(generation ? { generation } : {}) },
    orBetter: false,
  }) as WantManagerCriterion
const storage = (sizeGb: number) =>
  ({
    partType: 'storage',
    catalogueId: null,
    family: null,
    minAttr: { sizeGb },
    orBetter: false,
  }) as WantManagerCriterion

let seq = 0
const p = (partType: string, fields: Partial<PartInput> = {}): PartInput => ({
  seq: seq++,
  partType,
  catalogueId: null,
  attrs: {},
  inclusion: 'offered',
  rejected: false,
  source: 'description',
  extractor: 'rules',
  quote: partType,
  start: 0,
  end: 1,
  conflict: false,
  ...fields,
})

const listing = (fields: Partial<ListingInput> = {}): ListingInput => ({
  listingId: '00000000-0000-4000-8000-000000000001',
  evidenceHash: 'a'.repeat(64),
  cardHash: 'b'.repeat(64),
  kind: 'pc',
  priceMinor: 100_000,
  currency: 'GBP',
  deliveryTypes: ['IN_PERSON'],
  parts: [],
  assessment: { container: true, gpuState: 'not_stated', fullDescription: true, exclusions: [] },
  distanceKm: 10,
  sightings: [],
  ...fields,
})

const want = (fields: Partial<WantInput> = {}): WantInput => ({
  id: '00000000-0000-4000-8000-000000000002',
  centreId: 'chichester',
  point: { lat: 50.8, lng: -0.8 },
  radiusKm: 25,
  priceCapMinor: null,
  currency: 'GBP',
  deliveryMethods: ['collection'],
  criteria: [gpu('gpu:nvidia:rtx-5080')],
  ...fields,
})

const status = (r: { status: string; reason: string }) => `${r.status}:${r.reason}`

describe('catalogue fit', () => {
  it('a variant of the wanted item fits; a mobile chip never fits a desktop want', () => {
    expect(
      catalogueFit(
        gpu('gpu:nvidia:rtx-5080'),
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080:16gb' }),
      ),
    ).toBe('yes')
    expect(
      catalogueFit(
        gpu('gpu:nvidia:rtx-5080'),
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080:mobile' }),
      ),
    ).toBe('no')
    expect(
      catalogueFit(
        gpu('gpu:nvidia:rtx-5080'),
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080-super' }),
      ),
    ).toBe('no')
  })

  it('a family want fits the model segment, and a longer name that ends with it', () => {
    expect(
      catalogueFit(gpu(null, 'RTX 5080'), p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080:16gb' })),
    ).toBe('yes')
    expect(
      catalogueFit(gpu(null, 'GeForce RTX 5080'), p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080' })),
    ).toBe('yes')
    expect(
      catalogueFit(gpu(null, 'RTX 3090'), p('gpu', { catalogueId: 'gpu:nvidia:rtx-3090-ti' })),
    ).toBe('no')
  })

  it('"or better" over another card is unknown (no catalogue ranking), never a "no"', () => {
    expect(
      catalogueFit(
        gpu('gpu:nvidia:rtx-4080', null, true),
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080' }),
      ),
    ).toBe('maybe')
  })

  it('an unresolved row: a brand only is unknown; candidates holding the want are partial', () => {
    expect(catalogueFit(gpu('gpu:nvidia:rtx-5080'), p('gpu', { source: 'photo' }))).toBe('maybe')
    expect(
      catalogueFit(
        gpu('gpu:nvidia:rtx-5080:16gb'),
        p('gpu', { attrs: { candidates: ['gpu:nvidia:rtx-5080:16gb'] } }),
      ),
    ).toBe('partial')
    expect(catalogueFit(gpu(null, 'RTX 5080'), p('gpu', { attrs: { family: 'RTX 5080' } }))).toBe(
      'yes',
    )
    expect(catalogueFit(gpu(null, 'RTX 5080'), p('gpu', { attrs: { family: 'RTX 4070' } }))).toBe(
      'no',
    )
  })
})

describe('part criteria', () => {
  const c = gpu('gpu:nvidia:rtx-5080')

  it('only included parts count: a mention or a rejected row is silence', () => {
    const l = listing({
      parts: [
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080', inclusion: 'mention' }),
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080', rejected: true }),
      ],
    })
    expect(status(partCriterion(c, 0, l))).toBe('not_stated:not_named')
  })

  it('a named part matches with its quote and source', () => {
    const r = partCriterion(
      c,
      0,
      listing({
        parts: [p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080:16gb', quote: 'RTX 5080' })],
      }),
    )
    expect(status(r)).toBe('match:named')
    expect(r.evidence[0]).toMatchObject({
      quote: 'RTX 5080',
      source: 'description',
      extractor: 'rules',
    })
  })

  it('another card over a full description is no_match; over partial text it is not stated', () => {
    const other = [p('gpu', { catalogueId: 'gpu:nvidia:rtx-3060' })]
    expect(status(partCriterion(c, 0, listing({ parts: other })))).toBe('no_match:different')
    const partial = listing({
      parts: other,
      assessment: { container: true, gpuState: 'named', fullDescription: false, exclusions: [] },
    })
    expect(status(partCriterion(c, 0, partial))).toBe('not_stated:partial_text')
    expect(status(partCriterion(c, 0, listing({ parts: other, assessment: null })))).toBe(
      'not_stated:partial_text',
    )
  })

  it('an unstated GPU is never no_match, whatever the coverage', () => {
    for (const fullDescription of [true, false]) {
      const l = listing({
        assessment: { container: true, gpuState: 'not_stated', fullDescription, exclusions: [] },
      })
      expect(partCriterion(c, 0, l).status).toBe('not_stated')
    }
  })

  it('"no GPU" or integrated graphics over full text is no_match; in photos only is unknown', () => {
    const none = listing({
      assessment: { container: true, gpuState: 'none', fullDescription: true, exclusions: [] },
    })
    expect(status(partCriterion(c, 0, none))).toBe('no_match:excluded')
    const integrated = listing({
      assessment: {
        container: true,
        gpuState: 'integrated',
        fullDescription: false,
        exclusions: [],
      },
    })
    expect(status(partCriterion(c, 0, integrated))).toBe('not_stated:partial_text')
    const photos = listing({
      assessment: { container: true, gpuState: 'in_photos', fullDescription: true, exclusions: [] },
    })
    expect(status(partCriterion(c, 0, photos))).toBe('not_stated:in_photos')
  })

  it('a conflict beside the wanted card is partly named, never a match', () => {
    const l = listing({
      parts: [
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080', conflict: true }),
        p('gpu', { catalogueId: 'gpu:nvidia:rtx-4070', conflict: true }),
      ],
    })
    expect(status(partCriterion(c, 0, l))).toBe('not_stated:partly_named')
  })

  it('RAM: size at the boundary matches; smaller is no_match; an unstated generation is partly named', () => {
    const l = listing({ parts: [p('ram_size', { attrs: { gb: 32, ddr: 5 } })] })
    expect(status(partCriterion(ram(32, 'ddr5'), 0, l))).toBe('match:named')
    expect(status(partCriterion(ram(33), 0, l))).toBe('no_match:different')
    expect(status(partCriterion(ram(32, 'ddr4'), 0, l))).toBe('no_match:different')
    const noGen = listing({ parts: [p('ram_size', { attrs: { gb: 32 } })] })
    expect(status(partCriterion(ram(16, 'ddr5'), 0, noGen))).toBe('not_stated:partly_named')
    expect(status(partCriterion(ram(16), 0, listing()))).toBe('not_stated:not_named')
  })

  it('storage: one drive of the size matches; drives that only add up to it are unknown', () => {
    const one = listing({ parts: [p('storage_size', { attrs: { amount: 1, unit: 'tb' } })] })
    expect(status(partCriterion(storage(1000), 0, one))).toBe('match:named')
    const two = listing({
      parts: [
        p('storage_size', { attrs: { amount: 500, unit: 'gb' } }),
        p('storage_size', { attrs: { amount: 500, unit: 'gb' } }),
      ],
    })
    expect(status(partCriterion(storage(1000), 0, two))).toBe('not_stated:ambiguous')
    expect(status(partCriterion(storage(1001), 0, two))).toBe('no_match:different')
  })
})

describe('price', () => {
  it('compares only asks in the want currency; the cap itself matches', () => {
    expect(priceCriterion(want(), listing())).toBeNull()
    expect(status(priceCriterion(want({ priceCapMinor: 100_000 }), listing()) as never)).toBe(
      'match:within_cap',
    )
    expect(status(priceCriterion(want({ priceCapMinor: 99_999 }), listing()) as never)).toBe(
      'no_match:over_cap',
    )
    const eur = want({ priceCapMinor: 1_000_000, currency: 'EUR' })
    expect(status(priceCriterion(eur, listing()) as never)).toBe('not_stated:other_currency')
    expect(
      status(priceCriterion(want({ priceCapMinor: 1 }), listing({ priceMinor: null })) as never),
    ).toBe('not_stated:no_price')
  })
})

describe('distance', () => {
  const rules = SPEC_MATCH_RULES
  it('the radius itself matches; beyond is no_match; an unknown point is not stated', () => {
    expect(status(distanceCriterion(want(), listing({ distanceKm: 25 }), rules) as never)).toBe(
      'match:within_radius',
    )
    expect(status(distanceCriterion(want(), listing({ distanceKm: 26 }), rules) as never)).toBe(
      'no_match:beyond_radius',
    )
    expect(status(distanceCriterion(want(), listing({ distanceKm: null }), rules) as never)).toBe(
      'not_stated:unknown_point',
    )
  })

  it('a posting listing matches a want that accepts posting, at any distance', () => {
    const w = want({ deliveryMethods: ['collection', 'posted'] })
    const far = listing({ distanceKm: 400, deliveryTypes: ['SHIPPING'] })
    expect(status(distanceCriterion(w, far, rules) as never)).toBe('match:posted')
    const unknown = listing({ distanceKm: 400, deliveryTypes: [] })
    expect(status(distanceCriterion(w, unknown, rules) as never)).toBe('not_stated:beyond_radius')
    const postedOnly = want({ deliveryMethods: ['posted'] })
    expect(status(distanceCriterion(postedOnly, listing(), rules) as never)).toBe(
      'no_match:not_posted',
    )
  })

  it('no point on a search: no distance criterion', () => {
    expect(distanceCriterion(want({ point: null }), listing(), rules)).toBeNull()
  })
})

describe('verdict and relevance', () => {
  it('any no_match wins; all match is match; otherwise not stated', () => {
    const m = { status: 'match' } as never
    const n = { status: 'no_match' } as never
    const s = { status: 'not_stated' } as never
    expect(verdictOf([m, m])).toBe('match')
    expect(verdictOf([m, s])).toBe('not_stated')
    expect(verdictOf([m, s, n])).toBe('no_match')
  })

  it('a pair with no part named is not relevant; a container sits inside a PC', () => {
    const e = evaluate(want(), listing(), SPEC_MATCH_RULES)
    expect(e.relevant).toBe(false)
    const named = listing({ parts: [p('gpu', { catalogueId: 'gpu:nvidia:rtx-5080' })] })
    const hit = evaluate(want(), named, SPEC_MATCH_RULES)
    expect(hit).toMatchObject({ relevant: true, verdict: 'match', insidePc: true })
    expect(
      evaluate(want(), { ...named, assessment: null, kind: 'not_a_pc' }, SPEC_MATCH_RULES).insidePc,
    ).toBe(false)
  })

  it('origin: own search when a search for the want centre and part found it', () => {
    const w = want({ criteria: [gpu(null, 'RTX 5080')] })
    const own = listing({ sightings: [{ terms: ['rtx 5080'], centreIds: ['chichester'] }] })
    expect(originOf(w, own)).toBe('own_search')
    const other = listing({ sightings: [{ terms: ['rtx 5080'], centreIds: ['london'] }] })
    expect(originOf(w, other)).toBe('other_search')
  })

  it('the rule version names the generation and a digest of the rules', () => {
    expect(ruleVersion(SPEC_MATCH_RULES)).toMatch(/^s1\.[0-9a-f]{8}$/)
  })
})

describe('sorts', () => {
  const f = (listingId: string, fields: Partial<SortFacts>): SortFacts => ({
    listingId,
    distanceKm: null,
    priceMinor: null,
    listedAt: null,
    position: null,
    ...fields,
  })
  const order = (sort: Parameters<typeof compareBy>[0], rows: SortFacts[]) =>
    [...rows].sort(compareBy(sort)).map((r) => r.listingId)

  it('unknowns sort last; ties go newest first', () => {
    const rows = [
      f('a', { distanceKm: null, priceMinor: 300, listedAt: '2026-09-20T00:00:00.000Z' }),
      f('b', { distanceKm: 5, priceMinor: null, listedAt: '2026-09-22T00:00:00.000Z' }),
      f('c', { distanceKm: 2, priceMinor: 100, listedAt: '2026-09-21T00:00:00.000Z' }),
    ]
    expect(order('nearest', rows)).toEqual(['c', 'b', 'a'])
    expect(order('cheapest', rows)).toEqual(['c', 'a', 'b'])
    expect(order('newest', rows)).toEqual(['b', 'c', 'a'])
  })

  it('a hidden position (null) sorts with the unknowns, so the order never leaks it', () => {
    const rows = [
      f('hidden', { position: null, listedAt: '2026-09-25T00:00:00.000Z' }),
      f('shown', { position: 3, listedAt: '2026-09-20T00:00:00.000Z' }),
    ]
    expect(order('best_position', rows)).toEqual(['shown', 'hidden'])
  })
})
