// Database access to the attribution schema only. Other modules read v_attributions; this file is
// for services/attribution's own use.
import type { Queryable } from '@nabvy/db'
import {
  partnerEvents,
  referralCodes,
  referrals,
  utmAttributions,
  vAttributions,
} from '@nabvy/db/schema/attribution'
import { and, eq, inArray, sql } from 'drizzle-orm'

export type UtmAttributionRow = typeof utmAttributions.$inferSelect
export type NewUtmAttribution = typeof utmAttributions.$inferInsert
export type ReferralCodeRow = typeof referralCodes.$inferSelect
export type ReferralRow = typeof referrals.$inferSelect
export type NewReferral = typeof referrals.$inferInsert
export type PartnerEventRow = typeof partnerEvents.$inferSelect
export type NewPartnerEvent = typeof partnerEvents.$inferInsert
export type AttributionRow = typeof vAttributions.$inferSelect

/**
 * Serialises this user's attribution writes until the transaction ends, the same pattern as
 * usage-ledger's `lockUser`: an advisory lock needs no UPDATE grant, which nabvy_app lacks (moot
 * here since only the pipeline writes, but keeps the two referral-credit grants — referrer and
 * referred — from racing each other across two calls).
 */
export async function lockUser(q: Queryable, userId: string): Promise<void> {
  await q.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`attribution:${userId}`}, 0))`,
  )
}

export async function selectUtmAttribution(
  q: Queryable,
  userId: string,
): Promise<UtmAttributionRow | undefined> {
  const [row] = await q.select().from(utmAttributions).where(eq(utmAttributions.userId, userId))
  return row
}

/** `undefined` when the user is already captured (idempotency: the caller compares details). */
export async function insertUtmAttribution(
  q: Queryable,
  row: NewUtmAttribution,
): Promise<UtmAttributionRow | undefined> {
  const [inserted] = await q.insert(utmAttributions).values(row).onConflictDoNothing().returning()
  return inserted
}

export async function setAffiliatePartnerId(
  q: Queryable,
  userId: string,
  affiliatePartnerId: string,
): Promise<void> {
  await q
    .update(utmAttributions)
    .set({ affiliatePartnerId })
    .where(eq(utmAttributions.userId, userId))
}

export async function selectReferralCode(
  q: Queryable,
  userId: string,
): Promise<ReferralCodeRow | undefined> {
  const [row] = await q.select().from(referralCodes).where(eq(referralCodes.userId, userId))
  return row
}

/** The user a code belongs to, or `undefined` for an unknown code. */
export async function selectReferralCodeOwner(
  q: Queryable,
  code: string,
): Promise<string | undefined> {
  const [row] = await q
    .select({ userId: referralCodes.userId })
    .from(referralCodes)
    .where(eq(referralCodes.code, code))
  return row?.userId
}

/** `undefined` on a code collision (unique on `code`): the caller generates another and retries. */
export async function insertReferralCode(
  q: Queryable,
  userId: string,
  code: string,
): Promise<ReferralCodeRow | undefined> {
  const [inserted] = await q
    .insert(referralCodes)
    .values({ userId, code })
    .onConflictDoNothing()
    .returning()
  return inserted
}

export async function selectReferralByReferred(
  q: Queryable,
  referredUserId: string,
): Promise<ReferralRow | undefined> {
  const [row] = await q.select().from(referrals).where(eq(referrals.referredUserId, referredUserId))
  return row
}

/** `undefined` when this referred user already has a pairing (idempotency: one referrer each). */
export async function insertReferral(
  q: Queryable,
  row: NewReferral,
): Promise<ReferralRow | undefined> {
  const [inserted] = await q.insert(referrals).values(row).onConflictDoNothing().returning()
  return inserted
}

/** Sets `creditedAt` once; a second call on an already-credited pair changes nothing. */
export async function markReferralCredited(
  q: Queryable,
  referralId: string,
  creditedAt: Date,
): Promise<void> {
  await q
    .update(referrals)
    .set({ creditedAt })
    .where(and(eq(referrals.id, referralId), sql`${referrals.creditedAt} is null`))
}

export async function selectPartnerEvent(
  q: Queryable,
  userId: string,
  kind: string,
  refId: string,
): Promise<PartnerEventRow | undefined> {
  const [row] = await q
    .select()
    .from(partnerEvents)
    .where(
      and(
        eq(partnerEvents.userId, userId),
        eq(partnerEvents.kind, kind),
        eq(partnerEvents.refId, refId),
      ),
    )
  return row
}

/** `undefined` when this (user, kind, refId) was already recorded: idempotency. */
export async function insertPartnerEvent(
  q: Queryable,
  row: NewPartnerEvent,
): Promise<PartnerEventRow | undefined> {
  const [inserted] = await q.insert(partnerEvents).values(row).onConflictDoNothing().returning()
  return inserted
}

export async function selectAttribution(
  q: Queryable,
  userId: string,
): Promise<AttributionRow | undefined> {
  const [row] = await q.select().from(vAttributions).where(eq(vAttributions.userId, userId))
  return row
}

/** Erases every row this module holds for these users (account deletion, rule 12). */
export async function purgeUsers(q: Queryable, userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0
  const ids = [...userIds]
  await q.delete(partnerEvents).where(inArray(partnerEvents.userId, ids))
  await q.delete(referrals).where(inArray(referrals.referrerUserId, ids))
  await q.delete(referrals).where(inArray(referrals.referredUserId, ids))
  await q.delete(referralCodes).where(inArray(referralCodes.userId, ids))
  const deleted = await q
    .delete(utmAttributions)
    .where(inArray(utmAttributions.userId, ids))
    .returning({ userId: utmAttributions.userId })
  return deleted.length
}
