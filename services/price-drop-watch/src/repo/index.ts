// Database access: this module's own schema, price_drop_watch, and the published internal views
// of listing-ingest (v_listings, v_price_changes) and relist-merge (v_groups), as nabvy_pipeline
// inside withPipeline, or as nabvy_app inside withUser for the user's own watch. Lists travel as
// one jsonb parameter, as in listing-lifecycle.
import { sql } from 'drizzle-orm'
import type { DropCandidate } from '../domain'

type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows
const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString()
const ids = (values: readonly string[]) => sql`(
  select (jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))::uuid as id)`

/** The database's clock: every window this module applies runs on server time. */
export async function dbNow(q: Queryable): Promise<Date> {
  const [row] = rowsOf<{ now: Date | string }>(await q.execute(sql`select now() as now`))
  return new Date(row?.now ?? Date.now())
}

/**
 * Whether listing-ingest shows this listing (never ingested, erased, or listing-ingest off).
 * `watch()` runs as nabvy_app, which has no grant on listing-ingest's internal `v_listings`
 * (rule 5), so this calls the SECURITY DEFINER wrapper `price_drop_watch.listing_known()` (the
 * access migration) rather than querying the view directly — the same pattern as
 * `listing_price_history()`.
 */
export async function listingKnown(q: Queryable, listingId: string): Promise<boolean> {
  const rows = rowsOf<{ listing_known: boolean }>(
    await q.execute(sql`select price_drop_watch.listing_known(${listingId}) as listing_known`),
  )
  return rows[0]?.listing_known ?? false
}

export interface Watch {
  id: string
  userId: string
  listingId: string
  active: boolean
  createdAt: string
}

/** Creates a watch, or reactivates it if the user already watched this listing before. */
export async function upsertWatch(
  q: Queryable,
  input: { userId: string; listingId: string },
): Promise<Watch> {
  const rows = rowsOf<{
    id: string
    user_id: string
    listing_id: string
    active: boolean
    created_at: Date | string
  }>(
    await q.execute(sql`
      insert into price_drop_watch.watches (user_id, listing_id)
      values (${input.userId}, ${input.listingId})
      on conflict (user_id, listing_id) do update set active = true
      returning id, user_id, listing_id, active, created_at`),
  )
  const row = rows[0] as (typeof rows)[number]
  return {
    id: row.id,
    userId: row.user_id,
    listingId: row.listing_id,
    active: row.active,
    createdAt: iso(row.created_at) as string,
  }
}

/** Sets a watch inactive. A no-op (returns null) when the user never watched this listing. */
export async function deactivateWatch(
  q: Queryable,
  input: { userId: string; listingId: string },
): Promise<Watch | null> {
  const rows = rowsOf<{
    id: string
    user_id: string
    listing_id: string
    active: boolean
    created_at: Date | string
  }>(
    await q.execute(sql`
      update price_drop_watch.watches set active = false
      where user_id = ${input.userId} and listing_id = ${input.listingId}
      returning id, user_id, listing_id, active, created_at`),
  )
  const [row] = rows
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        listingId: row.listing_id,
        active: row.active,
        createdAt: iso(row.created_at) as string,
      }
    : null
}

export interface ActiveWatch {
  watchId: string
  userId: string
  listingId: string
  watchCreatedAt: string
}

/** Active watches on these listings (all users; the caller is nabvy_pipeline). */
export async function selectActiveWatches(
  q: Queryable,
  listingIds: string[],
): Promise<ActiveWatch[]> {
  if (listingIds.length === 0) return []
  const rows = rowsOf<{
    id: string
    user_id: string
    listing_id: string
    created_at: Date | string
  }>(
    await q.execute(sql`
      select w.id, w.user_id, w.listing_id, w.created_at
      from price_drop_watch.watches w
      where w.active and w.listing_id in (select id from ${ids(listingIds)})`),
  )
  return rows.map((r) => ({
    watchId: r.id,
    userId: r.user_id,
    listingId: r.listing_id,
    watchCreatedAt: iso(r.created_at) as string,
  }))
}

/** Every active watch's listing, for the tick's recheck request. At most `limit` listing IDs. */
export async function selectAllActiveWatchedListings(
  q: Queryable,
  limit: number,
): Promise<string[]> {
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      select distinct w.listing_id
      from price_drop_watch.watches w
      where w.active
      order by w.listing_id
      limit ${limit}`),
  )
  return rows.map((r) => r.listing_id)
}

export interface PriceChange {
  listingId: string
  fromMinor: number
  toMinor: number
  currency: 'GBP' | 'EUR'
  observedAt: string
  cardHash: string
}

/**
 * The latest observed price change of each listing (listing-ingest's `v_price_changes`, joined to
 * `v_sightings` for the triggering sighting's own card hash — the idempotency key material, never
 * invented here). Only the latest per listing: a card-changed event means a new sighting just
 * landed, and `v_price_changes` is queried again in full on the next one.
 */
export async function selectLatestPriceChanges(
  q: Queryable,
  listingIds: string[],
): Promise<PriceChange[]> {
  if (listingIds.length === 0) return []
  const rows = rowsOf<{
    listing_id: string
    previous_minor: number | string
    price_minor: number | string
    currency: 'GBP' | 'EUR'
    seen_at: Date | string
    card_hash: string
  }>(
    await q.execute(sql`
      select distinct on (pc.listing_id)
        pc.listing_id, pc.previous_minor, pc.price_minor, pc.currency, pc.seen_at, s.card_hash
      from listing_ingest.v_price_changes pc
      join listing_ingest.v_sightings s on s.id = pc.sighting_id
      where pc.listing_id in (select id from ${ids(listingIds)})
      order by pc.listing_id, pc.seen_at desc`),
  )
  return rows.map((r) => ({
    listingId: r.listing_id,
    fromMinor: Number(r.previous_minor),
    toMinor: Number(r.price_minor),
    currency: r.currency,
    observedAt: iso(r.seen_at) as string,
    cardHash: r.card_hash,
  }))
}

/** relist-merge's group ID for each listing that has one (none while relist-merge is off). */
export async function selectRelistGroupIds(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, string>> {
  if (listingIds.length === 0) return new Map()
  const rows = rowsOf<{ listing_id: string; group_id: string }>(
    await q.execute(sql`
      select g.listing_id, g.group_id
      from relist_merge.v_groups g
      where g.listing_id in (select id from ${ids(listingIds)})`),
  )
  return new Map(rows.map((r) => [r.listing_id, r.group_id]))
}

/**
 * Writes every decision's drop row, keyed on `(watch_id, card_hash)` so a replay writes nothing
 * new (rule 8). Whether a row was already there or is written now, the caller announces the same
 * `announce`d watch IDs either way: the decision is a deterministic function of stored data, so a
 * replay reproduces the same event (rule 8's upsert pattern).
 */
export async function insertDrops(q: Queryable, decisions: DropCandidate[]): Promise<void> {
  if (decisions.length === 0) return
  const payload = decisions.map((d) => ({
    watch_id: d.watchId,
    from_minor: d.fromMinor,
    to_minor: d.toMinor,
    currency: d.currency,
    observed_at: d.observedAt,
    card_hash: d.cardHash,
    relist_group_id: d.relistGroupId,
  }))
  await q.execute(sql`
    insert into price_drop_watch.drops (watch_id, from_minor, to_minor, currency, observed_at,
      card_hash, relist_group_id)
    select x.watch_id, x.from_minor, x.to_minor, x.currency, x.observed_at, x.card_hash,
      x.relist_group_id
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x (
      watch_id uuid, from_minor bigint, to_minor bigint, currency text, observed_at timestamptz,
      card_hash text, relist_group_id uuid)
    on conflict (watch_id, card_hash) do nothing`)
}

/** Removes these users' watches (and their drops, cascade). Rule 12: `account.deleted`. */
export async function deleteWatchesForUsers(q: Queryable, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      delete from price_drop_watch.watches where user_id in (select id from ${ids(userIds)})
      returning id`),
  )
  return rows.length
}

/** Removes every watch on these listings (and their drops, cascade). Rule 12: `erase()`. */
export async function deleteWatchesForListings(
  q: Queryable,
  listingIds: string[],
): Promise<number> {
  if (listingIds.length === 0) return 0
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      delete from price_drop_watch.watches where listing_id in (select id from ${ids(listingIds)})
      returning id`),
  )
  return rows.length
}
