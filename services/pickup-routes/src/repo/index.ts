// Database access to the pickup_routes schema only. User paths run as nabvy_app inside withUser
// (packages/db/migrations/pickup-routes/*_access.sql): row-level security limits every statement
// to the caller's own rows. Pipeline paths (reminder scan, purges) run as nabvy_pipeline and touch
// only the plain columns that role is granted; a sealed blob is never selected there.
import type { Queryable } from '@nabvy/db'
import {
  pickupDays,
  pickupReminders,
  pickups,
  plannerDefaults,
  routePlans,
} from '@nabvy/db/schema/pickup-routes'
import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm'

export type PickupRow = typeof pickups.$inferSelect
export type PickupInsert = typeof pickups.$inferInsert
export type ReminderRow = typeof pickupReminders.$inferSelect
export type DayRow = typeof pickupDays.$inferSelect
export type DayInsert = typeof pickupDays.$inferInsert
export type PlanRow = typeof routePlans.$inferSelect
export type PlanInsert = typeof routePlans.$inferInsert
export type DefaultsRow = typeof plannerDefaults.$inferSelect

/** The columns the pipeline may read (never private_enc). */
const plainColumns = {
  id: pickups.id,
  userId: pickups.userId,
  label: pickups.label,
  day: pickups.day,
  windowKind: pickups.windowKind,
  windowStart: pickups.windowStart,
  windowEnd: pickups.windowEnd,
  status: pickups.status,
}
export type PickupPlainRow = {
  [K in keyof typeof plainColumns]: (typeof plainColumns)[K]['_']['data'] | null
} & { id: string; userId: string; label: string; day: string; windowKind: string; status: string }

export async function insertPickup(q: Queryable, row: PickupInsert): Promise<PickupRow> {
  const [inserted] = await q.insert(pickups).values(row).returning()
  if (!inserted) throw new Error('pickup insert returned no row')
  return inserted
}

export async function updatePickup(
  q: Queryable,
  userId: string,
  pickupId: string,
  patch: Partial<PickupInsert>,
): Promise<PickupRow | undefined> {
  const [row] = await q
    .update(pickups)
    .set(patch)
    .where(and(eq(pickups.userId, userId), eq(pickups.id, pickupId)))
    .returning()
  return row
}

export async function selectPickup(
  q: Queryable,
  userId: string,
  pickupId: string,
): Promise<PickupRow | undefined> {
  const [row] = await q
    .select()
    .from(pickups)
    .where(and(eq(pickups.userId, userId), eq(pickups.id, pickupId)))
  return row
}

export async function selectPickupsForDay(
  q: Queryable,
  userId: string,
  day: string,
): Promise<PickupRow[]> {
  return q
    .select()
    .from(pickups)
    .where(and(eq(pickups.userId, userId), eq(pickups.day, day)))
    .orderBy(asc(pickups.createdAt))
}

/** Plain columns only, so this also runs as nabvy_pipeline. */
export async function selectPickupPlain(
  q: Queryable,
  userId: string,
  pickupId: string,
): Promise<PickupPlainRow | undefined> {
  const [row] = await q
    .select(plainColumns)
    .from(pickups)
    .where(and(eq(pickups.userId, userId), eq(pickups.id, pickupId)))
  return row as PickupPlainRow | undefined
}

export async function selectPickupsPlainForDay(
  q: Queryable,
  userId: string,
  day: string,
): Promise<PickupPlainRow[]> {
  const rows = await q
    .select(plainColumns)
    .from(pickups)
    .where(and(eq(pickups.userId, userId), eq(pickups.day, day)))
  return rows as PickupPlainRow[]
}

/** Deletes the pickup (its reminders cascade) and returns its day, or undefined if not the user's. */
export async function deletePickup(
  q: Queryable,
  userId: string,
  pickupId: string,
): Promise<{ day: string } | undefined> {
  const [row] = await q
    .delete(pickups)
    .where(and(eq(pickups.userId, userId), eq(pickups.id, pickupId)))
    .returning({ day: pickups.day })
  return row
}

/** Deletes the user's day row for a date; its plans cascade (search-map-routes.md §7.9). */
export async function deleteDayForDate(q: Queryable, userId: string, day: string): Promise<void> {
  await q.delete(pickupDays).where(and(eq(pickupDays.userId, userId), eq(pickupDays.day, day)))
}

/**
 * Replaces a pickup's unsent reminders with the given set, idempotently on (pickup, kind, due):
 * an existing row with the same identity is kept (and stays sent if it was), the rest are
 * inserted, and unsent rows no longer wanted are removed.
 */
export async function replaceReminders(
  q: Queryable,
  userId: string,
  pickupId: string,
  wanted: readonly { kind: string; dueAt: Date }[],
): Promise<void> {
  const existing = await q
    .select({
      id: pickupReminders.id,
      kind: pickupReminders.kind,
      dueAt: pickupReminders.dueAt,
      sentAt: pickupReminders.sentAt,
    })
    .from(pickupReminders)
    .where(and(eq(pickupReminders.userId, userId), eq(pickupReminders.pickupId, pickupId)))
  const keyOf = (r: { kind: string; dueAt: Date }) => `${r.kind}@${r.dueAt.getTime()}`
  const wantedKeys = new Set(wanted.map(keyOf))
  const stale = existing
    .filter((r) => r.sentAt === null && !wantedKeys.has(keyOf(r)))
    .map((r) => r.id)
  if (stale.length > 0) await q.delete(pickupReminders).where(inArray(pickupReminders.id, stale))
  const have = new Set(existing.map(keyOf))
  const fresh = wanted.filter((w) => !have.has(keyOf(w)))
  if (fresh.length > 0) {
    await q
      .insert(pickupReminders)
      .values(fresh.map((w) => ({ userId, pickupId, kind: w.kind, dueAt: w.dueAt })))
      .onConflictDoNothing()
  }
}

export async function selectReminders(
  q: Queryable,
  userId: string,
  pickupId: string,
): Promise<ReminderRow[]> {
  return q
    .select()
    .from(pickupReminders)
    .where(and(eq(pickupReminders.userId, userId), eq(pickupReminders.pickupId, pickupId)))
    .orderBy(asc(pickupReminders.dueAt))
}

/** Unsent reminders due by `now`, oldest first, as the pipeline. */
export async function selectDueReminders(
  q: Queryable,
  now: Date,
  limit: number,
): Promise<ReminderRow[]> {
  return q
    .select()
    .from(pickupReminders)
    .where(and(isNull(pickupReminders.sentAt), lte(pickupReminders.dueAt, now)))
    .orderBy(asc(pickupReminders.dueAt))
    .limit(limit)
}

/** Marks reminders sent; a repeat is a no-op because only unsent rows are touched. */
export async function markRemindersSent(
  q: Queryable,
  ids: readonly string[],
  now: Date,
): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await q
    .update(pickupReminders)
    .set({ sentAt: now })
    .where(and(inArray(pickupReminders.id, [...ids]), isNull(pickupReminders.sentAt)))
    .returning({ id: pickupReminders.id })
  return rows.length
}

export async function upsertDay(q: Queryable, row: DayInsert): Promise<DayRow> {
  const [day] = await q
    .insert(pickupDays)
    .values(row)
    .onConflictDoUpdate({
      target: [pickupDays.userId, pickupDays.day],
      set: {
        startKind: row.startKind,
        endKind: row.endKind,
        privateEnc: row.privateEnc ?? null,
        startTime: row.startTime,
        latestFinish: row.latestFinish,
        maxDriveMinutes: row.maxDriveMinutes ?? null,
      },
    })
    .returning()
  if (!day) throw new Error('day upsert returned no row')
  return day
}

export async function selectDay(
  q: Queryable,
  userId: string,
  day: string,
): Promise<DayRow | undefined> {
  const [row] = await q
    .select()
    .from(pickupDays)
    .where(and(eq(pickupDays.userId, userId), eq(pickupDays.day, day)))
  return row
}

/** Stores a new plan version for the day and marks the previous current one superseded. */
export async function insertPlan(
  q: Queryable,
  row: Omit<PlanInsert, 'version'>,
  now: Date,
): Promise<PlanRow> {
  const [latest] = await q
    .select({ version: routePlans.version })
    .from(routePlans)
    .where(eq(routePlans.dayId, row.dayId))
    .orderBy(desc(routePlans.version))
    .limit(1)
  await q
    .update(routePlans)
    .set({ supersededAt: now })
    .where(and(eq(routePlans.dayId, row.dayId), isNull(routePlans.supersededAt)))
  const [plan] = await q
    .insert(routePlans)
    .values({ ...row, version: (latest?.version ?? 0) + 1 })
    .returning()
  if (!plan) throw new Error('plan insert returned no row')
  return plan
}

export async function selectCurrentPlan(
  q: Queryable,
  userId: string,
  dayId: string,
): Promise<PlanRow | undefined> {
  const [row] = await q
    .select()
    .from(routePlans)
    .where(
      and(
        eq(routePlans.userId, userId),
        eq(routePlans.dayId, dayId),
        isNull(routePlans.supersededAt),
      ),
    )
    .orderBy(desc(routePlans.version))
    .limit(1)
  return row
}

export async function selectDefaults(
  q: Queryable,
  userId: string,
): Promise<DefaultsRow | undefined> {
  const [row] = await q.select().from(plannerDefaults).where(eq(plannerDefaults.userId, userId))
  return row
}

export async function upsertDefaults(
  q: Queryable,
  userId: string,
  patch: Partial<Omit<typeof plannerDefaults.$inferInsert, 'id' | 'userId'>>,
): Promise<DefaultsRow> {
  const [row] = await q
    .insert(plannerDefaults)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: plannerDefaults.userId, set: patch })
    .returning()
  if (!row) throw new Error('defaults upsert returned no row')
  return row
}

/** Deletes every row of these users in all five tables (account.deleted, rule 12). Idempotent. */
export async function deleteUsersRows(q: Queryable, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return
  const ids = [...userIds]
  await q.delete(routePlans).where(inArray(routePlans.userId, ids))
  await q.delete(pickupReminders).where(inArray(pickupReminders.userId, ids))
  await q.delete(pickupDays).where(inArray(pickupDays.userId, ids))
  await q.delete(pickups).where(inArray(pickups.userId, ids))
  await q.delete(plannerDefaults).where(inArray(plannerDefaults.userId, ids))
}

/** Retention (§5.6): deletes pickups and days whose day is before `cutoffDay`; plans cascade. */
export async function deleteBeforeDay(
  q: Queryable,
  cutoffDay: string,
): Promise<{ pickups: number; days: number }> {
  const gone = await q
    .delete(pickups)
    .where(lt(pickups.day, cutoffDay))
    .returning({ id: pickups.id })
  const days = await q
    .delete(pickupDays)
    .where(lt(pickupDays.day, cutoffDay))
    .returning({ id: pickupDays.id })
  return { pickups: gone.length, days: days.length }
}

export const nowSql = sql`now()`
