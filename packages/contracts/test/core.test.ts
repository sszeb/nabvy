import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  addMoney,
  batchKey,
  CurrencyMismatchError,
  compareMoney,
  createEvent,
  defineEvents,
  latestVersion,
  listingKey,
  type Money,
  money,
  moneyIn,
  parseEvent,
  safeParseEvent,
  secondsBetween,
  stamp,
  subtractMoney,
  taskIdFor,
  Uuid,
  UuidV7,
  uuidv7,
} from '../src/index'

describe('uuidv7', () => {
  it('is a valid version 7 UUID that sorts by time', () => {
    const a = uuidv7(1_790_000_000_000)
    const b = uuidv7(1_790_000_000_001)
    expect(UuidV7.safeParse(a).success).toBe(true)
    expect(a < b).toBe(true)
    expect(a.slice(0, 13)).toBe('01a0c450-6c00')
  })

  it('accepts any UUID version as a row ID but only v7 as UuidV7', () => {
    const v4 = '9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e'
    expect(Uuid.safeParse(v4).success).toBe(true)
    expect(UuidV7.safeParse(v4).success).toBe(false)
  })
})

describe('money', () => {
  it('adds, subtracts and compares within one currency', () => {
    const a = money(1500, 'GBP')
    expect(addMoney(a, money(250, 'GBP'))).toEqual({ amountMinor: 1750, currency: 'GBP' })
    expect(subtractMoney(a, money(2000, 'GBP')).amountMinor).toBe(-500)
    expect(compareMoney(a, money(1500, 'GBP'))).toBe(0)
  })

  it('never mixes GBP and EUR', () => {
    const gbp: Money = money(100, 'GBP')
    const eur: Money = money(100, 'EUR')
    expect(() => addMoney(gbp, eur)).toThrow(CurrencyMismatchError)
    expect(() => compareMoney(gbp, eur)).toThrow(CurrencyMismatchError)
    expect(moneyIn('EUR').safeParse(gbp).success).toBe(false)
  })

  it('refuses amounts that are not safe integers of minor units', () => {
    expect(() => money(1.5, 'GBP')).toThrow(RangeError)
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'GBP')).toThrow(RangeError)
  })
})

describe('T-timestamps', () => {
  it('keeps the earliest stamp when a handler runs twice', () => {
    const first = stamp({}, 't1Fetched', '2026-09-24T01:00:00.000Z')
    expect(stamp(first, 't1Fetched', '2026-09-24T01:05:00.000Z')).toBe(first)
    expect(stamp(first, 't1Fetched', '2026-09-24T00:59:00.000Z').t1Fetched).toBe(
      '2026-09-24T00:59:00.000Z',
    )
  })

  it('measures freshness T6 − T0 in seconds', () => {
    const stamps = { t0Listed: '2026-09-24T01:00:00.000Z', t6Delivered: '2026-09-24T01:02:30.000Z' }
    expect(secondsBetween(stamps, 't0Listed', 't6Delivered')).toBe(150)
    expect(secondsBetween(stamps, 't1Fetched', 't6Delivered')).toBeUndefined()
  })
})

describe('events', () => {
  const ListingIds = z.array(Uuid).min(1).max(500)
  const events = defineEvents('listing-registry', {
    'listing.new': {
      1: z.object({ listingIds: ListingIds }),
      2: z.object({ listingIds: ListingIds, crawlRunId: Uuid.optional() }),
    },
    'listing.gone': { 1: z.object({ listingIds: ListingIds }) },
  })
  const id = '01926f3a-8b7c-7d4e-9f00-000000000001'

  it('creates an envelope with a v7 ID and parses it back to the typed union', () => {
    const event = createEvent(events, 'listing.new', 2, { listingIds: [id] }, { key: 'k1' })
    expect(UuidV7.safeParse(event.id).success).toBe(true)
    const parsed = parseEvent(events, JSON.parse(JSON.stringify(event)))
    expect(parsed).toEqual(event)
    if (parsed.type === 'listing.new' && parsed.v === 2) {
      expect(parsed.payload.crawlRunId).toBeUndefined()
    }
  })

  it('still parses older versions while consumers migrate', () => {
    const old = createEvent(events, 'listing.new', 1, { listingIds: [id] }, { key: 'k' })
    expect(parseEvent(events, old).v).toBe(1)
    expect(latestVersion(events, 'listing.new')).toBe(2)
  })

  it('rejects unknown types and versions and bad payloads', () => {
    const base = createEvent(events, 'listing.gone', 1, { listingIds: [id] }, { key: 'k' })
    expect(safeParseEvent(events, { ...base, v: 9 }).success).toBe(false)
    expect(safeParseEvent(events, { ...base, type: 'hunt.changed' }).success).toBe(false)
    expect(safeParseEvent(events, { ...base, payload: { listingIds: [] } }).success).toBe(false)
    expect(() =>
      createEvent(events, 'listing.gone', 1, { listingIds: ['nope'] }, { key: 'k' }),
    ).toThrow()
  })

  it('refuses payloads that are not thin', () => {
    expect(() =>
      defineEvents('listing-registry', {
        'listing.new': { 1: z.object({ listing: z.object({ title: z.string() }) }) },
      }),
    ).toThrow(/not thin/)
    expect(() =>
      defineEvents('listing-registry', {
        'listing.new': { 1: z.object({ rows: z.array(z.object({ id: Uuid })) }) },
      }),
    ).toThrow(/not thin/)
    expect(() =>
      defineEvents('listing-registry', {
        'listing.new': { 1: z.object({ meta: z.record(z.string(), z.string()) }) },
      }),
    ).toThrow(/not thin/)
  })

  it('refuses malformed names and versions', () => {
    expect(() => defineEvents('Listing_Registry', {})).toThrow()
    expect(() => defineEvents('listing-registry', { ListingNew: { 1: z.object({}) } })).toThrow(
      /noun\.verb/,
    )
    expect(() => defineEvents('listing-registry', { 'listing.new': { 0: z.object({}) } })).toThrow(
      /version/,
    )
  })

  it('maps an event type to its Trigger.dev task ID', () => {
    expect(taskIdFor('listing.new')).toBe('listing-new')
  })
})

describe('idempotency keys', () => {
  it('builds the listing key from source, ID and content hash', () => {
    expect(listingKey({ source: 'facebook', sourceListingId: '181', contentHash: 'ab' })).toBe(
      'facebook:181:ab',
    )
  })

  it('gives the same batch key for the same items in any order', async () => {
    const a = await batchKey('listing.new', ['facebook:1:a', 'facebook:2:b'])
    const b = await batchKey('listing.new', ['facebook:2:b', 'facebook:1:a', 'facebook:1:a'])
    expect(a).toBe(b)
    expect(a).toMatch(/^listing\.new:[0-9a-f]{64}$/)
    expect(await batchKey('listing.changed', ['facebook:1:a', 'facebook:2:b'])).not.toBe(a)
  })
})
