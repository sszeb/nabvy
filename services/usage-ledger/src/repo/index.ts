// Database access to the usage_ledger schema only. Other modules read v_balances; this file is
// for services/usage-ledger's own use. Times compare with the database's `now()`, the same clock
// the triggers use, never the caller's.
import type {
  UsageLedgerEntryKind,
  UsageLedgerGrantKind,
} from '@nabvy/contracts/modules/usage-ledger'
import type { Queryable } from '@nabvy/db'
import { allocations, buckets, entries } from '@nabvy/db/schema/usage-ledger'
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { Allocation, LiveBucket } from '../domain'

export type EntryRow = typeof entries.$inferSelect
export type NewEntry = typeof entries.$inferInsert

/**
 * Serialises this user's ledger writes until the transaction ends. The buckets' check constraint
 * already refuses an overdraw; the lock stops two concurrent charges from failing on it instead
 * of one waiting for the other. An advisory lock needs no UPDATE grant, which nabvy_app lacks.
 */
export async function lockUser(q: Queryable, userId: string): Promise<void> {
  await q.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`usage-ledger:${userId}`}, 0))`,
  )
}

export async function selectEntry(
  q: Queryable,
  userId: string,
  kind: UsageLedgerEntryKind,
  refId: string,
): Promise<EntryRow | undefined> {
  const [row] = await q
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), eq(entries.kind, kind), eq(entries.refId, refId)))
  return row
}

export async function selectReversalOf(
  q: Queryable,
  chargeId: string,
): Promise<EntryRow | undefined> {
  const [row] = await q.select().from(entries).where(eq(entries.reversesId, chargeId))
  return row
}

/** Inserts one entry; `undefined` when its (user, kind, refId) is already there. */
export async function insertEntry(q: Queryable, row: NewEntry): Promise<EntryRow | undefined> {
  const [inserted] = await q.insert(entries).values(row).onConflictDoNothing().returning()
  return inserted
}

export async function insertAllocations(
  q: Queryable,
  entryId: string,
  userId: string,
  rows: readonly Allocation[],
): Promise<void> {
  if (rows.length === 0) return
  await q
    .insert(allocations)
    .values(rows.map((a) => ({ entryId, bucketId: a.bucketId, userId, credits: a.credits })))
}

export async function allocationsOf(q: Queryable, entryId: string): Promise<Allocation[]> {
  return q
    .select({ bucketId: allocations.bucketId, credits: allocations.credits })
    .from(allocations)
    .where(eq(allocations.entryId, entryId))
}

const live = (userId: string) =>
  and(
    eq(buckets.userId, userId),
    gt(buckets.remaining, 0),
    or(isNull(buckets.expiresAt), gt(buckets.expiresAt, sql`now()`)),
  )

/** The user's buckets that still hold credit and have not expired, in spend order. */
export async function liveBuckets(q: Queryable, userId: string): Promise<LiveBucket[]> {
  const rows = await q
    .select({
      id: buckets.id,
      kind: buckets.kind,
      remaining: buckets.remaining,
      expiresAt: buckets.expiresAt,
      createdAt: buckets.createdAt,
    })
    .from(buckets)
    .where(live(userId))
    .orderBy(
      asc(buckets.rank),
      sql`${buckets.expiresAt} asc nulls last`,
      asc(buckets.createdAt),
      asc(buckets.id),
    )
  return rows.map((r) => ({ ...r, kind: r.kind as UsageLedgerGrantKind }))
}

/** Buckets past their expiry that still hold credit, oldest expiry first. */
export async function dueBuckets(
  q: Queryable,
  limit: number,
): Promise<{ id: string; userId: string; remaining: number }[]> {
  return q
    .select({ id: buckets.id, userId: buckets.userId, remaining: buckets.remaining })
    .from(buckets)
    .where(
      and(
        gt(buckets.remaining, 0),
        lte(buckets.expiresAt, sql`now()`),
        // Credit a reversal returned after the bucket was closed stays there, counted nowhere.
        sql`not exists (select 1 from ${entries} as e where e.user_id = ${buckets.userId}
          and e.kind = 'expiry' and e.ref_id = 'bucket:' || ${buckets.id}::text)`,
      ),
    )
    .orderBy(asc(buckets.expiresAt), asc(buckets.id))
    .limit(limit)
}

/** Erases every row this module holds for these users (account deletion). */
export async function purgeUsers(q: Queryable, userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0
  const ids = [...userIds]
  await q.delete(allocations).where(inArray(allocations.userId, ids))
  await q.delete(buckets).where(inArray(buckets.userId, ids))
  const deleted = await q
    .delete(entries)
    .where(inArray(entries.userId, ids))
    .returning({ id: entries.id })
  return deleted.length
}
