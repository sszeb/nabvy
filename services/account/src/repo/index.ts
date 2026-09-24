// Database access to the account schema only. Other modules read v_profiles, v_channels and
// v_standing directly (packages/db/README.md); this file is for services/account's own use.
import type { Queryable } from '@nabvy/db'
import {
  apiKeys,
  deletionRequests,
  pushSubscriptions,
  standing,
  telegramLinkCodes,
  telegramLinks,
  userProfiles,
} from '@nabvy/db/schema/account'
import { and, count, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'

export type ProfileRow = typeof userProfiles.$inferSelect
export type TelegramLinkRow = typeof telegramLinks.$inferSelect
export type LinkCodeRow = typeof telegramLinkCodes.$inferSelect
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect
export type DeletionRequestRow = typeof deletionRequests.$inferSelect
export type StandingRow = typeof standing.$inferSelect

export async function selectProfile(q: Queryable, userId: string): Promise<ProfileRow | undefined> {
  const [row] = await q.select().from(userProfiles).where(eq(userProfiles.userId, userId))
  return row
}

export async function upsertProfile(
  q: Queryable,
  userId: string,
  patch: { displayName?: string | null; analyticsConsent?: boolean },
): Promise<ProfileRow> {
  const [row] = await q
    .insert(userProfiles)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userProfiles.userId, set: { ...patch, updatedAt: sql`now()` } })
    .returning()
  if (!row) throw new Error(`profile for ${userId} was not written`)
  return row
}

export async function insertLinkCode(
  q: Queryable,
  row: { codeHash: string; userId: string; sessionId: string; expiresAt: Date },
): Promise<void> {
  await q.insert(telegramLinkCodes).values(row)
}

/** Codes requested in the window, whatever their outcome (the short-window issuance limit). */
export async function countRecentLinkCodes(
  q: Queryable,
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await q
    .select({ n: count() })
    .from(telegramLinkCodes)
    .where(and(eq(telegramLinkCodes.userId, userId), gte(telegramLinkCodes.createdAt, since)))
  return row?.n ?? 0
}

/** Codes actually confirmed in the window (the plan's re-link cap; never counts a mere issuance). */
export async function countCompletedLinksInWindow(
  q: Queryable,
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await q
    .select({ n: count() })
    .from(telegramLinkCodes)
    .where(
      and(
        eq(telegramLinkCodes.userId, userId),
        isNotNull(telegramLinkCodes.usedAt),
        gte(telegramLinkCodes.usedAt, since),
      ),
    )
  return row?.n ?? 0
}

/** Locks the code row so two concurrent callback deliveries cannot both consume it. */
export async function selectLinkCodeForUpdate(
  q: Queryable,
  codeHash: string,
): Promise<LinkCodeRow | undefined> {
  const [row] = await q
    .select()
    .from(telegramLinkCodes)
    .where(eq(telegramLinkCodes.codeHash, codeHash))
    .for('update')
  return row
}

export async function consumeLinkCode(q: Queryable, codeHash: string, at: Date): Promise<void> {
  await q
    .update(telegramLinkCodes)
    .set({ usedAt: at })
    .where(eq(telegramLinkCodes.codeHash, codeHash))
}

export async function selectTelegramLink(
  q: Queryable,
  userId: string,
): Promise<TelegramLinkRow | undefined> {
  const [row] = await q
    .select()
    .from(telegramLinks)
    .where(and(eq(telegramLinks.userId, userId), isNull(telegramLinks.revokedAt)))
  return row
}

export async function upsertTelegramLink(
  q: Queryable,
  userId: string,
  chatId: string,
  at: Date,
): Promise<void> {
  await q
    .insert(telegramLinks)
    .values({ userId, chatId, linkedAt: at, revokedAt: null })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { chatId, linkedAt: at, revokedAt: null },
    })
}

export async function revokeTelegramLink(q: Queryable, userId: string): Promise<void> {
  await q
    .update(telegramLinks)
    .set({ revokedAt: sql`now()` })
    .where(eq(telegramLinks.userId, userId))
}

export async function insertPushSubscription(
  q: Queryable,
  row: {
    userId: string
    deviceId: string
    sessionId: string
    endpoint: string
    keys: { p256dh: string; auth: string }
  },
): Promise<void> {
  await q
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({
      target: [pushSubscriptions.userId, pushSubscriptions.deviceId],
      set: {
        sessionId: row.sessionId,
        endpoint: row.endpoint,
        keys: row.keys,
        revokedAt: null,
        pausedAt: null,
        updatedAt: sql`now()`,
      },
    })
}

export async function revokePushSubscription(
  q: Queryable,
  userId: string,
  deviceId: string,
): Promise<void> {
  await q
    .update(pushSubscriptions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.deviceId, deviceId)))
}

export async function selectActivePushSubscriptions(
  q: Queryable,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return q
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)))
}

export async function selectDeletionRequest(
  q: Queryable,
  userId: string,
): Promise<DeletionRequestRow | undefined> {
  const [row] = await q.select().from(deletionRequests).where(eq(deletionRequests.userId, userId))
  return row
}

/** User IDs whose deletion is due (rows past `purge_by`); the purge sweep's own batch, not one row. */
export async function selectDueDeletionUserIds(q: Queryable, now: Date): Promise<string[]> {
  const rows = await q
    .select({ userId: deletionRequests.userId })
    .from(deletionRequests)
    .where(lte(deletionRequests.purgeBy, now))
  return rows.map((row) => row.userId)
}

/**
 * Erases every row this module holds for the given users, including the `deletion_requests` rows
 * themselves: once gone, a repeat sweep finds nothing left to purge for them, which is this
 * function's idempotency (rule: "every event handler must be safe to run twice"). A no-op for an
 * empty batch.
 */
export async function purgeAccountRows(q: Queryable, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await q.delete(userProfiles).where(inArray(userProfiles.userId, userIds))
  await q.delete(telegramLinks).where(inArray(telegramLinks.userId, userIds))
  await q.delete(telegramLinkCodes).where(inArray(telegramLinkCodes.userId, userIds))
  await q.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds))
  await q.delete(apiKeys).where(inArray(apiKeys.userId, userIds))
  await q.delete(standing).where(inArray(standing.userId, userIds))
  await q.delete(deletionRequests).where(inArray(deletionRequests.userId, userIds))
}

export async function insertDeletionRequest(
  q: Queryable,
  userId: string,
  requestedAt: Date,
  purgeBy: Date,
): Promise<void> {
  await q.insert(deletionRequests).values({ userId, requestedAt, purgeBy })
}

export async function upsertStanding(
  q: Queryable,
  row: {
    userId: string
    status: 'active' | 'suspended' | 'banned'
    until: Date | null
    limits: Record<string, number> | null
    actionId: string
    at: Date
  },
): Promise<void> {
  await q
    .insert(standing)
    .values(row)
    .onConflictDoUpdate({
      target: standing.userId,
      set: {
        status: row.status,
        until: row.until,
        limits: row.limits,
        actionId: row.actionId,
        at: row.at,
      },
    })
}

export async function selectStanding(
  q: Queryable,
  userId: string,
): Promise<StandingRow | undefined> {
  const [row] = await q.select().from(standing).where(eq(standing.userId, userId))
  return row
}
