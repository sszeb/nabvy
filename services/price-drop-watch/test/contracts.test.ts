import {
  events,
  module,
  PriceDropWatchDrop,
  PriceDropWatchDroppedEvent,
  PriceDropWatchHistoryPoint,
  PriceDropWatchWatch,
} from '@nabvy/contracts/modules/price-drop-watch'
import { describe, expect, it } from 'vitest'

describe('price-drop-watch contracts', () => {
  it('declares its module name', () => {
    expect(module).toBe('price-drop-watch')
    expect(events.module).toBe('price-drop-watch')
  })

  it('parses a valid dropped event payload', () => {
    expect(() =>
      PriceDropWatchDroppedEvent.parse({ watchIds: [crypto.randomUUID()] }),
    ).not.toThrow()
  })

  it('refuses an empty or oversized watchIds array', () => {
    expect(() => PriceDropWatchDroppedEvent.parse({ watchIds: [] })).toThrow()
    expect(() =>
      PriceDropWatchDroppedEvent.parse({
        watchIds: Array.from({ length: 501 }, () => crypto.randomUUID()),
      }),
    ).toThrow()
  })

  it('parses a v_price_drop_watch_watches row', () => {
    expect(() =>
      PriceDropWatchWatch.parse({
        id: crypto.randomUUID(),
        listingId: crypto.randomUUID(),
        active: true,
        createdAt: '2026-09-24T00:00:00.000Z',
      }),
    ).not.toThrow()
  })

  it('parses a v_price_drop_watch_history row', () => {
    expect(() =>
      PriceDropWatchHistoryPoint.parse({
        listingId: crypto.randomUUID(),
        observedAt: '2026-09-24T00:00:00.000Z',
        priceMinor: 15000,
        currency: 'GBP',
      }),
    ).not.toThrow()
  })

  it('refuses a history row carrying an extra column (never select *)', () => {
    expect(() =>
      PriceDropWatchHistoryPoint.parse({
        listingId: crypto.randomUUID(),
        observedAt: '2026-09-24T00:00:00.000Z',
        priceMinor: 15000,
        currency: 'GBP',
        sellerId: 'nope',
      }),
    ).toThrow()
  })

  it('parses a drop row, including a null relistGroupId', () => {
    expect(() =>
      PriceDropWatchDrop.parse({
        id: crypto.randomUUID(),
        watchId: crypto.randomUUID(),
        fromMinor: 20000,
        toMinor: 15000,
        currency: 'GBP',
        observedAt: '2026-09-24T00:00:00.000Z',
        cardHash: 'a'.repeat(64),
        relistGroupId: null,
      }),
    ).not.toThrow()
  })

  it('refuses a card hash that is not a sha256', () => {
    expect(() =>
      PriceDropWatchDrop.parse({
        id: crypto.randomUUID(),
        watchId: crypto.randomUUID(),
        fromMinor: 20000,
        toMinor: 15000,
        currency: 'GBP',
        observedAt: '2026-09-24T00:00:00.000Z',
        cardHash: 'not-a-hash',
        relistGroupId: null,
      }),
    ).toThrow()
  })
})
