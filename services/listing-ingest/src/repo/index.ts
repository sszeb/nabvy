// Database access: this module's own schema, listing_ingest, and apify-gateway's published views
// (v_jobs, v_run_summaries, v_rows), as nabvy_pipeline inside withPipeline.
import { vJobs, vRows, vRunSummaries } from '@nabvy/db/schema/apify-gateway'
import { listings, sightings } from '@nabvy/db/schema/listing-ingest'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Card, Observation, StoredCard } from '../domain'

// A type query rather than a separate statement: packages/db/test/conventions.test.ts reads each
// statement up to the next semicolon, so one from '@nabvy/db' placed before the view statement
// above (where the sort puts it) would be read as part of that statement and refused.
type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows
const iso = (value: Date | string) => new Date(value).toISOString()

export interface CollectedJob {
  id: number
  status: string
  runKind: 'search' | 'details' | null
  finishedAt: string | null
  collectedAt: string | null
}

/** A collected job as the gateway publishes it, with the run's `RUN_SUMMARY.collectedAt`. */
export async function selectJob(q: Queryable, jobId: number): Promise<CollectedJob | null> {
  const [job] = await q
    .select({
      id: vJobs.id,
      status: vJobs.status,
      runKind: vJobs.runKind,
      finishedAt: vJobs.finishedAt,
      collectedAt: sql<string | null>`${vRunSummaries.summary} ->> 'collectedAt'`,
    })
    .from(vJobs)
    .leftJoin(vRunSummaries, eq(vRunSummaries.jobId, vJobs.id))
    .where(eq(vJobs.id, jobId))
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    runKind: job.runKind as CollectedJob['runKind'],
    finishedAt: job.finishedAt ? iso(job.finishedAt) : null,
    collectedAt: job.collectedAt,
  }
}

/** The job's `listing` rows, in dataset order (seller objects already removed by the view). */
export function selectListingRows(q: Queryable, jobId: number) {
  return q
    .select({ seq: vRows.seq, item: vRows.item })
    .from(vRows)
    .where(and(eq(vRows.jobId, jobId), eq(vRows.recordType, 'listing')))
    .orderBy(asc(vRows.seq))
}

export interface StoredListing extends StoredCard {
  id: string
  sourceListingId: string
}

/** The stored listings for these source IDs. */
export async function selectListings(
  q: Queryable,
  source: string,
  sourceListingIds: string[],
): Promise<StoredListing[]> {
  if (sourceListingIds.length === 0) return []
  const rows = await q
    .select({
      id: listings.id,
      sourceListingId: listings.sourceListingId,
      cardHash: listings.cardHash,
      title: listings.title,
      primaryPhotoId: listings.primaryPhotoId,
      lastSeenAt: listings.lastSeenAt,
    })
    .from(listings)
    .where(and(eq(listings.source, source), inArray(listings.sourceListingId, sourceListingIds)))
  return rows.map((row) => ({ ...row, lastSeenAt: iso(row.lastSeenAt) }))
}

const cardColumns = (card: Card) => ({
  cardHash: card.cardHash,
  priceMinor: card.priceMinor,
  currency: card.currency,
  moneyKind: card.moneyKind,
  title: card.title,
  listedAt: card.listedAt ? new Date(card.listedAt) : null,
  lastSeenAt: new Date(card.seenAt),
  cityPageId: card.cityPageId,
  townLabel: card.townLabel,
  availability: card.availability,
  categoryId: card.categoryId,
  deliveryTypes: card.deliveryTypes,
  primaryPhotoId: card.primaryPhotoId,
  displayedPreviousMinor: card.displayedPreviousMinor,
  binding: card.binding,
})

/** Inserts identities not yet stored; an existing `(source, source_listing_id)` is left alone. */
export async function insertListings(q: Queryable, jobId: number, cards: Card[]): Promise<void> {
  if (cards.length === 0) return
  await q
    .insert(listings)
    .values(
      cards.map((card) => ({
        source: card.source,
        sourceListingId: card.sourceListingId,
        ...cardColumns(card),
        foundByTerms: card.foundByTerms,
        firstFetchedAt: new Date(card.seenAt),
        itemJobId: jobId,
        itemSeq: card.seq,
      })),
    )
    .onConflictDoNothing({ target: [listings.source, listings.sourceListingId] })
}

/** A search card replaces every card value (fresh card fields win). */
export async function updateFromSearch(
  q: Queryable,
  listingId: string,
  jobId: number,
  card: Card,
): Promise<void> {
  await q
    .update(listings)
    .set({ ...cardColumns(card), itemJobId: jobId, itemSeq: card.seq })
    .where(eq(listings.id, listingId))
}

/**
 * A details row updates price, money kind, availability and the hash, and fills card values
 * still unknown. The title, primary photo, terms and binding stay the card's.
 */
export async function updateFromDetail(q: Queryable, listingId: string, card: Card): Promise<void> {
  await q
    .update(listings)
    .set({
      cardHash: card.cardHash,
      priceMinor: card.priceMinor,
      currency: card.currency,
      moneyKind: card.moneyKind,
      availability: card.availability,
      lastSeenAt: new Date(card.seenAt),
      listedAt: sql`coalesce(${listings.listedAt}, ${card.listedAt}::timestamptz)`,
      cityPageId: sql`coalesce(${listings.cityPageId}, ${card.cityPageId})`,
      townLabel: sql`coalesce(${listings.townLabel}, ${card.townLabel})`,
      categoryId: sql`coalesce(${listings.categoryId}, ${card.categoryId})`,
      displayedPreviousMinor: sql`coalesce(${card.displayedPreviousMinor}::bigint, ${listings.displayedPreviousMinor})`,
    })
    .where(eq(listings.id, listingId))
}

/**
 * Adds found-by terms a listing does not carry yet, keeping the earlier ones first, in one
 * statement. Runs for every search card, newer or not, so no run's terms are lost; a listing that
 * already carries them all is not written.
 */
export async function addTerms(
  q: Queryable,
  rows: { listingId: string; terms: string[] }[],
): Promise<void> {
  const payload = rows.filter((row) => row.terms.length > 0)
  if (payload.length === 0) return
  await q.execute(sql`
    update listing_ingest.listings l
    set found_by_terms = l.found_by_terms || array(
      select distinct t from jsonb_array_elements_text(x.terms) as t
      where not (t = any (l.found_by_terms)))
    from jsonb_to_recordset(${JSON.stringify(
      payload.map((row) => ({ id: row.listingId, terms: row.terms })),
    )}::jsonb) as x (id uuid, terms jsonb)
    where l.id = x.id
      and not (l.found_by_terms @> array(select jsonb_array_elements_text(x.terms)))`)
}

/** One sighting per listing, job and kind; a replayed job inserts nothing. */
export async function insertSightings(
  q: Queryable,
  jobId: number,
  rows: { listingId: string; observation: Observation; card: Card }[],
): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await q
    .insert(sightings)
    .values(
      rows.map(({ listingId, observation, card }) => ({
        listingId,
        jobId,
        seq: observation.seq,
        kind: observation.kind,
        terms: observation.terms,
        centreIds: observation.centreIds,
        rank: observation.rank,
        cardHash: card.cardHash,
        priceMinor: card.priceMinor,
        currency: card.currency,
        availability: card.availability,
        seenAt: new Date(card.seenAt),
      })),
    )
    .onConflictDoNothing({ target: [sightings.listingId, sightings.jobId, sightings.kind] })
    .returning({ id: sightings.id })
  return inserted.length
}

/**
 * Listings this job saw first: their earliest observation belongs to the job. Derived from the
 * stored sightings, so a replay after a lost publish finds the same IDs (and the same keys).
 */
export async function selectFirstSeen(q: Queryable, jobId: number): Promise<string[]> {
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      select s.listing_id
      from listing_ingest.sightings s
      where s.job_id = ${jobId}
        and not exists (
          select 1 from listing_ingest.sightings e
          where e.listing_id = s.listing_id
            and (e.seen_at, e.job_id, e.kind) < (s.seen_at, s.job_id, s.kind)
        )
      order by s.seq`),
  )
  return [...new Set(rows.map((row) => row.listing_id))]
}

/**
 * Listings whose card this job changed: the job's observation carries a different card hash from
 * the observation just before it. Price is compared as `price_minor` and currency inside the hash.
 */
export async function selectCardChanged(q: Queryable, jobId: number): Promise<string[]> {
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      select s.listing_id
      from listing_ingest.sightings s
      cross join lateral (
        select p.card_hash from listing_ingest.sightings p
        where p.listing_id = s.listing_id
          and (p.seen_at, p.job_id, p.kind) < (s.seen_at, s.job_id, s.kind)
        order by p.seen_at desc, p.job_id desc, p.kind desc
        limit 1
      ) prev
      where s.job_id = ${jobId} and prev.card_hash <> s.card_hash
      order by s.seq`),
  )
  return [...new Set(rows.map((row) => row.listing_id))]
}

/** Removes listings and their sightings (rule 12, for seller-rights erasure). */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  await q.delete(sightings).where(inArray(sightings.listingId, listingIds))
  const deleted = await q
    .delete(listings)
    .where(inArray(listings.id, listingIds))
    .returning({ id: listings.id })
  return deleted.length
}
