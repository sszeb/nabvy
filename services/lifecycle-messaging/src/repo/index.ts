// Database access. Own table from '@nabvy/db/schema/lifecycle-messaging'; other modules' data is
// read only through their own v_ views (packages/db/README.md), imported the same way
// services/detail-evidence reads apify-gateway's and listing-ingest's views.
import type { LifecycleMessagingProgramme } from '@nabvy/contracts/modules/lifecycle-messaging'
import type { ProductEventsName } from '@nabvy/contracts/modules/product-events'
import type { Queryable } from '@nabvy/db'
import { vProfiles } from '@nabvy/db/schema/account'
import { programmeRuns } from '@nabvy/db/schema/lifecycle-messaging'
import { vEvents } from '@nabvy/db/schema/product-events'
import { and, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm'

export interface TriggerOccurrence {
  userId: string
  triggeredAt: Date
}

/** The latest occurrence per user of `event` since `since`, most recent first, capped at `limit`. */
export async function selectRecentTriggerOccurrences(
  q: Queryable,
  event: ProductEventsName,
  since: Date,
  limit: number,
): Promise<TriggerOccurrence[]> {
  const rows = await q
    .select({
      userId: vEvents.userId,
      triggeredAt: sql<Date>`max(${vEvents.at})`.as('triggered_at'),
    })
    .from(vEvents)
    .where(and(eq(vEvents.event, event), gte(vEvents.at, since)))
    .groupBy(vEvents.userId)
    .orderBy(desc(sql`max(${vEvents.at})`))
    .limit(limit)
  return rows.map((r) => ({ userId: r.userId, triggeredAt: new Date(r.triggeredAt) }))
}

/**
 * The earliest occurrence per user of any of `events` strictly after `since` (`since` itself, the
 * trigger's own moment, never counts as its own exit). Pass an empty `events` array to match any
 * event at all (the "any activity" exit `re-engagement` uses, README.md "Decisions") -- exclusive
 * for exactly that reason: `re-engagement`'s anchor is itself an `alert_opened`/`scan_started` row
 * at `since`, which an inclusive bound would immediately match as its own exit.
 */
export async function selectEarliestEventAfter(
  q: Queryable,
  userIds: readonly string[],
  events: readonly ProductEventsName[],
  since: Date,
): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map()
  const rows = await q
    .select({ userId: vEvents.userId, at: sql<Date>`min(${vEvents.at})`.as('earliest_at') })
    .from(vEvents)
    .where(
      and(
        inArray(vEvents.userId, [...userIds]),
        gt(vEvents.at, since),
        events.length > 0 ? inArray(vEvents.event, [...events]) : undefined,
      ),
    )
    .groupBy(vEvents.userId)
  return new Map(rows.map((r) => [r.userId, new Date(r.at)]))
}

/**
 * The last occurrence per user of any of `events`, oldest first, capped at `limit`: candidates
 * for `re-engagement`'s inactivity check (README.md, "Decisions"). A user who has never had one
 * of these events is not a candidate -- there is nothing to measure inactivity against.
 */
export async function selectLastActivityCandidates(
  q: Queryable,
  events: readonly ProductEventsName[],
  limit: number,
): Promise<TriggerOccurrence[]> {
  const rows = await q
    .select({
      userId: vEvents.userId,
      triggeredAt: sql<Date>`max(${vEvents.at})`.as('last_activity_at'),
    })
    .from(vEvents)
    .where(inArray(vEvents.event, [...events]))
    .groupBy(vEvents.userId)
    .orderBy(sql`max(${vEvents.at}) asc`)
    .limit(limit)
  return rows.map((r) => ({ userId: r.userId, triggeredAt: new Date(r.triggeredAt) }))
}

/** The properties of one specific event row, for personalising a step's copy with real numbers. */
export async function selectEventProperties(
  q: Queryable,
  userId: string,
  event: ProductEventsName,
  at: Date,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await q
    .select({ properties: vEvents.properties })
    .from(vEvents)
    .where(and(eq(vEvents.userId, userId), eq(vEvents.event, event), eq(vEvents.at, at)))
    .limit(1)
  return row?.properties as Record<string, unknown> | undefined
}

/** How many times each of `events` happened for `userId` since `since`. */
export async function selectEventCounts(
  q: Queryable,
  userId: string,
  events: readonly ProductEventsName[],
  since: Date,
): Promise<Record<string, number>> {
  if (events.length === 0) return {}
  const rows = await q
    .select({ event: vEvents.event, n: sql<number>`count(*)::int` })
    .from(vEvents)
    .where(
      and(eq(vEvents.userId, userId), inArray(vEvents.event, [...events]), gte(vEvents.at, since)),
    )
    .groupBy(vEvents.event)
  return Object.fromEntries(rows.map((r) => [r.event, r.n]))
}

export async function selectDisplayNames(
  q: Queryable,
  userIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map()
  const rows = await q
    .select({ userId: vProfiles.userId, displayName: vProfiles.displayName })
    .from(vProfiles)
    .where(inArray(vProfiles.userId, [...userIds]))
  return new Map(rows.map((r) => [r.userId, r.displayName]))
}

/** Every `(step, triggeredAt)` already recorded for `programme`, keyed `step|triggeredAtIso`. */
export async function selectAlreadySent(
  q: Queryable,
  programme: LifecycleMessagingProgramme,
  userId: string,
): Promise<Set<string>> {
  const rows = await q
    .select({ step: programmeRuns.step, triggeredAt: programmeRuns.triggeredAt })
    .from(programmeRuns)
    .where(and(eq(programmeRuns.userId, userId), eq(programmeRuns.programme, programme)))
  return new Set(rows.map((r) => `${r.step}|${r.triggeredAt.toISOString()}`))
}

/** Every `(programme, step)` sent to any of `userIds` at or after `dayStart` (the daily cap). */
export async function selectRunsSince(
  q: Queryable,
  userIds: readonly string[],
  since: Date,
): Promise<Array<{ userId: string; programme: LifecycleMessagingProgramme; step: string }>> {
  if (userIds.length === 0) return []
  const rows = await q
    .select({
      userId: programmeRuns.userId,
      programme: programmeRuns.programme,
      step: programmeRuns.step,
    })
    .from(programmeRuns)
    .where(and(inArray(programmeRuns.userId, [...userIds]), gte(programmeRuns.at, since)))
  return rows.map((r) => ({
    userId: r.userId,
    programme: r.programme as LifecycleMessagingProgramme,
    step: r.step,
  }))
}

/** Records a send. Idempotent: a repeat for the same `(userId, programme, step, triggeredAt)` writes nothing. */
export async function insertRun(
  q: Queryable,
  row: {
    userId: string
    programme: LifecycleMessagingProgramme
    step: string
    triggeredAt: Date
    at: Date
  },
): Promise<void> {
  await q
    .insert(programmeRuns)
    .values(row)
    .onConflictDoNothing({
      target: [
        programmeRuns.userId,
        programmeRuns.programme,
        programmeRuns.step,
        programmeRuns.triggeredAt,
      ],
    })
}

/** Erases every row this module holds for the given user (rule 12: purge on `account.deleted`). */
export async function purgeUser(q: Queryable, userId: string): Promise<void> {
  await q.delete(programmeRuns).where(eq(programmeRuns.userId, userId))
}
