// Database access: this module's own schema, detail_evidence, apify-gateway's published views
// (v_jobs, v_run_summaries, v_rows) and listing-ingest's v_listings, as nabvy_pipeline inside
// withPipeline.
import { vJobs, vRows, vRunSummaries } from '@nabvy/db/schema/apify-gateway'
import { evidence, fetches } from '@nabvy/db/schema/detail-evidence'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Detail, Evidence } from '../domain'

// A type query rather than a separate statement, as in listing-ingest: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows
const iso = (value: Date | string) => new Date(value).toISOString()

export interface CollectedJob {
  id: number
  status: string
  finishedAt: string | null
  collectedAt: string | null
}

/** A collected job as the gateway publishes it, with the run's `RUN_SUMMARY.collectedAt`. */
export async function selectJob(q: Queryable, jobId: number): Promise<CollectedJob | null> {
  const [job] = await q
    .select({
      id: vJobs.id,
      status: vJobs.status,
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

/** listing-ingest's listing IDs for these source IDs. */
export async function selectListingIds(
  q: Queryable,
  source: string,
  sourceListingIds: string[],
): Promise<Map<string, string>> {
  if (sourceListingIds.length === 0) return new Map()
  const rows = await q
    .select({ id: vListings.id, sourceListingId: vListings.sourceListingId })
    .from(vListings)
    .where(and(eq(vListings.source, source), inArray(vListings.sourceListingId, sourceListingIds)))
  return new Map(rows.map((row) => [row.sourceListingId, row.id]))
}

export interface Located {
  listingId: string
  detail: Detail
  evidence: Evidence
}

/** Inserts versions not stored yet; an existing `(source, listing, hash)` is left alone. */
export async function insertVersions(
  q: Queryable,
  source: string,
  jobId: number,
  rows: Located[],
): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await q
    .insert(evidence)
    .values(
      rows.map(({ listingId, detail, evidence: e }) => ({
        source,
        sourceListingId: detail.sourceListingId,
        listingId,
        evidenceHash: e.evidenceHash,
        firstSeenAt: new Date(detail.fetchedAt),
        lastSeenAt: new Date(detail.fetchedAt),
        itemJobId: jobId,
        itemSeq: detail.seq,
        title: e.title,
        description: e.description,
        descriptionStatus: e.descriptionStatus,
        attributes: e.attributes,
        detailSections: e.detailSections,
        customTitle: e.customTitle,
        customSubtitles: e.customSubtitles,
        condition: e.condition,
        categoryId: e.categoryId,
        categoryPath: e.categoryPath,
        inventoryType: e.inventoryType,
        lat: e.lat,
        lng: e.lng,
        galleryTotal: e.galleryTotal,
        galleryComplete: e.galleryComplete,
        photoIds: e.photoIds,
        linksExpireAt: e.linksExpireAt ? new Date(e.linksExpireAt) : null,
        detailOutcome: detail.detailOutcome,
        staleFallback: detail.staleFallback,
        conflicts: e.conflicts,
        provenance: e.provenance,
      })),
    )
    .onConflictDoNothing({
      target: [evidence.source, evidence.sourceListingId, evidence.evidenceHash],
    })
    .returning({ id: evidence.id })
  return inserted.length
}

/**
 * A version seen again: a later fetch moves `last_seen_at` and, if it carries a gallery, replaces
 * the gallery and its link expiry (the graphql route returns none, which never erases one); an
 * earlier fetch (a late replay) moves `first_seen_at` and the raw-row reference; a fresh fetch
 * clears `stale_fallback`. A row that would not change is not written, so a replay writes nothing.
 */
export async function touchVersions(
  q: Queryable,
  source: string,
  jobId: number,
  rows: Located[],
): Promise<void> {
  if (rows.length === 0) return
  const payload = rows.map(({ detail, evidence: e }) => ({
    id: detail.sourceListingId,
    hash: e.evidenceHash,
    seen: detail.fetchedAt,
    seq: detail.seq,
    stale: detail.staleFallback,
    gallery: e.photoIds.length > 0,
    total: e.galleryTotal,
    complete: e.galleryComplete,
    photos: e.photoIds,
    expires: e.linksExpireAt,
  }))
  await q.execute(sql`
    update detail_evidence.evidence e
    set
      last_seen_at = greatest(e.last_seen_at, x.seen),
      first_seen_at = least(e.first_seen_at, x.seen),
      item_job_id = case when x.seen < e.first_seen_at then ${jobId} else e.item_job_id end,
      item_seq = case when x.seen < e.first_seen_at then x.seq else e.item_seq end,
      stale_fallback = e.stale_fallback and x.stale,
      gallery_total = case when x.gallery and x.seen > e.last_seen_at then x.total
                           else e.gallery_total end,
      gallery_complete = case when x.gallery and x.seen > e.last_seen_at then x.complete
                              else e.gallery_complete end,
      photo_ids = case when x.gallery and x.seen > e.last_seen_at
                       then array(select jsonb_array_elements_text(x.photos))
                       else e.photo_ids end,
      links_expire_at = case when x.gallery and x.seen > e.last_seen_at then x.expires
                             else e.links_expire_at end
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x (
      id text, hash text, seen timestamptz, seq integer, stale boolean, gallery boolean,
      total integer, complete boolean, photos jsonb, expires timestamptz)
    where e.source = ${source} and e.source_listing_id = x.id and e.evidence_hash = x.hash
      and (x.seen > e.last_seen_at or x.seen < e.first_seen_at
           or (e.stale_fallback and not x.stale))`)
}

/** One fetch per listing and job; a replayed job inserts nothing. */
export async function insertFetches(
  q: Queryable,
  source: string,
  jobId: number,
  rows: { listingId: string | null; detail: Detail }[],
): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await q
    .insert(fetches)
    .values(
      rows.map(({ listingId, detail }) => ({
        source,
        sourceListingId: detail.sourceListingId,
        listingId,
        jobId,
        seq: detail.seq,
        fetchedAt: new Date(detail.fetchedAt),
        detailOutcome: detail.detailOutcome,
        detailAttempts: detail.detailAttempts,
        descriptionStatus: detail.descriptionStatus,
        cacheStatus: detail.cacheStatus,
        staleFallback: detail.staleFallback,
        unresolved: detail.unresolved,
        evidenceHash: detail.evidence?.evidenceHash ?? null,
      })),
    )
    .onConflictDoNothing({ target: [fetches.source, fetches.sourceListingId, fetches.jobId] })
    .returning({ id: fetches.id })
  return inserted.length
}

/**
 * Listings whose current version this job changed: the current version chosen over every stored
 * fetch (as `v_current` chooses it) differs from the one chosen without this job's fetches. So a
 * new listing, or a fresh fetch of another text, is a change; a stale-cache fetch never replaces
 * a fresh version, and a late replay of an older run changes nothing. Derived from stored
 * fetches, so a replay finds the same IDs (or fewer, once later runs are stored; the keys are
 * the same, and the transport drops them).
 */
export async function selectChanged(q: Queryable, jobId: number): Promise<string[]> {
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      select s.listing_id
      from detail_evidence.fetches s
      cross join lateral (
        select p.evidence_hash from detail_evidence.fetches p
        where p.source = s.source and p.source_listing_id = s.source_listing_id
          and p.evidence_hash is not null
        order by p.stale_fallback, p.fetched_at desc, p.job_id desc
        limit 1
      ) now
      left join lateral (
        select p.evidence_hash from detail_evidence.fetches p
        where p.source = s.source and p.source_listing_id = s.source_listing_id
          and p.evidence_hash is not null and p.job_id <> s.job_id
        order by p.stale_fallback, p.fetched_at desc, p.job_id desc
        limit 1
      ) before on true
      where s.job_id = ${jobId}
        and s.listing_id is not null
        and s.evidence_hash is not null
        and before.evidence_hash is distinct from now.evidence_hash
      order by s.seq`),
  )
  return [...new Set(rows.map((row) => row.listing_id))]
}

/** Known listings whose fetch in this job could not identify the item. */
export async function selectUnresolved(q: Queryable, jobId: number): Promise<string[]> {
  const rows = await q
    .select({ listingId: fetches.listingId, seq: fetches.seq })
    .from(fetches)
    .where(and(eq(fetches.jobId, jobId), eq(fetches.unresolved, true)))
    .orderBy(asc(fetches.seq))
  return [...new Set(rows.flatMap((row) => (row.listingId ? [row.listingId] : [])))]
}

/** Removes the versions and fetches of these listings (rule 12, for seller-rights erasure). */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  await q.delete(fetches).where(inArray(fetches.listingId, listingIds))
  const deleted = await q
    .delete(evidence)
    .where(inArray(evidence.listingId, listingIds))
    .returning({ id: evidence.id })
  return deleted.length
}
