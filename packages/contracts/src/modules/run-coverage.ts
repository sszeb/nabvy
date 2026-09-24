import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the run-coverage module (docs/design/modules/run-coverage.md): the judgement of
// every search of every run as complete, capped or degraded, the scope baselines, and the event
// that names degraded searches. Import from '@nabvy/contracts/modules/run-coverage'. The view rows
// are written here as Zod, as listing-ingest's are: drizzle-zod is not a dependency yet
// (services/run-coverage/README.md, "Decisions").

export const module = 'run-coverage'

/**
 * `complete`: Facebook's feed ran out (`source-no-new-listings`) on the HTTP route.
 * `capped`: our own cap stopped a healthy read (`page-cap`, `results-limit`, `time-limit`).
 * `degraded`: anything else. Never read "nothing new" from a degraded search.
 */
export const RunCoverageStatus = z.enum(['complete', 'capped', 'degraded'])
export type RunCoverageStatus = z.infer<typeof RunCoverageStatus>

/** Stop reasons the listed actor files name (`fb-scrap-engine/README.md:101-108`). */
export const RUN_COVERAGE_KNOWN_STOP_REASONS = [
  'source-no-new-listings',
  'page-cap',
  'results-limit',
  'time-limit',
] as const

/**
 * A search's stop reason. Any value the listed files do not name reads `unknown`, which counts as
 * degraded (`docs/questions.md:20`: the files do not give the full vocabulary).
 */
export const RunCoverageStopReason = z
  .enum([...RUN_COVERAGE_KNOWN_STOP_REASONS, 'unknown'])
  .catch('unknown')
export type RunCoverageStopReason = z.infer<typeof RunCoverageStopReason>

/** A search's route (`fb-scrap-engine/README.md:103-105`); any other value reads `unknown`. */
export const RunCoverageRoute = z
  .enum(['http', 'browser-fallback', 'failed', 'unknown'])
  .catch('unknown')
export type RunCoverageRoute = z.infer<typeof RunCoverageRoute>

/** Check kind, from the order Facebook used: newest first, or the default order (a sweep). */
export const RunCoverageKind = z.enum(['newest', 'sweep', 'unknown'])
export type RunCoverageKind = z.infer<typeof RunCoverageKind>

/** A complete default-order read: `short` (local feed) or `long` (nationwide). Null otherwise. */
export const RunCoverageFeedType = z.enum(['short', 'long'])
export type RunCoverageFeedType = z.infer<typeof RunCoverageFeedType>

/** Why a search is not complete, or what could not be checked. */
export const RunCoverageReason = z.enum([
  'run-failed', // the gateway job or the Apify run failed
  'route-browser-fallback',
  'route-failed',
  'route-unknown',
  'stop-unknown',
  'empty', // no listings: the listed files do not say how it differs from a failed search
  'no-page-one-overlap', // the gap check (CONTAINER_LISTINGS.md:66,190-191)
  'overlap-unchecked', // listing-ingest is off: the gap check could not run (not degraded)
  'binding-unverified', // stored, but never feeds a baseline
])
export type RunCoverageReason = z.infer<typeof RunCoverageReason>

/** `complete`: the scope's first complete scan. `bounded`: its first healthy capped read. */
export const RunCoverageBaselineBasis = z.enum(['complete', 'bounded'])
export type RunCoverageBaselineBasis = z.infer<typeof RunCoverageBaselineBasis>

const JobId = z.int().positive()
const Count = z.int().min(0)

/** One row of `run_coverage.v_search_coverage` (internal). */
export const RunCoverageSearch = z.strictObject({
  id: Uuid,
  jobId: JobId,
  searchIndex: Count,
  /** The Facebook city page the search URL was centred on; null when the URL names none. */
  centreId: z.string().nullable(),
  term: z.string().nullable(),
  kind: RunCoverageKind,
  route: RunCoverageRoute,
  stopReason: RunCoverageStopReason,
  /** The route and stop reason as the actor reported them, kept when they read `unknown`. */
  reportedRoute: z.string().nullable(),
  reportedStopReason: z.string().nullable(),
  pages: Count.nullable(),
  listings: Count,
  feedType: RunCoverageFeedType.nullable(),
  binding: z.string().nullable(),
  /** Listings on page 1 also seen by the previous healthy read of the scope; null: not checked. */
  pageOneOverlap: Count.nullable(),
  previousJobId: JobId.nullable(),
  status: RunCoverageStatus,
  reasons: z.array(RunCoverageReason),
  /** T1 of the input: the run's collection time. */
  collectedAt: IsoTimestamp,
  doneAt: IsoTimestamp,
})
export type RunCoverageSearch = z.infer<typeof RunCoverageSearch>

/** One row of `run_coverage.v_scope_baselines` (internal). */
export const RunCoverageScopeBaseline = z.strictObject({
  centreId: z.string(),
  term: z.string(),
  kind: RunCoverageKind,
  basis: RunCoverageBaselineBasis,
  /** Collection time of the read that set the baseline (for `bounded`, its first capped read). */
  firstCompleteAt: IsoTimestamp,
  jobId: JobId,
  searchIndex: Count,
})
export type RunCoverageScopeBaseline = z.infer<typeof RunCoverageScopeBaseline>

/** One row of `run_coverage.v_search_controls`: the centre, radius and order Facebook reported. */
export const RunCoverageSearchControls = z.strictObject({
  jobId: JobId,
  searchIndex: Count,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  radiusKm: z.number().nullable(),
  sort: z.string().nullable(),
})
export type RunCoverageSearchControls = z.infer<typeof RunCoverageSearchControls>

/** Degraded searches of one run: IDs of `v_search_coverage` rows, never text. */
export const RunCoverageSearchDegradedEvent = z.strictObject({
  jobId: JobId,
  searchIds: z.array(Uuid).min(1).max(500),
})
export type RunCoverageSearchDegradedEvent = z.infer<typeof RunCoverageSearchDegradedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'run-coverage.search-degraded': { 1: RunCoverageSearchDegradedEvent },
})

/** Error codes the module returns as values. */
export const RunCoverageErrorCode = z.enum([
  'run-coverage.job_not_found', // the job is not in apify_gateway.v_jobs (or the gateway is off)
  'run-coverage.not_ingested', // listing-ingest is on but has not stored this run's sightings yet
])
export type RunCoverageErrorCode = z.infer<typeof RunCoverageErrorCode>
