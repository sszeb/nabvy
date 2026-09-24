// Database access: this module's own schema, listing_lifecycle, and the published internal views
// of listing-ingest (v_listings, v_sightings) and detail-evidence (v_outcomes), as nabvy_pipeline
// inside withPipeline. Lists travel as one jsonb parameter, as in detail-evidence.
import type { ListingIngestAvailability } from '@nabvy/contracts/modules/listing-ingest'
import type { ListingLifecycleRecheckReason } from '@nabvy/contracts/modules/listing-lifecycle'
import { sql } from 'drizzle-orm'
import type { Derived, DueRecheck, Evidence, RecheckStep } from '../domain'

// A type query rather than a separate statement, as in listing-ingest: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows
const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString()
const ids = (listingIds: readonly string[]) => sql`(
  select (jsonb_array_elements_text(${JSON.stringify(listingIds)}::jsonb))::uuid as id)`

/** The database's clock: every window this module applies runs on server time. */
export async function dbNow(q: Queryable): Promise<Date> {
  const [row] = rowsOf<{ now: Date | string }>(await q.execute(sql`select now() as now`))
  return new Date(row?.now ?? Date.now())
}

export interface Located {
  listingId: string
  source: string
  sourceListingId: string
}

/** listing-ingest's listings among these IDs (none while listing-ingest is off). */
export async function selectListings(q: Queryable, listingIds: string[]): Promise<Located[]> {
  if (listingIds.length === 0) return []
  const rows = rowsOf<{ id: string; source: string; source_listing_id: string }>(
    await q.execute(sql`
      select l.id, l.source, l.source_listing_id
      from listing_ingest.v_listings l
      where l.id in (select id from ${ids(listingIds)})`),
  )
  return rows.map((r) => ({
    listingId: r.id,
    source: r.source,
    sourceListingId: r.source_listing_id,
  }))
}

/**
 * The evidence of each listing: its latest observation (search or detail; on a tie the later job,
 * then the search card), its latest unresolved detail fetch, and how many later search runs of its
 * last search (a shared term and a shared centre) returned other listings but not this one, after
 * its latest observation.
 */
export async function selectEvidence(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, Evidence>> {
  if (listingIds.length === 0) return new Map()
  const rows = rowsOf<{
    listing_id: string
    availability: string | null
    seen_at: Date | string | null
    kind: 'search' | 'detail' | null
    missed: number | string | null
    unresolved_at: Date | string | null
  }>(
    await q.execute(sql`
      with wanted as ${ids(listingIds)},
      last_obs as (
        select distinct on (s.listing_id) s.listing_id, s.availability, s.seen_at, s.kind
        from listing_ingest.v_sightings s
        where s.listing_id in (select id from wanted)
        order by s.listing_id, s.seen_at desc, s.job_id desc, (s.kind = 'search') desc
      ),
      last_search as (
        select distinct on (s.listing_id) s.listing_id, s.job_id, s.terms, s.centre_ids
        from listing_ingest.v_sightings s
        where s.listing_id in (select id from wanted) and s.kind = 'search'
        order by s.listing_id, s.seen_at desc, s.job_id desc
      ),
      missed as (
        select ls.listing_id, count(distinct o.job_id) as missed
        from last_search ls
        join last_obs lo on lo.listing_id = ls.listing_id
        join listing_ingest.v_sightings o
          on o.kind = 'search' and o.seen_at > lo.seen_at and o.job_id <> ls.job_id
          and o.terms && ls.terms and o.centre_ids && ls.centre_ids
        where not exists (
          select 1 from listing_ingest.v_sightings x
          where x.listing_id = ls.listing_id and x.job_id = o.job_id)
        group by ls.listing_id
      ),
      unresolved as (
        select f.listing_id, max(f.fetched_at) as unresolved_at
        from detail_evidence.v_outcomes f
        where f.listing_id in (select id from wanted) and f.unresolved
        group by f.listing_id
      )
      select w.id as listing_id, lo.availability, lo.seen_at, lo.kind, m.missed, u.unresolved_at
      from wanted w
      left join last_obs lo on lo.listing_id = w.id
      left join missed m on m.listing_id = w.id
      left join unresolved u on u.listing_id = w.id`),
  )
  return new Map(
    rows.map((r) => [
      r.listing_id,
      {
        last:
          r.seen_at && r.kind
            ? {
                availability: (r.availability ?? 'unknown') as ListingIngestAvailability,
                seenAt: iso(r.seen_at) as string,
                kind: r.kind,
              }
            : null,
        lastUnresolvedAt: iso(r.unresolved_at),
        missedSweeps: Number(r.missed ?? 0),
      },
    ]),
  )
}

export interface StatusWrite extends Located {
  derived: Derived
  hash: string
}

/**
 * Upserts statuses, writing a row only when its hash differs. `changed_by` and `changed_at` move
 * only when the status itself changes (or the row is new), so the listings this trigger changed
 * can be read back on a replay. With `evaluatedAt` (the tick only), every evaluated row also
 * gets `evaluated_at`, the tick's round-robin cursor, without touching anything else; event
 * handlers leave it alone, so their replays write nothing. Returns how many rows were written.
 */
export async function upsertStatuses(
  q: Queryable,
  writes: StatusWrite[],
  trigger: string,
  evaluatedAt: Date | null,
): Promise<number> {
  if (writes.length === 0) return 0
  const payload = writes.map((w) => ({
    listing_id: w.listingId,
    source: w.source,
    source_listing_id: w.sourceListingId,
    status: w.derived.status,
    basis: w.derived.basis,
    last_seen_at: w.derived.lastSeenAt,
    observed_at: w.derived.observedAt,
    missed_sweeps: w.derived.missedSweeps,
    input_hash: w.hash,
  }))
  const written = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      insert into listing_lifecycle.status as s (listing_id, source, source_listing_id, status,
        basis, last_seen_at, observed_at, missed_sweeps, input_hash, changed_by, evaluated_at)
      select x.listing_id, x.source, x.source_listing_id, x.status, x.basis, x.last_seen_at,
        x.observed_at, x.missed_sweeps, x.input_hash, ${trigger},
        ${evaluatedAt?.toISOString() ?? null}::timestamptz
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x (
        listing_id uuid, source text, source_listing_id text, status text, basis text,
        last_seen_at timestamptz, observed_at timestamptz, missed_sweeps integer, input_hash text)
      on conflict (listing_id) do update set
        status = excluded.status,
        basis = excluded.basis,
        last_seen_at = excluded.last_seen_at,
        observed_at = excluded.observed_at,
        missed_sweeps = excluded.missed_sweeps,
        input_hash = excluded.input_hash,
        changed_by = case when s.status is distinct from excluded.status
          then excluded.changed_by else s.changed_by end,
        changed_at = case when s.status is distinct from excluded.status
          then now() else s.changed_at end,
        evaluated_at = coalesce(greatest(s.evaluated_at, excluded.evaluated_at), s.evaluated_at)
      where s.input_hash is distinct from excluded.input_hash
      returning s.listing_id`),
  )
  if (evaluatedAt) {
    await q.execute(sql`
      update listing_lifecycle.status s
      set evaluated_at = ${evaluatedAt.toISOString()}::timestamptz
      where s.listing_id in (select id from ${ids(writes.map((w) => w.listingId))})
        and (s.evaluated_at is null or s.evaluated_at < ${evaluatedAt.toISOString()}::timestamptz)`)
  }
  return written.length
}

/** The listings among these whose status this trigger changed, from the stored rows. */
export async function selectChangedBy(
  q: Queryable,
  listingIds: string[],
  trigger: string,
): Promise<{ listingId: string; status: string }[]> {
  if (listingIds.length === 0) return []
  const rows = rowsOf<{ listing_id: string; status: string }>(
    await q.execute(sql`
      select s.listing_id, s.status from listing_lifecycle.status s
      where s.listing_id in (select id from ${ids(listingIds)}) and s.changed_by = ${trigger}
      order by s.listing_id`),
  )
  return rows.map((r) => ({ listingId: r.listing_id, status: r.status }))
}

/**
 * Listings the tick should look at, oldest evaluation first, at most `limit`:
 * - listing-ingest listings with no status, or observed since their status was written;
 * - listings with an unresolved fetch newer than their status's evidence (a lost event);
 * - live or pending listings not observed for `notSeenHours`, not evaluated this hour, for the
 *   missed-sweeps rule.
 */
export async function selectTickCandidates(
  q: Queryable,
  now: Date,
  notSeenHours: number,
  limit: number,
): Promise<string[]> {
  const at = now.toISOString()
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      with candidates as (
        select l.id as listing_id, s.evaluated_at
        from listing_ingest.v_listings l
        left join listing_lifecycle.status s on s.listing_id = l.id
        where s.listing_id is null or s.last_seen_at is null or l.last_seen_at > s.last_seen_at
        union
        select s.listing_id, s.evaluated_at
        from listing_lifecycle.status s
        join detail_evidence.v_outcomes f on f.listing_id = s.listing_id and f.unresolved
        where s.status <> 'unresolved'
          and f.fetched_at > coalesce(s.observed_at, '-infinity'::timestamptz)
        union
        select s.listing_id, s.evaluated_at
        from listing_lifecycle.status s
        where s.status in ('live', 'pending')
          and s.last_seen_at <= ${at}::timestamptz - make_interval(hours => ${notSeenHours})
          and (s.evaluated_at is null
               or s.evaluated_at <= ${at}::timestamptz - interval '1 hour')
      )
      select listing_id from candidates
      group by listing_id
      order by min(evaluated_at) asc nulls first, listing_id
      limit ${limit}`),
  )
  return rows.map((r) => r.listing_id)
}

/**
 * Writes each listing's schedule for a reason, unless a step of that reason is still pending for
 * it; the partial unique index settles a concurrent request. Due times are server time (`now()`,
 * or `at` for the module's own not-seen rechecks). Returns the listings that got a schedule.
 */
export async function insertSchedules(
  q: Queryable,
  listings: Located[],
  reason: ListingLifecycleRecheckReason,
  steps: RecheckStep[],
  requestedBy: string,
  at?: Date,
): Promise<Set<string>> {
  if (listings.length === 0) return new Set()
  const payload = listings.flatMap((l) =>
    steps.map((s) => ({
      listing_id: l.listingId,
      source: l.source,
      source_listing_id: l.sourceListingId,
      step: s.step,
      after_hours: s.afterHours,
    })),
  )
  const base = at ? sql`${at.toISOString()}::timestamptz` : sql`now()`
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      insert into listing_lifecycle.rechecks (listing_id, source, source_listing_id, reason, step,
        requested_by, due_at)
      select x.listing_id, x.source, x.source_listing_id, ${reason}, x.step, ${requestedBy},
        ${base} + make_interval(hours => x.after_hours)
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x (
        listing_id uuid, source text, source_listing_id text, step smallint, after_hours integer)
      where not exists (
        select 1 from listing_lifecycle.rechecks r
        where r.listing_id = x.listing_id and r.reason = ${reason} and r.sent_at is null)
      on conflict (listing_id, reason, step) where sent_at is null do nothing
      returning listing_id`),
  )
  return new Set(rows.map((r) => r.listing_id))
}

/** Pending rechecks due by `now`, oldest first, with each listing's current status. */
export async function selectDue(
  q: Queryable,
  now: Date,
  limit: number,
): Promise<(DueRecheck & { source: string; status: string | null })[]> {
  const rows = rowsOf<{
    id: string
    listing_id: string
    source: string
    source_listing_id: string
    reason: ListingLifecycleRecheckReason
    due_at: Date | string
    status: string | null
  }>(
    await q.execute(sql`
      select r.id, r.listing_id, r.source, r.source_listing_id, r.reason, r.due_at, s.status
      from listing_lifecycle.rechecks r
      left join listing_lifecycle.status s on s.listing_id = r.listing_id
      where r.sent_at is null and r.due_at <= ${now.toISOString()}::timestamptz
      order by r.due_at, r.id
      limit ${limit}`),
  )
  return rows.map((r) => ({
    id: r.id,
    listingId: r.listing_id,
    source: r.source,
    sourceListingId: r.source_listing_id,
    reason: r.reason,
    dueAt: iso(r.due_at) as string,
    status: r.status,
  }))
}

/** Marks recheck steps sent, once (a trigger refuses to change a sent step). */
export async function markSent(
  q: Queryable,
  recheckIds: string[],
  outcome: 'queued' | 'skipped-unresolved',
  now: Date,
): Promise<void> {
  if (recheckIds.length === 0) return
  await q.execute(sql`
    update listing_lifecycle.rechecks
    set sent_at = ${now.toISOString()}::timestamptz, outcome = ${outcome}
    where id in (select (jsonb_array_elements_text(${JSON.stringify(recheckIds)}::jsonb))::uuid)
      and sent_at is null`)
}

/** Removes the status and rechecks of these listings. Returns how many statuses were removed. */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  await q.execute(sql`
    delete from listing_lifecycle.rechecks where listing_id in (select id from ${ids(listingIds)})`)
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      delete from listing_lifecycle.status where listing_id in (select id from ${ids(listingIds)})
      returning listing_id`),
  )
  return rows.length
}
