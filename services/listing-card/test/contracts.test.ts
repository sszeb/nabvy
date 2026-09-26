import { events, ListingCard, module } from '@nabvy/contracts/modules/listing-card'
import { describe, expect, it } from 'vitest'

describe('listing-card contracts', () => {
  it('declares its name', () => {
    expect(module).toBe('listing-card')
    expect(events.module).toBe('listing-card')
  })

  it('publishes no events (module card, "Outputs: its view")', () => {
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it('parses a full card row', () => {
    expect(() =>
      ListingCard.parse({
        listingId: '01920000-0000-7000-8000-00000000000a',
        link: 'https://www.facebook.com/marketplace/item/1000000000000001/',
        title: 'Gaming PC',
        priceMinor: 20000,
        currency: 'GBP',
        listedAt: '2026-09-25T00:00:00.000Z',
        townLabel: 'Chichester',
        condition: 'used_good',
        availability: 'live',
        descriptionStatus: 'full_verified',
        possiblyOutdated: false,
      }),
    ).not.toThrow()
  })

  it('parses a card with no detail fetch yet: null condition and description status', () => {
    expect(() =>
      ListingCard.parse({
        listingId: '01920000-0000-7000-8000-00000000000a',
        link: 'https://www.facebook.com/marketplace/item/1000000000000001/',
        title: 'Gaming PC',
        priceMinor: 20000,
        currency: 'GBP',
        listedAt: null,
        townLabel: null,
        condition: null,
        availability: 'live',
        descriptionStatus: null,
        possiblyOutdated: false,
      }),
    ).not.toThrow()
  })

  it('refuses a seller field or a coordinate: they are not in the schema at all', () => {
    const parsed = ListingCard.parse({
      listingId: '01920000-0000-7000-8000-00000000000a',
      link: null,
      title: null,
      priceMinor: null,
      currency: null,
      listedAt: null,
      townLabel: null,
      condition: null,
      availability: 'unknown',
      descriptionStatus: null,
      possiblyOutdated: false,
    })
    expect(parsed).not.toHaveProperty('sellerId')
    expect(parsed).not.toHaveProperty('lat')
    expect(parsed).not.toHaveProperty('lng')
  })

  it('refuses an unknown property (strict)', () => {
    expect(() =>
      ListingCard.parse({
        listingId: '01920000-0000-7000-8000-00000000000a',
        link: null,
        title: null,
        priceMinor: null,
        currency: null,
        listedAt: null,
        townLabel: null,
        condition: null,
        availability: 'unknown',
        descriptionStatus: null,
        possiblyOutdated: false,
        sellerId: 'nope',
      }),
    ).toThrow()
  })
})
