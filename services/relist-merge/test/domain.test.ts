import { describe, expect, it } from 'vitest'
import {
  blocked,
  gapMs,
  groupsVersion,
  type ListingFacts,
  onePerGroup,
  plan,
  type SellerKey,
  sharesKey,
  withinReach,
} from '../src/domain'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-09-20T00:00:00Z')

const listing = (
  id: string,
  fromDay: number,
  toDay = fromDay,
  cityPageId: string | null = 'epsom',
): ListingFacts => ({
  listingId: id,
  source: 'facebook',
  cityPageId,
  fromMs: T0 + fromDay * DAY,
  toMs: T0 + toDay * DAY,
  firstFetchedAt: new Date(T0 + fromDay * DAY).toISOString(),
})

const numeric = (key: string, runId = 'r1'): SellerKey => ({ key, keyType: 'numeric', runId })
const token = (key: string, runId: string): SellerKey => ({ key, keyType: 'token', runId })

describe('reach', () => {
  it('measures the gap between sighting intervals; overlap is 0', () => {
    expect(gapMs(listing('a', 0, 2), listing('b', 5))).toBe(3 * DAY)
    expect(gapMs(listing('b', 5), listing('a', 0, 2))).toBe(3 * DAY)
    expect(gapMs(listing('a', 0, 5), listing('b', 3, 4))).toBe(0)
  })

  it('merges at exactly 7 days and not a moment later', () => {
    expect(withinReach(listing('a', 0), listing('b', 7), 7)).toBe(true)
    const late = { ...listing('b', 7), fromMs: T0 + 7 * DAY + 1 }
    expect(withinReach(listing('a', 0), late, 7)).toBe(false)
  })

  it('needs the same source and the same known city page, and never pairs a listing with itself', () => {
    expect(withinReach(listing('a', 0), listing('b', 1, 1, 'brighton'), 7)).toBe(false)
    expect(withinReach(listing('a', 0, 0, null), listing('b', 1, 1, null), 7)).toBe(false)
    expect(withinReach(listing('a', 0), { ...listing('b', 1), source: 'gumtree' }, 7)).toBe(false)
    expect(withinReach(listing('a', 0), listing('a', 0), 7)).toBe(false)
  })
})

describe('seller keys', () => {
  it('different numeric IDs block', () => {
    expect(blocked([numeric('1', 'r1')], [numeric('2', 'r2')])).toBe(true)
  })
  it('different tokens block only within one run', () => {
    expect(blocked([token('a', 'r1')], [token('b', 'r1')])).toBe(true)
    expect(blocked([token('a', 'r1')], [token('b', 'r2')])).toBe(false)
    expect(blocked([numeric('1', 'r1')], [token('b', 'r2')])).toBe(false)
  })
  it('a shared key or an unknown key never blocks', () => {
    expect(blocked([numeric('1'), token('a', 'r1')], [numeric('1'), token('b', 'r1')])).toBe(false)
    expect(blocked([], [numeric('2')])).toBe(false)
    expect(sharesKey([token('a', 'r1')], [token('a', 'r1')])).toBe(true)
  })
})

describe('plan', () => {
  const base = {
    groupOf: new Map<string, string>(),
    membersOf: new Map<string, string[]>(),
    keysOf: new Map<string, SellerKey[]>(),
    windowDays: 7,
  }
  const facts = (...ls: ListingFacts[]) => new Map(ls.map((l) => [l.listingId, l]))

  it('opens a group on the earlier listing, whichever arrives', () => {
    const steps = plan({
      ...base,
      arriving: ['b'],
      facts: facts(listing('a', 0), listing('b', 3)),
      evidence: [{ listingId: 'b', otherListingId: 'a', basis: 'description' }],
    })
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      kind: 'open',
      origin: { listingId: 'a' },
      member: { listingId: 'b' },
    })
  })

  it('plans a pair in one batch once', () => {
    const steps = plan({
      ...base,
      arriving: ['b', 'a'],
      facts: facts(listing('a', 0), listing('b', 3)),
      evidence: [{ listingId: 'a', otherListingId: 'b', basis: 'description' }],
    })
    expect(steps).toHaveLength(1)
  })

  it('joins an existing group, and never moves a member', () => {
    const steps = plan({
      ...base,
      arriving: ['c', 'b'],
      groupOf: new Map([
        ['a', 'g1'],
        ['b', 'g1'],
      ]),
      membersOf: new Map([['g1', ['a', 'b']]]),
      facts: facts(listing('a', 0), listing('b', 3), listing('c', 5)),
      evidence: [
        { listingId: 'c', otherListingId: 'b', basis: 'description' },
        { listingId: 'b', otherListingId: 'c', basis: 'description' },
      ],
    })
    expect(steps).toEqual([
      expect.objectContaining({ kind: 'join', group: { groupId: 'g1' }, matched: 'b' }),
    ])
  })

  it('is blocked by any member of the group it would join', () => {
    const steps = plan({
      ...base,
      arriving: ['c'],
      groupOf: new Map([
        ['a', 'g1'],
        ['b', 'g1'],
      ]),
      membersOf: new Map([['g1', ['a', 'b']]]),
      keysOf: new Map([
        ['a', [numeric('1')]],
        ['c', [numeric('2')]],
      ]),
      facts: facts(listing('a', 0), listing('b', 3), listing('c', 5)),
      evidence: [{ listingId: 'c', otherListingId: 'b', basis: 'description' }],
    })
    expect(steps).toEqual([])
  })

  it('prefers description over photo, then a shared key, then the smaller gap', () => {
    const run = (keysOf: Map<string, SellerKey[]>, basisA: 'description' | 'photo') =>
      plan({
        ...base,
        keysOf,
        arriving: ['c'],
        facts: facts(listing('a', 0), listing('b', 10), listing('c', 5)),
        evidence: [
          { listingId: 'c', otherListingId: 'a', basis: basisA },
          { listingId: 'c', otherListingId: 'b', basis: 'description' },
        ],
      })[0]
    // a and c are 5 days apart; b and c are 5 days apart; the lower ID wins a full tie.
    expect(run(new Map(), 'description')).toMatchObject({ origin: { listingId: 'a' } })
    expect(run(new Map(), 'photo')).toMatchObject({ member: { listingId: 'b' } })
    const shared = new Map([
      ['b', [token('t', 'r1')]],
      ['c', [token('t', 'r1')]],
    ])
    expect(run(shared, 'description')).toMatchObject({ member: { listingId: 'b' } })
  })

  it('leaves out evidence beyond reach or about unknown listings', () => {
    expect(
      plan({
        ...base,
        arriving: ['b', 'x'],
        facts: facts(listing('a', 0), listing('b', 9)),
        evidence: [
          { listingId: 'b', otherListingId: 'a', basis: 'description' },
          { listingId: 'x', otherListingId: 'a', basis: 'description' },
        ],
      }),
    ).toEqual([])
  })
})

describe('versions and counting once', () => {
  it('the version depends on members, not their order', () => {
    const v1 = groupsVersion(new Map([['g', ['a', 'b']]]))
    expect(groupsVersion(new Map([['g', ['b', 'a']]]))).toBe(v1)
    expect(groupsVersion(new Map([['g', ['a', 'b', 'c']]]))).not.toBe(v1)
  })

  it('PC 4070: collapsing one relist pair moves the median from £1,050 to £1,000 (n 26 to 25)', () => {
    // Synthetic index case (fb-scrap-engine/docs/design/SELLER_DATA.md:66-68): 26 asks whose
    // median is £1,050; one pair above the median is the same item relisted.
    const asks = [
      ...[700, 750, 800, 820, 850, 870, 880, 900, 920, 940, 950, 980, 1000],
      ...[1100, 1120, 1150, 1180, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1600, 1600],
    ].map((pounds, i) => ({ listingId: `l${String(i).padStart(2, '0')}`, fromMs: i, pounds }))
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b)
      const mid = Math.floor(s.length / 2)
      return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
    }
    expect(asks).toHaveLength(26)
    expect(median(asks.map((a) => a.pounds))).toBe(1050)
    const groupOf = new Map([
      ['l24', 'g'],
      ['l25', 'g'],
    ])
    const once = onePerGroup(asks, groupOf)
    expect(once).toHaveLength(25)
    expect(once.map((a) => a.listingId)).toContain('l25')
    expect(median(once.map((a) => a.pounds))).toBe(1000)
  })
})
