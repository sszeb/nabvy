import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { moduleSchema, timestampColumns } from '../module-schema'

// Tables of the scan-lookup module, all in the Postgres schema 'scan_lookup' (packages/db/README.md).
// Only services/scan-lookup writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate scan-lookup

export const schema = moduleSchema('scan-lookup')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * One row per priced scan (docs/design/modules/scan-lookup.md, "Owns"). `scan_id` is
 * scan-recognition's own scan ID, so a replayed lookup finds its row and never recharges.
 * `bands` is a frozen snapshot of the asking-price-index figures at `at`: asking-price-index may
 * rewrite its own stats later, but this scan's shown price never changes underfoot. No column
 * holds an invented number: every band comes from a real comparables query (CLAUDE.md).
 */
export const lookups = schema.table(
  'lookups',
  {
    scanId: uuid('scan_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    catalogueId: text('catalogue_id').notNull(),
    status: text('status').notNull(),
    sources: text('sources').array().notNull().default(sql`'{}'::text[]`),
    bands: jsonb('bands').notNull().default(sql`'[]'::jsonb`),
    cost: integer('cost').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    at: at('at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    index('lookups_user_id_idx').on(t.userId),
    check('lookups_status_check', sql`${t.status} in ('priced', 'not_enough_asks')`),
    check('lookups_cost_check', sql`${t.cost} >= 0`),
    check('lookups_latency_check', sql`${t.latencyMs} >= 0`),
  ],
)

// Published view, created by hand-written SQL (migrations/scan-lookup/*_access.sql). Empty while
// the module's switch is off. Row type: ScanLookupInternalResult in
// @nabvy/contracts/modules/scan-lookup.

/** Internal: every scan's lookup, for every user (nabvy_pipeline; ops-metrics and the like). */
export const vResults = schema
  .view('v_results', {
    scanId: uuid('scan_id').notNull(),
    userId: uuid('user_id').notNull(),
    catalogueId: text('catalogue_id').notNull(),
    status: text('status').notNull(),
    sources: text('sources').array().notNull(),
    bands: jsonb('bands').notNull(),
    cost: integer('cost').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    at: at('at').notNull(),
  })
  .existing()
