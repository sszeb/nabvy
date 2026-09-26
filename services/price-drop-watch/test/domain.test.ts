import { describe, expect, it } from 'vitest'
import {
  chunk,
  type DropCandidate,
  dedupeAnnouncements,
  eventKey,
  isDrop,
  triggerId,
} from '../src/domain'

const candidate = (over: Partial<DropCandidate>): DropCandidate => ({
  watchId: 'w1',
  listingId: 'l1',
  watchCreatedAt: '2026-09-24T00:00:00Z',
  fromMinor: 20000,
  toMinor: 15000,
  currency: 'GBP',
  observedAt: '2026-09-25T00:00:00Z',
  cardHash: 'a'.repeat(64),
  relistGroupId: null,
  ...over,
})

describe('isDrop', () => {
  it('is true only for a strictly lower price', () => {
    expect(isDrop(20000, 15000)).toBe(true)
    expect(isDrop(20000, 20000)).toBe(false)
    expect(isDrop(20000, 25000)).toBe(false)
    expect(isDrop(0, 0)).toBe(false)
  })
})

describe('dedupeAnnouncements', () => {
  it('announces every candidate with no relist group', () => {
    const decisions = dedupeAnnouncements([
      candidate({ watchId: 'a', relistGroupId: null }),
      candidate({ watchId: 'b', relistGroupId: null }),
    ])
    expect(decisions.every((d) => d.announce)).toBe(true)
  })

  it('announces only the earliest-created watch in a group landing on the same new price', () => {
    const decisions = dedupeAnnouncements([
      candidate({ watchId: 'later', watchCreatedAt: '2026-09-24T12:00:00Z', relistGroupId: 'g1' }),
      candidate({
        watchId: 'earlier',
        watchCreatedAt: '2026-09-24T00:00:00Z',
        relistGroupId: 'g1',
      }),
    ])
    const byWatch = new Map(decisions.map((d) => [d.watchId, d]))
    expect(byWatch.get('earlier')?.announce).toBe(true)
    expect(byWatch.get('later')?.announce).toBe(false)
    // every candidate is still written, dedup only decides the announcement
    expect(decisions).toHaveLength(2)
  })

  it('ties on watchCreatedAt break on watchId', () => {
    const decisions = dedupeAnnouncements([
      candidate({ watchId: 'zzz', watchCreatedAt: '2026-09-24T00:00:00Z', relistGroupId: 'g1' }),
      candidate({ watchId: 'aaa', watchCreatedAt: '2026-09-24T00:00:00Z', relistGroupId: 'g1' }),
    ])
    const byWatch = new Map(decisions.map((d) => [d.watchId, d]))
    expect(byWatch.get('aaa')?.announce).toBe(true)
    expect(byWatch.get('zzz')?.announce).toBe(false)
  })

  it('never dedupes across different groups or different landing prices', () => {
    const decisions = dedupeAnnouncements([
      candidate({ watchId: 'a', relistGroupId: 'g1', toMinor: 15000 }),
      candidate({ watchId: 'b', relistGroupId: 'g2', toMinor: 15000 }),
      candidate({ watchId: 'c', relistGroupId: 'g1', toMinor: 16000 }),
    ])
    expect(decisions.every((d) => d.announce)).toBe(true)
  })
})

describe('chunk', () => {
  it('splits into groups of at most size, in order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns nothing for an empty array', () => {
    expect(chunk([], 2)).toEqual([])
  })
})

describe('triggerId / eventKey', () => {
  it('keeps a short trigger as-is', () => {
    expect(triggerId('listing-ingest.card-changed:1:0')).toBe('listing-ingest.card-changed:1:0')
  })

  it('hashes a trigger over 400 characters', () => {
    const long = 'x'.repeat(401)
    expect(triggerId(long)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('builds the event key from the trigger and batch index', () => {
    expect(eventKey('t1', 0)).toBe('price-drop-watch.dropped:t1:0')
    expect(eventKey('t1', 2)).toBe('price-drop-watch.dropped:t1:2')
  })
})
