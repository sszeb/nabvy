// Database access: this module's own schema, run_coverage, apify-gateway's published views
// (v_jobs, v_run_summaries, v_rows) and listing-ingest's v_sightings (kind `search` only), as
// nabvy_pipeline inside withPipeline.
import { vJobs, vRows, vRunSummaries } from '@nabvy/db/schema/apify-gateway'
import { vSightings } from '@nabvy/db/schema/listing-ingest'
import { scopeBaselines, searchOutcomes } from '@nabvy/db/schema/run-coverage'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Judgement, SearchReport } from '../domain'

// A type query rather than a separate statement, as in listing-ingest's repo: the conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable
type Json = Record<string, unknown>

const iso = (value: Date | string) => new Date(value).toISOString()

export interface CollectedJob {
  id: number
  status: string
  runKind: 'search' | 'details' | null
  input: Json | null
  finishedAt: string | null
  summary: Json | null
}

/** A job as the gateway publishes it, with its whole RUN_SUMMARY when there is one. */
export async function selectJob(q: Queryable, jobId: number): Promise<CollectedJob | null> {
  const [job] = await q
    .select({
      id: vJobs.id,
      status: vJobs.status,
      runKind: vJobs.runKind,
      input: vJobs.input,
      finishedAt: vJobs.finishedAt,
      summary: vRunSummaries.summary,
    })
    .from(vJobs)
    .leftJoin(vRunSummaries, eq(vRunSummaries.jobId, vJobs.id))
    .where(eq(vJobs.id, jobId))
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    runKind: job.runKind as CollectedJob['runKind'],
    input: (job.input as Json | null) ?? null,
    finishedAt: job.finishedAt ? iso(job.finishedAt) : null,
    summary: (job.summary as Json | null) ?? null,
  }
}

/** The job's `sourceOutcome` rows, in dataset order. */
export async function selectSourceOutcomes(q: Queryable, jobId: number): Promise<Json[]> {
  const rows = await q
    .select({ item: vRows.item })
    .from(vRows)
    .where(and(eq(vRows.jobId, jobId), eq(vRows.recordType, 'sourceOutcome')))
    .orderBy(asc(vRows.seq))
  return rows.map((row) => row.item as Json)
}

/** How many feed sightings listing-ingest stored for the job. */
export async function countSearchSightings(q: Queryable, jobId: number): Promise<number> {
  const [row] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(vSightings)
    .where(and(eq(vSightings.jobId, jobId), eq(vSightings.kind, 'search')))
  return Number(row?.n ?? 0)
}

/** Listing IDs a job's search of one centre and term returned, optionally page 1 only. */
export async function scopeListingIds(
  q: Queryable,
  jobId: number,
  scope: { centreId: string; term: string },
  maxRank?: number,
): Promise<string[]> {
  const rows = await q
    .select({ listingId: vSightings.listingId })
    .from(vSightings)
    .where(
      and(
        eq(vSightings.jobId, jobId),
        eq(vSightings.kind, 'search'),
        sql`${scope.term} = any(${vSightings.terms})`,
        sql`${scope.centreId} = any(${vSightings.centreIds})`,
        maxRank === undefined ? undefined : sql`${vSightings.rank} <= ${maxRank}`,
      ),
    )
  return rows.map((row) => row.listingId)
}

/**
 * The previous healthy read of the scope: the latest earlier outcome (by collection time, then
 * job) that is not degraded, on the HTTP route, in a run that did not fail, that returned
 * listings and whose sightings listing-ingest stored (a read made while it was off has none).
 */
export async function selectPreviousRead(
  q: Queryable,
  search: SearchReport & { centreId: string; term: string },
  jobId: number,
  collectedAt: string,
): Promise<number | null> {
  const [row] = await q
    .select({ jobId: searchOutcomes.jobId })
    .from(searchOutcomes)
    .where(
      and(
        eq(searchOutcomes.centreId, search.centreId),
        eq(searchOutcomes.term, search.term),
        eq(searchOutcomes.kind, search.kind),
        eq(searchOutcomes.route, 'http'),
        sql`${searchOutcomes.status} <> 'degraded'`,
        sql`${searchOutcomes.listings} > 0`,
        sql`not ('run-failed' = any(${searchOutcomes.reasons}))`,
        sql`(${searchOutcomes.collectedAt}, ${searchOutcomes.jobId}) < (${collectedAt}::timestamptz, ${jobId})`,
        sql`exists (select 1 from ${vSightings} s where s.job_id = ${searchOutcomes.jobId} and s.kind = 'search')`,
      ),
    )
    .orderBy(sql`${searchOutcomes.collectedAt} desc, ${searchOutcomes.jobId} desc`)
    .limit(1)
  return row?.jobId ?? null
}

export interface OutcomeRow {
  search: SearchReport
  judgement: Judgement
  pageOneOverlap: number | null
  previousJobId: number | null
}

/** Writes one judgement per search; a replayed job writes nothing. Returns rows inserted. */
export async function insertOutcomes(
  q: Queryable,
  jobId: number,
  collectedAt: string,
  rows: OutcomeRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await q
    .insert(searchOutcomes)
    .values(
      rows.map(({ search, judgement, pageOneOverlap, previousJobId }) => ({
        jobId,
        searchIndex: search.searchIndex,
        centreId: search.centreId,
        term: search.term,
        kind: search.kind,
        route: search.route,
        stopReason: search.stopReason,
        reportedRoute: search.reportedRoute,
        reportedStopReason: search.reportedStopReason,
        pages: search.pages,
        listings: search.listings,
        feedType: judgement.feedType,
        binding: search.binding,
        pageOneOverlap,
        previousJobId,
        status: judgement.status,
        reasons: judgement.reasons,
        controlLatitude: search.controls.latitude,
        controlLongitude: search.controls.longitude,
        controlRadiusKm: search.controls.radiusKm,
        controlSort: search.controls.sort,
        collectedAt: new Date(collectedAt),
      })),
    )
    .onConflictDoNothing({ target: [searchOutcomes.jobId, searchOutcomes.searchIndex] })
    .returning({ id: searchOutcomes.id })
  return inserted.length
}

/** Judgements stored for the job, in search order. */
export function selectOutcomes(q: Queryable, jobId: number) {
  return q
    .select({
      id: searchOutcomes.id,
      searchIndex: searchOutcomes.searchIndex,
      status: searchOutcomes.status,
      binding: searchOutcomes.binding,
      centreId: searchOutcomes.centreId,
      term: searchOutcomes.term,
      kind: searchOutcomes.kind,
    })
    .from(searchOutcomes)
    .where(eq(searchOutcomes.jobId, jobId))
    .orderBy(asc(searchOutcomes.searchIndex))
}

/**
 * Records a scope's baseline: the first read of its basis wins (earliest collection time, then
 * job), and a `bounded` baseline is replaced once by the first `complete` scan. A complete
 * baseline never goes back to bounded. Safe to run twice.
 */
export async function upsertBaseline(
  q: Queryable,
  row: {
    centreId: string
    term: string
    kind: string
    basis: 'complete' | 'bounded'
    at: string
    jobId: number
    searchIndex: number
  },
): Promise<void> {
  const at = new Date(row.at)
  await q
    .insert(scopeBaselines)
    .values({
      centreId: row.centreId,
      term: row.term,
      kind: row.kind,
      basis: row.basis,
      firstCompleteAt: at,
      jobId: row.jobId,
      searchIndex: row.searchIndex,
    })
    .onConflictDoUpdate({
      target: [scopeBaselines.centreId, scopeBaselines.term, scopeBaselines.kind],
      set: {
        basis: sql`excluded.basis`,
        firstCompleteAt: sql`excluded.first_complete_at`,
        jobId: sql`excluded.job_id`,
        searchIndex: sql`excluded.search_index`,
      },
      setWhere: sql`(${scopeBaselines.basis} = 'bounded' and excluded.basis = 'complete')
        or (${scopeBaselines.basis} = excluded.basis
            and (excluded.first_complete_at, excluded.job_id)
                < (${scopeBaselines.firstCompleteAt}, ${scopeBaselines.jobId}))`,
    })
}
