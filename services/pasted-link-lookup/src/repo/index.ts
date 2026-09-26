// Database access to the pasted_link_lookup schema, plus reads of listing-card's user-facing view
// app.v_listing_card (packages/db/README.md: other modules' data only through their v_ views).
// submit() runs as nabvy_app inside withUser, where row-level security limits every statement to
// the caller's own rows; settle() and the purge run as nabvy_pipeline.
import type { Queryable } from '@nabvy/db'
import { vListingCard } from '@nabvy/db/schema/listing-card'
import { requests } from '@nabvy/db/schema/pasted-link-lookup'
import { inArray, sql } from 'drizzle-orm'

export type RequestRow = typeof requests.$inferSelect

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

const RETURNING = sql`id, user_id as "userId", source, source_listing_id as "sourceListingId",
  listing_id as "listingId", status, outcome, requested_at as "requestedAt", ready_at as "readyAt",
  created_at as "createdAt", updated_at as "updatedAt"`

/**
 * Inserts a request on `(user_id, source, source_listing_id)` (`requests_identity_idx`), or
 * returns the row already there: the same link pasted twice by one user is one request, whatever
 * its state. `requested_at` (and `ready_at`, when the card is already visible with details) is
 * `now()` in SQL, never a caller value: the access migration's restrictive policy refuses anything
 * else from nabvy_app. `created` is true only when this call inserted the row.
 */
export async function insertRequest(
  q: Queryable,
  input: {
    userId: string
    source: 'facebook'
    sourceListingId: string
    listingId: string | null
    ready: boolean
  },
): Promise<{ row: RequestRow; created: boolean }> {
  const inserted = rowsOf<RequestRow>(
    await q.execute(sql`
      insert into pasted_link_lookup.requests (user_id, source, source_listing_id, listing_id, status, ready_at)
      values (${input.userId}, ${input.source}, ${input.sourceListingId}, ${input.listingId},
        ${input.ready ? 'ready' : 'queued'}, case when ${input.ready} then now() end)
      on conflict (user_id, source, source_listing_id) do nothing
      returning ${RETURNING}
    `),
  )
  const [row] = inserted
  if (row) return { row, created: true }
  const existing = rowsOf<RequestRow>(
    await q.execute(sql`
      select ${RETURNING} from pasted_link_lookup.requests
      where user_id = ${input.userId} and source = ${input.source}
        and source_listing_id = ${input.sourceListingId}
    `),
  )
  const [found] = existing
  if (!found) throw new Error('request upsert returned no row')
  return { row: found, created: false }
}

/** The user's requests in the last 24 hours, on server time (the daily limit's window). */
export async function countRecent(q: Queryable, userId: string): Promise<number> {
  const [row] = rowsOf<{ n: number }>(
    await q.execute(sql`
      select count(*)::int as n from pasted_link_lookup.requests
      where user_id = ${userId} and requested_at > now() - interval '24 hours'
    `),
  )
  return row?.n ?? 0
}

/** Finds an existing request by idempotency key, or null if none exists. */
export async function findByKey(
  q: Queryable,
  userId: string,
  source: 'facebook',
  sourceListingId: string,
): Promise<RequestRow | null> {
  const rows = rowsOf<RequestRow>(
    await q.execute(sql`
      select ${RETURNING} from pasted_link_lookup.requests
      where user_id = ${userId} and source = ${source} and source_listing_id = ${sourceListingId}
    `),
  )
  return rows[0] ?? null
}

export interface VisibleCard {
  listingId: string
  link: string
  /** Null until a detail fetch exists (listing-card's contract). */
  descriptionStatus: string | null
}

/**
 * The visible cards behind these canonical links, from `app.v_listing_card` (listing-card's own
 * switch, the suppression list and the unresolved filter already applied). A missing link means
 * the listing is not visible: unknown, suppressed, or listing-card off.
 */
export async function findCardsByLink(q: Queryable, links: string[]): Promise<VisibleCard[]> {
  if (links.length === 0) return []
  const rows = await q
    .select({
      listingId: vListingCard.listingId,
      link: vListingCard.link,
      descriptionStatus: vListingCard.descriptionStatus,
    })
    .from(vListingCard)
    .where(inArray(vListingCard.link, links))
  return rows.flatMap((row) => (row.link === null ? [] : [{ ...row, link: row.link }]))
}

/** The oldest queued requests, at most `limit` (one settle batch). */
export async function selectQueued(q: Queryable, limit: number): Promise<RequestRow[]> {
  return rowsOf<RequestRow>(
    await q.execute(sql`
      select ${RETURNING} from pasted_link_lookup.requests
      where status = 'queued'
      order by requested_at, id
      limit ${limit}
    `),
  )
}

const uuidArray = (ids: readonly string[]) =>
  sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`

/**
 * Moves queued requests to `ready`, setting their listing and `ready_at = now()`. Only a queued
 * row moves, so a second call with the same IDs changes nothing. Returns the IDs that moved.
 */
export async function markReady(
  q: Queryable,
  pairs: readonly { requestId: string; listingId: string }[],
): Promise<string[]> {
  if (pairs.length === 0) return []
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      update pasted_link_lookup.requests r
      set status = 'ready', listing_id = v.listing_id, ready_at = now(), updated_at = now()
      from unnest(${uuidArray(pairs.map((p) => p.requestId))}, ${uuidArray(pairs.map((p) => p.listingId))})
        as v(id, listing_id)
      where r.id = v.id and r.status = 'queued'
      returning r.id
    `),
  )
  return rows.map((row) => row.id)
}

/** Records the listing behind a queued request whose card is visible but not yet described. */
export async function setListing(
  q: Queryable,
  pairs: readonly { requestId: string; listingId: string }[],
): Promise<void> {
  if (pairs.length === 0) return
  await q.execute(sql`
    update pasted_link_lookup.requests r
    set listing_id = v.listing_id, updated_at = now()
    from unnest(${uuidArray(pairs.map((p) => p.requestId))}, ${uuidArray(pairs.map((p) => p.listingId))})
      as v(id, listing_id)
    where r.id = v.id and r.status = 'queued' and r.listing_id is distinct from v.listing_id
  `)
}

/** Moves queued requests to `failed` with an outcome. Idempotent. Returns the IDs that moved. */
export async function markFailed(
  q: Queryable,
  requestIds: readonly string[],
  outcome: 'expired' | 'fetch-failed',
): Promise<string[]> {
  if (requestIds.length === 0) return []
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      update pasted_link_lookup.requests
      set status = 'failed', outcome = ${outcome}, updated_at = now()
      where status = 'queued' and id = any(${uuidArray(requestIds)})
      returning id
    `),
  )
  return rows.map((row) => row.id)
}

/**
 * Queued requests older than the TTL, on server time (the expiry is never a caller's clock). At
 * most `limit`, oldest first.
 */
export async function selectExpired(
  q: Queryable,
  ttlDays: number,
  limit: number,
): Promise<string[]> {
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      select id from pasted_link_lookup.requests
      where status = 'queued' and requested_at < now() - make_interval(days => ${ttlDays}::int)
      order by requested_at, id
      limit ${limit}
    `),
  )
  return rows.map((row) => row.id)
}

/** Deletes every request of these users (account.deleted, rule 12). Idempotent. */
export async function deleteUsersRequests(q: Queryable, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await q.delete(requests).where(inArray(requests.userId, userIds))
}
