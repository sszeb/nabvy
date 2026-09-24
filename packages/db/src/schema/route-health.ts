import type { RouteHealthState } from '@nabvy/contracts/modules/route-health'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema } from '../module-schema'

// Tables of the route-health module, all in the Postgres schema 'route_health'
// (packages/db/README.md). Only services/route-health writes them. Other modules import only the
// view (v-prefixed export). After changing this file: pnpm db:generate route-health

export const schema = moduleSchema('route-health')

/**
 * One row per region: the decision state `recommendDetailRoute` needs to resume between calls
 * (docs/design/modules/route-health.md). `state` is the whole `RouteHealthState`, including its
 * `lastDecision`, so `v_decisions` and `recommendRoute` read the same snapshot the domain function
 * wrote. `region_id` is the primary key: one row per region, upserted on every run.
 */
export const routeState = schema.table('route_state', {
  regionId: text('region_id').primaryKey(),
  state: jsonb('state').$type<RouteHealthState>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * History of detail runs per region, tagged by Apify run ID so a retried scheduler tick cannot
 * count a run twice (card: "One history entry per run"). `detail_route` holds the run's
 * `RUN_SUMMARY.detailRoute` stats (minus the run ID, stored in its own column). At least 11 rows
 * are kept per region (windowRuns + 1, the most the domain function ever looks back); older rows
 * are pruned by the repo after each insert.
 */
export const routeRuns = schema.table(
  'route_runs',
  {
    id: idColumn(),
    regionId: text('region_id').notNull(),
    apifyRunId: text('apify_run_id').notNull(),
    detailRoute: jsonb('detail_route').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('route_runs_apify_run_id_key').on(t.apifyRunId),
    index('route_runs_region_at_idx').on(t.regionId, t.at),
  ],
)

/** Internal view: each region's latest decision. Declared here, created by hand-written SQL. */
export const vDecisions = schema
  .view('v_decisions', {
    regionId: text('region_id'),
    route: text('route'),
    reason: text('reason'),
    successRate: numeric('success_rate', { precision: 5, scale: 4 }),
    attempts: integer('attempts'),
    newQueryIds: jsonb('new_query_ids').$type<string[]>(),
    alert: boolean('alert'),
    at: timestamp('at', { withTimezone: true }),
  })
  .existing()
