import { createHash } from 'node:crypto'
import { LISTING_SUPPRESSION_LOOKALIKE_DAYS } from '@nabvy/config/modules/listing-suppression'
import { describe, expect, it } from 'vitest'
import {
  buildEntries,
  chunk,
  eventKey,
  isActive,
  listingHash,
  lookalikeExpiry,
  uniqueListings,
} from '../src/domain'

const ROW0 = { source: 'facebook', sourceListingId: '1816901372840238' } as const
const NOW = new Date('2026-09-24T12:00:00.000Z')
const hex = (s: string) => createHash('sha256').update(s).digest('hex')

describe('listingHash', () => {
  it('is SHA-256 of source:sourceListingId, lowercase hex, never the ID', () => {
    const h = listingHash(ROW0.source, ROW0.sourceListingId)
    expect(h).toBe(hex('facebook:1816901372840238'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain(ROW0.sourceListingId)
  })
  it('depends on the source', () => {
    expect(listingHash('ebay', ROW0.sourceListingId)).not.toBe(
      listingHash('facebook', ROW0.sourceListingId),
    )
  })
})

describe('look-alike expiry', () => {
  it('is 90 days by config', () => {
    expect(LISTING_SUPPRESSION_LOOKALIKE_DAYS).toBe(90)
    expect(lookalikeExpiry(NOW, 90).toISOString()).toBe('2026-12-23T12:00:00.000Z')
  })
  it('matches until the last millisecond before expiry, not at it', () => {
    const expires = lookalikeExpiry(NOW, 90)
    expect(isActive(expires, new Date(expires.getTime() - 1))).toBe(true)
    expect(isActive(expires, expires)).toBe(false)
    expect(isActive(expires, new Date(NOW.getTime() + 89 * 86_400_000))).toBe(true)
    expect(isActive(expires, new Date(NOW.getTime() + 91 * 86_400_000))).toBe(false)
  })
  it('never ends for entries without expiry', () => {
    expect(isActive(null, new Date('2100-01-01T00:00:00Z'))).toBe(true)
  })
})

describe('buildEntries', () => {
  const card = hex('card')
  const description = hex('description')
  const key = hex('seller')
  const built = buildEntries({
    listings: [ROW0, ROW0, { source: 'facebook', sourceListingId: '1756692548940192' }],
    sellerKeys: [key, key],
    cardFingerprints: [card, card],
    descriptionFingerprints: [description],
    now: NOW,
    days: 90,
  })

  it('stores hashes only, one entry per kind and value', () => {
    expect(built.map((e) => `${e.kind}/${e.basis}`)).toEqual([
      'listing_hash/null',
      'listing_hash/null',
      'seller_key/null',
      'lookalike/card',
      'lookalike/description',
    ])
    for (const e of built) expect(e.value).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(built)).not.toContain('1816901372840238')
  })
  it('gives look-alikes, and only look-alikes, an expiry', () => {
    for (const e of built) {
      expect(e.expiresAt === null).toBe(e.kind !== 'lookalike')
    }
    expect(built.at(-1)?.expiresAt?.toISOString()).toBe('2026-12-23T12:00:00.000Z')
  })
  it('is stable, so a replay builds the same list', () => {
    expect(
      buildEntries({
        listings: [ROW0],
        sellerKeys: [],
        cardFingerprints: [],
        descriptionFingerprints: [],
        now: NOW,
        days: 90,
      }),
    ).toEqual([
      {
        kind: 'listing_hash',
        basis: null,
        value: listingHash('facebook', ROW0.sourceListingId),
        expiresAt: null,
      },
    ])
  })
})

describe('helpers', () => {
  it('uniqueListings keeps first-seen order', () => {
    const other = { source: 'facebook', sourceListingId: '1' } as const
    expect(uniqueListings([ROW0, other, ROW0])).toEqual([ROW0, other])
  })
  it('chunk splits at the batch size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 500)).toEqual([])
  })
  it('eventKey carries the request, its entry count and the batch', () => {
    expect(eventKey('01920000-0000-7000-8000-00000000a001', 3, 0)).toBe(
      'listing-suppression.changed:01920000-0000-7000-8000-00000000a001@3:0',
    )
  })
})
