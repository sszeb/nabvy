import { describe, expect, it } from 'vitest'
import {
  balanceLowKey,
  compareSpendOrder,
  crossesLowBalance,
  type LiveBucket,
  planCharge,
} from '../src/domain'

const t = (iso: string) => new Date(iso)
const bucket = (b: Partial<LiveBucket> & Pick<LiveBucket, 'id' | 'kind'>): LiveBucket => ({
  remaining: 10,
  expiresAt: null,
  createdAt: t('2026-09-01T00:00:00Z'),
  ...b,
})

describe('spend order', () => {
  it('allowance, then taste and referral, then top-ups', () => {
    const order = [
      bucket({ id: 't', kind: 'topup' }),
      bucket({ id: 'r', kind: 'referral' }),
      bucket({ id: 'a', kind: 'allowance', expiresAt: t('2026-10-01T00:00:00Z') }),
    ].sort(compareSpendOrder)
    expect(order.map((b) => b.id)).toEqual(['a', 'r', 't'])
  })

  it('inside a rank: earliest expiry first, never-expiring last, then oldest, then id', () => {
    const order = [
      bucket({ id: 'ref-old', kind: 'referral', createdAt: t('2026-01-01T00:00:00Z') }),
      bucket({ id: 'taste', kind: 'taste', expiresAt: t('2026-09-27T00:00:00Z') }),
      bucket({ id: 'ref-b', kind: 'referral', createdAt: t('2026-02-01T00:00:00Z') }),
      bucket({ id: 'ref-a', kind: 'referral', createdAt: t('2026-02-01T00:00:00Z') }),
    ].sort(compareSpendOrder)
    expect(order.map((b) => b.id)).toEqual(['taste', 'ref-old', 'ref-a', 'ref-b'])
  })

  it('top-ups oldest first', () => {
    const order = [
      bucket({ id: 'new', kind: 'topup', createdAt: t('2026-09-20T00:00:00Z') }),
      bucket({ id: 'old', kind: 'topup', createdAt: t('2026-03-01T00:00:00Z') }),
    ].sort(compareSpendOrder)
    expect(order.map((b) => b.id)).toEqual(['old', 'new'])
  })
})

describe('planCharge', () => {
  const buckets = [
    bucket({ id: 'top', kind: 'topup', remaining: 5 }),
    bucket({ id: 'all', kind: 'allowance', remaining: 3, expiresAt: t('2026-10-01T00:00:00Z') }),
  ]

  it('takes in spend order across buckets', () => {
    expect(planCharge(buckets, 4)).toEqual({
      ok: true,
      available: 8,
      allocations: [
        { bucketId: 'all', credits: -3 },
        { bucketId: 'top', credits: -1 },
      ],
    })
  })

  it('exactly the balance succeeds; one more is refused whole', () => {
    expect(planCharge(buckets, 8).ok).toBe(true)
    expect(planCharge(buckets, 9)).toEqual({ ok: false, available: 8 })
  })

  it('refuses at zero, and zero credits always succeeds with no allocations', () => {
    expect(planCharge([], 1)).toEqual({ ok: false, available: 0 })
    expect(planCharge([], 0)).toEqual({ ok: true, available: 0, allocations: [] })
  })

  it('skips empty buckets and refuses non-integers and negatives', () => {
    expect(planCharge([bucket({ id: 'e', kind: 'topup', remaining: 0 })], 1).ok).toBe(false)
    expect(() => planCharge(buckets, 1.5)).toThrow(RangeError)
    expect(() => planCharge(buckets, -1)).toThrow(RangeError)
  })
})

describe('low balance', () => {
  it('fires only on the crossing, at the line boundary', () => {
    expect(crossesLowBalance(50, 49, 50)).toBe(true)
    expect(crossesLowBalance(51, 50, 50)).toBe(false)
    expect(crossesLowBalance(49, 10, 50)).toBe(false)
    expect(crossesLowBalance(100, 0, 50)).toBe(true)
  })

  it('keys one event per crossing charge', () => {
    expect(balanceLowKey('u', 'e')).toBe('usage-ledger.balance-low:u@e')
  })
})
