import { describe, expect, it } from 'vitest'
import { type Candidate, categoryAllows, chunk, classify, selectBatch } from '../src/domain'

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  source: 'facebook',
  sourceListingId: '1000000000000001',
  cardHash: 'a'.repeat(64),
  cityPageId: 'city-1',
  categoryId: 'electronics-1',
  deliveryTypes: ['IN_PERSON'],
  ...overrides,
})

const IN_AREA = new Map([['city-1', { centreId: 'centre-1', inArea: true }]])
const OUT_OF_AREA = new Map([['city-1', { centreId: 'centre-1', inArea: false }]])
const CATEGORY_IDS = new Set(['electronics-1', 'container-1'])
const SHIPPING_TYPES = new Set(['SHIPPING'])

describe('categoryAllows', () => {
  it('allows a known in-category ID', () => {
    expect(categoryAllows('electronics-1', CATEGORY_IDS)).toBe(true)
  })
  it('allows an unknown (null) category — Facebook categories are unreliable', () => {
    expect(categoryAllows(null, CATEGORY_IDS)).toBe(true)
  })
  it('refuses a known category outside the allowlist', () => {
    expect(categoryAllows('furniture-9', CATEGORY_IDS)).toBe(false)
  })
})

describe('classify', () => {
  it('a bare title (any title) in area is selected as in_area', () => {
    const result = classify(candidate(), IN_AREA, new Set(), CATEGORY_IDS, SHIPPING_TYPES)
    expect(result).toEqual({
      source: 'facebook',
      sourceListingId: '1000000000000001',
      cardHash: 'a'.repeat(64),
      reason: 'in_area',
    })
  })

  it('out of area and not shipped is not selected', () => {
    const result = classify(candidate(), OUT_OF_AREA, new Set(), CATEGORY_IDS, SHIPPING_TYPES)
    expect(result).toBeNull()
  })

  it('unknown category (null) is selected out of a known-excluded set', () => {
    const result = classify(
      candidate({ categoryId: null }),
      IN_AREA,
      new Set(),
      CATEGORY_IDS,
      SHIPPING_TYPES,
    )
    expect(result?.reason).toBe('in_area')
  })

  it('a known non-electronics category is refused even in area', () => {
    const result = classify(
      candidate({ categoryId: 'furniture-9' }),
      IN_AREA,
      new Set(),
      CATEGORY_IDS,
      SHIPPING_TYPES,
    )
    expect(result).toBeNull()
  })

  it('out of area but shipping, with an active want at that centre accepting delivery, is shipped', () => {
    const result = classify(
      candidate({ deliveryTypes: ['SHIPPING'] }),
      OUT_OF_AREA,
      new Set(['centre-1']),
      CATEGORY_IDS,
      SHIPPING_TYPES,
    )
    expect(result).toEqual({
      source: 'facebook',
      sourceListingId: '1000000000000001',
      cardHash: 'a'.repeat(64),
      reason: 'shipped',
    })
  })

  it('offers shipping but no want at that centre accepts delivery is not selected', () => {
    const result = classify(
      candidate({ deliveryTypes: ['SHIPPING'] }),
      OUT_OF_AREA,
      new Set(),
      CATEGORY_IDS,
      SHIPPING_TYPES,
    )
    expect(result).toBeNull()
  })

  it('a want accepts delivery at a different centre than the listing is not selected', () => {
    const result = classify(
      candidate({ deliveryTypes: ['SHIPPING'] }),
      OUT_OF_AREA,
      new Set(['some-other-centre']),
      CATEGORY_IDS,
      SHIPPING_TYPES,
    )
    expect(result).toBeNull()
  })

  it('a city page with no area fact at all (unknown, e.g. city-pages off) is not selected', () => {
    const result = classify(candidate(), new Map(), new Set(), CATEGORY_IDS, SHIPPING_TYPES)
    expect(result).toBeNull()
  })

  it('a listing with no city page (null) is not selected via in_area', () => {
    const result = classify(
      candidate({ cityPageId: null }),
      IN_AREA,
      new Set(),
      CATEGORY_IDS,
      SHIPPING_TYPES,
    )
    expect(result).toBeNull()
  })
})

describe('selectBatch', () => {
  it('drops candidates that are not selected and keeps the rest', () => {
    const result = selectBatch(
      [candidate(), candidate({ sourceListingId: '2', categoryId: 'furniture-9' })],
      IN_AREA,
      new Set(),
      CATEGORY_IDS,
      SHIPPING_TYPES,
    )
    expect(result.map((r) => r.sourceListingId)).toEqual(['1000000000000001'])
  })
})

describe('chunk', () => {
  it('splits into batches of at most size, including a boundary-sized last batch', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([1, 2], 2)).toEqual([[1, 2]])
    expect(chunk([], 2)).toEqual([])
  })
})
