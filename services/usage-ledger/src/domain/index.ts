// Pure rules of the usage ledger: spend order, allocation and the low-balance crossing. No I/O.
import type { UsageLedgerGrantKind } from '@nabvy/contracts/modules/usage-ledger'
import { USAGE_LEDGER_BUCKET_RANK } from '@nabvy/contracts/modules/usage-ledger'

export interface LiveBucket {
  id: string
  kind: UsageLedgerGrantKind
  remaining: number
  expiresAt: Date | null
  createdAt: Date
}

export interface Allocation {
  bucketId: string
  /** Negative: credit taken from the bucket. */
  credits: number
}

/**
 * Spend order (docs/design/pricing-model.md, "Order"): allowance, then taste and referral credit,
 * then top-ups; inside a rank the bucket that expires first, never-expiring last, then the oldest,
 * then by id so the order is total.
 */
export function compareSpendOrder(a: LiveBucket, b: LiveBucket): number {
  const rank = USAGE_LEDGER_BUCKET_RANK[a.kind] - USAGE_LEDGER_BUCKET_RANK[b.kind]
  if (rank !== 0) return rank
  const ea = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY
  const eb = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY
  if (ea !== eb) return ea < eb ? -1 : 1
  const ca = a.createdAt.getTime()
  const cb = b.createdAt.getTime()
  if (ca !== cb) return ca < cb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export type AllocationPlan =
  | { ok: true; allocations: Allocation[]; available: number }
  | { ok: false; available: number }

/**
 * Takes `credits` from `buckets` in spend order. Refuses (never partially charges) when the live
 * buckets hold less: refusal at zero. Zero credits allocates nothing and always succeeds.
 */
export function planCharge(buckets: readonly LiveBucket[], credits: number): AllocationPlan {
  if (!Number.isInteger(credits) || credits < 0) throw new RangeError(`credits ${credits}`)
  const ordered = [...buckets].filter((b) => b.remaining > 0).sort(compareSpendOrder)
  const available = ordered.reduce((sum, b) => sum + b.remaining, 0)
  if (credits > available) return { ok: false, available }
  const allocations: Allocation[] = []
  let left = credits
  for (const bucket of ordered) {
    if (left === 0) break
    const take = Math.min(left, bucket.remaining)
    allocations.push({ bucketId: bucket.id, credits: -take })
    left -= take
  }
  return { ok: true, allocations, available }
}

/** True when a charge moves the balance from at or above `line` to below it. */
export function crossesLowBalance(before: number, after: number, line: number): boolean {
  return before >= line && after < line
}

/** The idempotency key of a `usage-ledger.balance-low` event: one per crossing charge. */
export function balanceLowKey(userId: string, entryId: string): string {
  return `usage-ledger.balance-low:${userId}@${entryId}`
}

/** The ref of the expiry entry that closes a bucket. */
export const expiryRef = (bucketId: string): string => `bucket:${bucketId}`
