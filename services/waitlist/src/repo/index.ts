// Database access to the waitlist schema only. Other modules read waitlist.v_waitlist, never this
// file. Waitlist entries are anonymous (no userId), so nothing here runs inside withUser.
import { createHash } from 'node:crypto'
import { WAITLIST_SUBMIT_PER_IP } from '@nabvy/config/modules/waitlist'
import type { Queryable } from '@nabvy/db'
import { entries, vWaitlist } from '@nabvy/db/schema/waitlist'
import { eq, sql } from 'drizzle-orm'
import type { EntryInsert, EntryRow } from '../domain'

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

function toRow(row: typeof entries.$inferSelect): EntryRow {
  return {
    id: row.id,
    email: row.email,
    postcode: row.postcode,
    wantedProducts: row.wantedProducts,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmTerm: row.utmTerm,
    utmContent: row.utmContent,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Inserts the entry, or returns the caller's existing one unchanged for a repeat address (the
 * `entries_email_unique` constraint). A repeat sign-up therefore writes no new row and never
 * overwrites the first entry's postcode, wanted products or UTM (`docs/questions.md`, "waitlist:
 * repeat sign-ups"): the module's idempotency for public, unauthenticated input.
 */
export async function upsertEntry(
  db: Queryable,
  values: EntryInsert,
): Promise<{ row: EntryRow; created: boolean }> {
  const inserted = await db
    .insert(entries)
    .values(values)
    .onConflictDoNothing({ target: entries.email })
    .returning()
  if (inserted[0]) return { row: toRow(inserted[0]), created: true }
  const [existing] = await db.select().from(entries).where(eq(entries.email, values.email)).limit(1)
  if (!existing) throw new Error(`waitlist: ${values.email} vanished on insert`)
  return { row: toRow(existing), created: false }
}

/** A row of `v_waitlist` with its time as an ISO string; `list()` parses it. */
export type ViewRow = Omit<typeof vWaitlist.$inferSelect, 'createdAt'> & { createdAt: string }

export async function selectAll(db: Queryable): Promise<ViewRow[]> {
  const rows = await db.select().from(vWaitlist)
  return rows.map((row) => ({ ...row, createdAt: (row.createdAt as Date).toISOString() }))
}

/**
 * A Postgres-backed counter per hashed IP address (never the address itself), the same window
 * pattern as Better Auth's `rate_limit` table (`services/auth/src/auth.ts`,
 * `consumeMagicLinkQuota`). One `insert … on conflict do update` statement takes the row lock, so
 * requests arriving together are counted one after another. Returns whether this attempt is within
 * `WAITLIST_SUBMIT_PER_IP`; a refused attempt still counts, which only keeps the window shut.
 */
export async function consumeSubmitQuota(
  db: Queryable,
  ip: string,
  now: number = Date.now(),
): Promise<boolean> {
  const { max, windowSeconds } = WAITLIST_SUBMIT_PER_IP
  const key = createHash('sha256').update(ip).digest('hex')
  const windowStart = new Date(now - windowSeconds * 1000)
  const at = new Date(now)
  const result = await db.execute(sql`
    insert into waitlist.submission_attempts (key, count, window_start)
    values (${key}, 1, ${at})
    on conflict (key) do update set
      count = case when waitlist.submission_attempts.window_start <= ${windowStart}
                   then 1 else waitlist.submission_attempts.count + 1 end,
      window_start = case when waitlist.submission_attempts.window_start <= ${windowStart}
                          then ${at} else waitlist.submission_attempts.window_start end
    returning count`)
  const rows = rowsOf<{ count: number | string }>(result)
  return Number(rows[0]?.count) <= max
}
