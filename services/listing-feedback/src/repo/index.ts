// Database access to the listing_feedback schema only. Runs entirely as nabvy_app inside
// withUser (packages/db/migrations/listing-feedback/*_access.sql): row-level security limits
// every statement to the caller's own rows.
import type { Queryable } from '@nabvy/db'
import { listingState, verdicts } from '@nabvy/db/schema/listing-feedback'
import { inArray, sql } from 'drizzle-orm'

export type VerdictRow = typeof verdicts.$inferSelect
export type StateRow = typeof listingState.$inferSelect

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

/**
 * Upserts a verdict on `(user_id, listing_id, coalesce(alert_id, nil))` (packages/db/src/schema/
 * listing-feedback.ts, `verdicts_identity_idx`): the same identity replaces the stored row rather
 * than adding another, so a repeated or changed verdict for the same listing (and alert, if any)
 * is always exactly one row. `created` is true only when this call inserted the row.
 */
export async function upsertVerdict(
  q: Queryable,
  input: { userId: string; listingId: string; alertId: string | null; verdict: string; at: Date },
): Promise<{ row: VerdictRow; created: boolean }> {
  const result = await q.execute(sql`
    insert into listing_feedback.verdicts (user_id, listing_id, alert_id, verdict, at)
    values (${input.userId}, ${input.listingId}, ${input.alertId}, ${input.verdict}, ${input.at.toISOString()}::timestamptz)
    on conflict (user_id, listing_id, coalesce(alert_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set verdict = excluded.verdict, at = excluded.at, updated_at = now()
    returning id, user_id as "userId", listing_id as "listingId", alert_id as "alertId", verdict,
      at, created_at as "createdAt", updated_at as "updatedAt", (xmax = 0) as created
  `)
  const [row] = rowsOf<VerdictRow & { created: boolean }>(result)
  if (!row) throw new Error('verdict upsert returned no row')
  const { created, ...stored } = row
  return { row: stored, created }
}

/**
 * Upserts a saved/dismissed state on `(user_id, listing_id)`: one state per user per listing, the
 * latest call wins.
 */
export async function upsertState(
  q: Queryable,
  input: { userId: string; listingId: string; state: string; at: Date },
): Promise<{ row: StateRow; created: boolean }> {
  const result = await q.execute(sql`
    insert into listing_feedback.listing_state (user_id, listing_id, state, at)
    values (${input.userId}, ${input.listingId}, ${input.state}, ${input.at.toISOString()}::timestamptz)
    on conflict (user_id, listing_id)
    do update set state = excluded.state, at = excluded.at, updated_at = now()
    returning id, user_id as "userId", listing_id as "listingId", state, at,
      created_at as "createdAt", updated_at as "updatedAt", (xmax = 0) as created
  `)
  const [row] = rowsOf<StateRow & { created: boolean }>(result)
  if (!row) throw new Error('state upsert returned no row')
  const { created, ...stored } = row
  return { row: stored, created }
}

/** Deletes every verdict and state row of these users (account.deleted, rule 12). Idempotent. */
export async function deleteUsersFeedback(q: Queryable, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await q.delete(verdicts).where(inArray(verdicts.userId, userIds))
  await q.delete(listingState).where(inArray(listingState.userId, userIds))
}
