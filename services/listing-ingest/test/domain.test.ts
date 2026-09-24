import { describe, expect, it } from 'vitest'
import {
  askOf,
  availabilityOf,
  cardHash,
  centreOfUrl,
  chunk,
  cityPageOf,
  detailUpdate,
  isChange,
  normaliseTitle,
  observationsOf,
  primaryPhotoOf,
  readCard,
} from '../src/domain'
import { loadRun, RECORDED } from './support/database'

const recorded = loadRun(RECORDED)
const AT = '2026-09-24T01:40:43.415Z'
const base = {
  title: 'Gaming PC',
  priceMinor: 20000,
  currency: 'GBP',
  availability: 'live' as const,
  primaryPhotoId: '1',
}

describe('askOf', () => {
  it('prices only a fixed GBP or EUR ask', () => {
    expect(askOf({ kind: 'fixed', currency: 'GBP', amountMinor: 0 })).toEqual({
      priceMinor: 0,
      currency: 'GBP',
    })
    expect(askOf({ kind: 'fixed', currency: 'EUR', amountMinor: 100 })?.currency).toBe('EUR')
    expect(askOf({ kind: 'fixed', currency: 'USD', amountMinor: 100 })).toBeNull()
    expect(askOf({ kind: 'free', currency: 'GBP', amountMinor: 0 })).toBeNull()
    expect(askOf({ kind: 'fixed', currency: 'GBP', amountMinor: -1 })).toBeNull()
    expect(askOf({ kind: 'fixed', currency: 'GBP', amountMinor: 1.5 })).toBeNull()
    expect(askOf(null)).toBeNull()
  })
})

describe('availabilityOf', () => {
  it('folds the flags, sold first', () => {
    expect(availabilityOf({ live: true, sold: true })).toBe('sold')
    expect(availabilityOf({ live: true, pending: true })).toBe('pending')
    expect(availabilityOf({ live: false, hidden: true })).toBe('hidden')
    expect(availabilityOf({ live: true })).toBe('live')
    expect(availabilityOf({})).toBe('unknown')
    expect(availabilityOf(undefined)).toBe('unknown')
  })
})

describe('city page', () => {
  it('reads sourceFields.search first, then locationDetails', () => {
    const cityPage = (id: string) => ({ reverse_geocode: { city_page: { id } } })
    expect(
      cityPageOf({
        sourceFields: { search: { location: cityPage('1') } },
        locationDetails: cityPage('2'),
      }),
    ).toBe('1')
    expect(cityPageOf({ locationDetails: cityPage('2') })).toBe('2')
    expect(cityPageOf({ locationDetails: { latitude: 51.3, longitude: -0.2 } })).toBeNull()
  })

  it('reads the recorded rows from sourceFields, not locationDetails', () => {
    const row = recorded.dataset[0] as Record<string, unknown>
    expect(row.locationDetails).not.toHaveProperty('reverse_geocode')
    expect(cityPageOf(row)).toBe('112249962124525')
  })

  it('parses the centre from a search URL', () => {
    expect(
      centreOfUrl('https://www.facebook.com/marketplace/115935195086622/search/?query=gaming+pc'),
    ).toBe('115935195086622')
    expect(centreOfUrl('https://www.facebook.com/marketplace/item/1/')).toBeNull()
    expect(centreOfUrl(null)).toBeNull()
  })
})

describe('primary photo', () => {
  it('prefers the search card photo, then the first photo', () => {
    expect(
      primaryPhotoOf({ sourceFields: { search: { primary_listing_photo: { id: '9' } } } }),
    ).toBe('9')
    expect(primaryPhotoOf({ photos: [{ id: '7' }, { id: '8' }] })).toBe('7')
    expect(primaryPhotoOf({ photos: null })).toBeNull()
  })
})

describe('cardHash', () => {
  it('ignores case and whitespace in the title', () => {
    expect(normaliseTitle('  Gaming\n  PC ')).toBe('gaming pc')
    expect(cardHash({ ...base, title: 'GAMING   pc' })).toBe(cardHash(base))
  })

  it('changes with price, currency, availability and primary photo', () => {
    const h = cardHash(base)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(cardHash({ ...base, priceMinor: 19999 })).not.toBe(h)
    expect(cardHash({ ...base, currency: 'EUR' })).not.toBe(h)
    expect(cardHash({ ...base, availability: 'sold' })).not.toBe(h)
    expect(cardHash({ ...base, primaryPhotoId: '2' })).not.toBe(h)
    expect(cardHash({ ...base, priceMinor: null })).not.toBe(h)
  })
})

describe('readCard', () => {
  it('skips the sourceOutcome row and rows without a listing ID', () => {
    const outcome = recorded.dataset.find((row) => row.recordType === 'sourceOutcome')
    expect(readCard(outcome, 20, AT)).toBeNull()
    expect(readCard({ recordType: 'listing' }, 0, AT)).toBeNull()
    expect(
      readCard({ recordType: 'listing', listingId: Number.MAX_SAFE_INTEGER + 2 }, 0, AT),
    ).toBeNull()
  })

  it('keeps a 17-digit listing ID as text', () => {
    const cards = recorded.dataset.map((row, seq) => readCard(row, seq, AT))
    expect(cards.filter(Boolean)).toHaveLength(20)
    expect(cards.map((card) => card?.sourceListingId)).toContain('28242423458759790')
  })

  it('compares money on amountMinor and currency, not the raw text', () => {
    const row = recorded.dataset[0] as Record<string, unknown>
    const money = row.money as Record<string, unknown>
    const reworded = { ...row, money: { ...money, rawAmount: '£200', display: '£200.00' } }
    expect(readCard(reworded, 0, AT)?.cardHash).toBe(readCard(row, 0, AT)?.cardHash)
  })

  it('keeps the displayed previous price as a raw fact', () => {
    const row = recorded.dataset.find((r) => r.listingId === '1072745435569624')
    const card = readCard(row, 4, AT)
    expect(card?.displayedPreviousMinor).toBe(49900)
    expect(card?.priceMinor).toBe(45000)
  })

  it('leaves the price unset for a non-fixed kind and keeps the kind', () => {
    const row = recorded.dataset[0] as Record<string, unknown>
    const card = readCard(
      { ...row, money: { kind: 'free', currency: 'GBP', amountMinor: 0 } },
      0,
      AT,
    )
    expect(card?.priceMinor).toBeNull()
    expect(card?.currency).toBeNull()
    expect(card?.moneyKind).toBe('free')
  })

  it('falls back to the run collection time', () => {
    const row = { ...(recorded.dataset[0] as Record<string, unknown>), collectedAt: undefined }
    expect(readCard(row, 0, '2026-01-01T00:00:00.000Z')?.seenAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('observationsOf', () => {
  const cards = recorded.dataset.flatMap((row, seq) => readCard(row, seq, AT) ?? [])

  it('ranks search cards by row order and keeps one per listing', () => {
    const doubled = [...cards, { ...cards[0], seq: 99 }] as typeof cards
    const out = observationsOf(doubled, 'search')
    expect(out).toHaveLength(20)
    expect(out.map((o) => o.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(out[0]).toMatchObject({ kind: 'search', term: 'gaming pc', centreId: '115935195086622' })
  })

  it('gives detail observations no term, centre or rank', () => {
    const [first] = observationsOf(cards, 'details')
    expect(first).toMatchObject({ kind: 'detail', term: null, centreId: null, rank: null })
  })
})

describe('changes', () => {
  const [card] = recorded.dataset.flatMap((row, seq) => readCard(row, seq, AT) ?? [])
  if (!card) throw new Error('no card')
  const stored = {
    cardHash: card.cardHash,
    title: card.title,
    primaryPhotoId: card.primaryPhotoId,
    lastSeenAt: AT,
  }

  it('is a change only when newer and different', () => {
    expect(isChange(card, stored)).toBe(false)
    const cheaper = { ...card, cardHash: 'x', seenAt: '2026-09-25T00:00:00.000Z' }
    expect(isChange(cheaper, stored)).toBe(true)
    expect(isChange({ ...cheaper, seenAt: '2026-09-23T00:00:00.000Z' }, stored)).toBe(false)
  })

  it('a detail keeps the card title and photo', () => {
    const detail = detailUpdate({ ...card, title: 'other', primaryPhotoId: '5' }, stored)
    expect(detail.title).toBe(card.title)
    expect(detail.cardHash).toBe(card.cardHash)
  })

  it('chunks at the event batch size', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(chunk([], 500)).toEqual([])
  })
})
