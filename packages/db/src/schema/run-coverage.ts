import { sql } from 'drizzle-orm'
import {
  check,
  doublePrecision,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the run-coverage module, all in the Postgres schema 'run_coverage' (packages/db/README.md).
// Only services/run-coverage writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate run-coverage

export const schema = moduleSchema('run-coverage')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * One judgement per search of a run, keyed `(job_id, search_index)`: the scope (centre, term,
 * kind), what the actor reported, the gap check and the status. Facebook's reported search
 * controls are kept on the row and published through `v_search_controls`.
 */
export const searchOutcomes = schema.table(
  'search_outcomes',
  {
    id: idColumn(),
    jobId: integer('job_id').notNull(),
    searchIndex: integer('search_index').notNull(),
    centreId: text('centre_id'),
    term: text('term'),
    kind: text('kind').notNull(),
    route: text('route').notNull(),
    stopReason: text('stop_reason').notNull(),
    reportedRoute: text('reported_route'),
    reportedStopReason: text('reported_stop_reason'),
    pages: integer('pages'),
    listings: integer('listings').notNull(),
    feedType: text('feed_type'),
    binding: text('binding'),
    pageOneOverlap: integer('page_one_overlap'),
    previousJobId: integer('previous_job_id'),
    status: text('status').notNull(),
    reasons: text('reasons').array().notNull().default(sql`'{}'::text[]`),
    controlLatitude: doublePrecision('control_latitude'),
    controlLongitude: doublePrecision('control_longitude'),
    controlRadiusKm: doublePrecision('control_radius_km'),
    controlSort: text('control_sort'),
    collectedAt: at('collected_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('search_outcomes_job_search_key').on(t.jobId, t.searchIndex),
    index('search_outcomes_scope_idx').on(t.centreId, t.term, t.kind, t.collectedAt),
    check('search_outcomes_kind_check', sql`${t.kind} in ('newest', 'sweep', 'unknown')`),
    check(
      'search_outcomes_route_check',
      sql`${t.route} in ('http', 'browser-fallback', 'failed', 'unknown')`,
    ),
    check(
      'search_outcomes_stop_reason_check',
      sql`${t.stopReason} in ('source-no-new-listings', 'page-cap', 'results-limit', 'time-limit', 'unknown')`,
    ),
    check('search_outcomes_status_check', sql`${t.status} in ('complete', 'capped', 'degraded')`),
    check('search_outcomes_feed_type_check', sql`${t.feedType} in ('short', 'long')`),
    check(
      'search_outcomes_counts_check',
      sql`${t.searchIndex} >= 0 and ${t.listings} >= 0 and ${t.pages} >= 0 and ${t.pageOneOverlap} >= 0`,
    ),
  ],
)

/**
 * One baseline per scope (centre × term × check kind): the first complete scan, or, for a scope
 * whose reads stop at a cap, its first healthy capped read (`bounded`). A bounded baseline may be
 * upgraded to `complete` once; a complete one never changes.
 */
export const scopeBaselines = schema.table(
  'scope_baselines',
  {
    centreId: text('centre_id').notNull(),
    term: text('term').notNull(),
    kind: text('kind').notNull(),
    basis: text('basis').notNull(),
    firstCompleteAt: at('first_complete_at').notNull(),
    jobId: integer('job_id').notNull(),
    searchIndex: integer('search_index').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    primaryKey({ name: 'scope_baselines_pkey', columns: [t.centreId, t.term, t.kind] }),
    check('scope_baselines_kind_check', sql`${t.kind} in ('newest', 'sweep')`),
    check('scope_baselines_basis_check', sql`${t.basis} in ('complete', 'bounded')`),
  ],
)

// Published views, created by hand-written SQL (migrations/run-coverage/*_access.sql). Empty
// while the module's switch is off. Row types: `RunCoverageSearch`, `RunCoverageScopeBaseline`
// and `RunCoverageSearchControls` in @nabvy/contracts/modules/run-coverage.

/** Internal: every search judged, with its scope, route, stop reason and status. */
export const vSearchCoverage = schema
  .view('v_search_coverage', {
    id: uuid('id').notNull(),
    jobId: integer('job_id').notNull(),
    searchIndex: integer('search_index').notNull(),
    centreId: text('centre_id'),
    term: text('term'),
    kind: text('kind').notNull(),
    route: text('route').notNull(),
    stopReason: text('stop_reason').notNull(),
    reportedRoute: text('reported_route'),
    reportedStopReason: text('reported_stop_reason'),
    pages: integer('pages'),
    listings: integer('listings').notNull(),
    feedType: text('feed_type'),
    binding: text('binding'),
    pageOneOverlap: integer('page_one_overlap'),
    previousJobId: integer('previous_job_id'),
    status: text('status').notNull(),
    reasons: text('reasons').array().notNull(),
    collectedAt: at('collected_at').notNull(),
    doneAt: at('done_at').notNull(),
  })
  .existing()

/** Internal: each scope's baseline. */
export const vScopeBaselines = schema
  .view('v_scope_baselines', {
    centreId: text('centre_id').notNull(),
    term: text('term').notNull(),
    kind: text('kind').notNull(),
    basis: text('basis').notNull(),
    firstCompleteAt: at('first_complete_at').notNull(),
    jobId: integer('job_id').notNull(),
    searchIndex: integer('search_index').notNull(),
  })
  .existing()

/** Internal: the centre, radius and order Facebook reported for each search. */
export const vSearchControls = schema
  .view('v_search_controls', {
    jobId: integer('job_id').notNull(),
    searchIndex: integer('search_index').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    radiusKm: doublePrecision('radius_km'),
    sort: text('sort'),
  })
  .existing()
