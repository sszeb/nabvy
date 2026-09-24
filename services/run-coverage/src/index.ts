// Public API of the run-coverage module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/run-coverage' only, never from its internals. It judges every
// search of every run as complete, capped or degraded, so "nothing new" is never read from a bad
// search, and records each scope's first complete (or bounded) read (README.md).

import {
  RUN_COVERAGE_EVENT_BATCH_SIZE,
  RUN_COVERAGE_PAGE_ONE_RANKS,
} from '@nabvy/config/modules/run-coverage'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import type { ApifyGatewayRunKind } from '@nabvy/contracts/modules/apify-gateway'
import { events, type RunCoverageStatus } from '@nabvy/contracts/modules/run-coverage'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import { baselineBasis, chunk, judge, type Overlap, type SearchReport, searchesOf } from './domain'
import {
  countSearchSightings,
  insertOutcomes,
  type OutcomeRow,
  scopeListingIds,
  selectJob,
  selectOutcomes,
  selectPreviousRead,
  selectSourceOutcomes,
  upsertBaseline,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/run-coverage'
export { centreOf, feedTypeOf, judge, kindOf, searchesOf } from './domain'
export { runCollectedHandler } from './handlers'

const MODULE = 'run-coverage'

/** What one `assess` call did. */
export interface AssessReport {
  /** False while the module or the pipeline is off, or for a details run: nothing was written. */
  open: boolean
  jobId: number
  searches: number
  written: number
  statuses: { searchIndex: number; status: RunCoverageStatus }[]
  degraded: string[]
  /** `search-degraded` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

type Scoped = SearchReport & { centreId: string; term: string }
const scoped = (s: SearchReport): s is Scoped => s.centreId !== null && s.term !== null

/**
 * Judges every search of one collected search run (the `apify-gateway.run-collected` payload),
 * writes one row per search to `search_outcomes`, records scope baselines and returns the
 * `search-degraded` event. A details run is acknowledged and skipped. Safe to run twice: the
 * second run writes nothing and returns the same event key, which the transport drops.
 */
export async function assess(
  q: Queryable,
  input: {
    jobId: number
    kind?: ApifyGatewayRunKind
    /**
     * The last delivery attempt: judge without the gap check rather than fail when listing-ingest
     * has stored no sightings, so no run ends with no judgement at all.
     */
    lastAttempt?: boolean
  },
): Promise<Result<AssessReport, AppError>> {
  const report: AssessReport = {
    open: false,
    jobId: input.jobId,
    searches: 0,
    written: 0,
    statuses: [],
    degraded: [],
    events: [],
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)

  const job = await selectJob(q, input.jobId)
  if (!job || (job.status !== 'succeeded' && job.status !== 'failed')) {
    return err({
      code: 'run-coverage.job_not_found',
      message: `Job ${input.jobId} is not a finished job in apify_gateway.v_jobs (or the gateway is off).`,
    })
  }
  if ((input.kind ?? job.runKind) === 'details') return ok(report)
  report.open = true

  const runFailed = job.status === 'failed'
  const actorInput = job.input && typeof job.input.searchTerms !== 'undefined' ? job.input : null
  const searches = searchesOf(job.summary, await selectSourceOutcomes(q, job.id), actorInput)
  report.searches = searches.length
  const collectedAt =
    (typeof job.summary?.collectedAt === 'string' ? job.summary.collectedAt : null) ??
    job.finishedAt ??
    new Date().toISOString()

  // The gap check reads listing-ingest's sightings of this run. While listing-ingest is on but
  // has not stored them yet, fail and retry; while it is off, note the check as not run.
  const returned = searches.reduce((n, s) => n + s.listings, 0)
  let ingestOff = false
  if (!runFailed && returned > 0 && (await countSearchSightings(q, job.id)) === 0) {
    if (!input.lastAttempt && (await state(q, 'listing-ingest')) !== 'off') {
      return err({
        code: 'run-coverage.not_ingested',
        message: `Job ${job.id}: listing-ingest has not stored this run's sightings yet.`,
      })
    }
    ingestOff = true
  }

  const rows: OutcomeRow[] = []
  for (const search of searches) {
    let overlap: Overlap = { checked: false, skipped: false }
    let previousJobId: number | null = null
    if (ingestOff) overlap = { checked: false, skipped: true }
    else if (!runFailed && scoped(search) && search.kind !== 'unknown' && search.listings > 0) {
      previousJobId = await selectPreviousRead(q, search, job.id, collectedAt)
      if (previousJobId !== null) {
        const before = new Set(await scopeListingIds(q, previousJobId, search))
        const pageOne = await scopeListingIds(q, job.id, search, RUN_COVERAGE_PAGE_ONE_RANKS)
        overlap =
          before.size === 0 || pageOne.length === 0
            ? { checked: false, skipped: true }
            : { checked: true, shared: pageOne.filter((id) => before.has(id)).length }
      }
    }
    const judgement = judge(search, runFailed, overlap)
    rows.push({
      search,
      judgement,
      pageOneOverlap: overlap.checked ? overlap.shared : null,
      previousJobId,
    })
  }
  report.written = await insertOutcomes(q, job.id, collectedAt, rows)

  // Read back from the stored rows, so a replay announces exactly what the first run did.
  const stored = await selectOutcomes(q, job.id)
  // Baselines follow the stored judgements, so a replay never re-derives a different one.
  for (const row of stored) {
    const basis = baselineBasis(row)
    if (!basis || !row.centreId || !row.term) continue
    await upsertBaseline(q, {
      centreId: row.centreId,
      term: row.term,
      kind: row.kind,
      basis,
      at: collectedAt,
      jobId: job.id,
      searchIndex: row.searchIndex,
    })
  }
  report.statuses = stored.map((row) => ({
    searchIndex: row.searchIndex,
    status: row.status as RunCoverageStatus,
  }))
  report.degraded = stored.filter((row) => row.status === 'degraded').map((row) => row.id)
  report.events = chunk(report.degraded, RUN_COVERAGE_EVENT_BATCH_SIZE).map((searchIds, i) =>
    createEvent(
      events,
      'run-coverage.search-degraded',
      1,
      { jobId: job.id, searchIds },
      { key: `run-coverage.search-degraded:${job.id}:${i}` },
    ),
  ) as EventEnvelope[]
  return ok(report)
}
