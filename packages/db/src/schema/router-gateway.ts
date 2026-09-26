import { sql } from 'drizzle-orm'
import { check, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema } from '../module-schema'

// Tables of the router-gateway module, all in the Postgres schema 'router_gateway'
// (packages/db/README.md). Only services/router-gateway writes them. No view: nothing else reads
// the call log. No coordinate column, ever (docs/design/modules/router-gateway.md).
// After changing this file: pnpm db:generate router-gateway

export const schema = moduleSchema('router-gateway')

const PROVIDERS = `('openrouteservice', 'osrm')`
const KINDS = `('table', 'route', 'health')`
const STATUSES = `('pending', 'ok', 'refused_quota', 'provider_quota', 'http_error', 'invalid_response', 'timeout', 'network_error')`

/**
 * One row per call attempt: the quota counter and the call log. Holds provider, kind, how many
 * locations were sent, latency, outcome and the data build the provider reported; never a
 * coordinate, a key or a response body.
 */
export const routerCalls = schema.table(
  'router_calls',
  {
    id: idColumn(),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    locationCount: integer('location_count').notNull(),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    build: text('build'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('router_calls_quota_idx').on(t.provider, t.kind, t.at),
    check('router_calls_provider_check', sql.raw(`provider in ${PROVIDERS}`)),
    check('router_calls_kind_check', sql.raw(`kind in ${KINDS}`)),
    check('router_calls_status_check', sql.raw(`status in ${STATUSES}`)),
    check('router_calls_location_count_check', sql`${t.locationCount} >= 0`),
    check('router_calls_latency_check', sql`${t.latencyMs} is null or ${t.latencyMs} >= 0`),
    check('router_calls_build_check', sql`${t.build} is null or length(${t.build}) <= 100`),
  ],
)
