// Database access to the waitlist schema only. Other modules read waitlist.v_waitlist, never this
// file. Waitlist entries are anonymous (no userId), so nothing here runs inside withUser.
import { createHash } from 'node:crypto'
import { WAITLIST_SUBMIT_PER_IP } from '@nabvy/config/modules/waitlist'
import type { Queryable } from '@nabvy/db'
import { vWaitlist } from '@nabvy/db/schema/waitlist'
import { sql } from 'drizzle-orm'
import type { EntryInsert } from '../domain'

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

/**
 * A Postgres array literal for a `text[]` parameter (the pg wire protocol does not encode a plain
 * JS array for a raw, untyped query parameter; without this a one-element array arrives as its
 * bare element and a malformed-array error). `null` stays `null`.
 */
function pgTextArray(values: readonly string[] | null): string | null {
  if (values === null) return null
  const escaped = values.map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
  return `{${escaped.join(',')}}`
}

/**
 * Inserts the entry, or leaves an existing one for the same address untouched: a repeat sign-up
 * writes no new row and never overwrites the first entry's postcode, wanted products or UTM
 * (`docs/questions.md`, "waitlist: repeat sign-ups"). Goes through `waitlist.join(...)`, a
 * `SECURITY DEFINER` SQL function, and not a Drizzle insert on `entries` directly: `nabvy_app` has
 * no privilege on that table at all, because even `insert ... on conflict do nothing` needs
 * `SELECT` to detect the conflict (PR #31 review). The function returns nothing, so a public
 * submission can never learn whether an address it names was already on the list, or read that
 * address's stored postcode, products or UTM.
 */
export async function insertEntry(db: Queryable, values: EntryInsert): Promise<void> {
  await db.execute(sql`
    select waitlist.join(
      ${values.email}, ${values.postcode}, ${pgTextArray(values.wantedProducts)}::text[],
      ${values.utmSource}, ${values.utmMedium}, ${values.utmCampaign},
      ${values.utmTerm}, ${values.utmContent}
    )`)
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
