// Database access to the scan_recognition schema only. Other modules' data is reached through
// their exported functions (product-catalogue, cost-meter, account, switches), never here.
import type { Queryable } from '@nabvy/db'
import { scanEvents } from '@nabvy/db/schema/scan-recognition'
import { eq, inArray, sql } from 'drizzle-orm'

export type ScanRow = typeof scanEvents.$inferSelect
export type ScanInsert = typeof scanEvents.$inferInsert

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

/** The scan with this ID, if the caller may see it (RLS applies under withUser). */
export async function selectScan(q: Queryable, id: string): Promise<ScanRow | undefined> {
  const [row] = await q.select().from(scanEvents).where(eq(scanEvents.id, id)).limit(1)
  return row
}

/**
 * Serialises one user's scans for the rest of the transaction, so two scans cannot both pass the
 * spend cap on the same remaining budget.
 */
export async function lockUser(q: Queryable, userId: string): Promise<void> {
  await q.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`scan-recognition:${userId}`}, 0))`,
  )
}

/** What the user's scans cost in GBP micros since `since`. */
export async function spentSince(q: Queryable, userId: string, since: Date): Promise<number> {
  const result = await q.execute(sql`
    select coalesce(sum(cost_gbp_micros), 0)::bigint as spent
    from scan_recognition.scan_events
    where user_id = ${userId} and at >= ${since.toISOString()}::timestamptz
  `)
  const [row] = rowsOf<{ spent: string | number }>(result)
  return Number(row?.spent ?? 0)
}

/** Inserts a scan; a row with the same ID already there is left alone (`undefined`). */
export async function insertScan(q: Queryable, row: ScanInsert): Promise<ScanRow | undefined> {
  const [inserted] = await q.insert(scanEvents).values(row).onConflictDoNothing().returning()
  return inserted
}

/** Records the user's confirmation. Only the columns nabvy_app may update are written. */
export async function writeConfirmation(
  q: Queryable,
  id: string,
  catalogueId: string,
  now: Date,
): Promise<ScanRow | undefined> {
  const [row] = await q
    .update(scanEvents)
    .set({
      status: 'identified',
      identified: catalogueId,
      confirmed: true,
      identifiedAt: now,
      confirmedAt: now,
    })
    .where(eq(scanEvents.id, id))
    .returning()
  return row
}

/**
 * Clears the photo refs whose 30 days have passed and returns them, so the storage task can
 * delete the objects (the storage lifecycle rule is the backstop, docs/security.md).
 */
export async function clearExpiredPhotos(
  q: Queryable,
  now: Date,
  limit: number,
): Promise<string[]> {
  const result = await q.execute(sql`
    with expired as (
      select id, photo_ref from scan_recognition.scan_events
      where photo_ref is not null and photo_expires_at <= ${now.toISOString()}::timestamptz
      order by photo_expires_at
      limit ${limit}
      for update skip locked
    )
    update scan_recognition.scan_events as s
    set photo_ref = null, photo_media_type = null
    from expired
    where s.id = expired.id
    returning expired.photo_ref
  `)
  return rowsOf<{ photo_ref: string }>(result).map((row) => row.photo_ref)
}

/** Deletes every scan of these users and returns the photo refs still stored. */
export async function deleteUsersScans(q: Queryable, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = await q
    .delete(scanEvents)
    .where(inArray(scanEvents.userId, userIds))
    .returning({ photoRef: scanEvents.photoRef })
  return rows.flatMap((row) => (row.photoRef ? [row.photoRef] : []))
}
