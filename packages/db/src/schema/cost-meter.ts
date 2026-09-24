import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the cost-meter module, all in the Postgres schema 'cost_meter' (packages/db/README.md).
// Only services/cost-meter writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate cost-meter

export const schema = moduleSchema('cost-meter')

const micros = (name: string) => bigint(name, { mode: 'number' })

/**
 * One row per paid or counted provider call: an Apify run (reserved, then settled), a model call
 * (settled when it returns) or a free eBay or CeX call (settled at zero). Amounts are integer
 * micros of `currency`, beside their GBP conversion at `usd_gbp_rate` (services/cost-meter/README.md).
 */
export const providerCalls = schema.table(
  'provider_calls',
  {
    id: idColumn(),
    module: text('module').notNull(),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    refId: text('ref_id').notNull(),
    currency: text('currency').notNull(),
    reservedMicros: micros('reserved_micros').notNull(),
    settledMicros: micros('settled_micros'),
    usdGbpRate: numeric('usd_gbp_rate', { precision: 12, scale: 6 }).notNull(),
    reservedGbpMicros: micros('reserved_gbp_micros').notNull(),
    settledGbpMicros: micros('settled_gbp_micros'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('provider_calls_provider_ref_id_key').on(t.provider, t.refId),
    index('provider_calls_at_idx').on(t.at),
    check(
      'provider_calls_provider_check',
      sql`${t.provider} in ('apify', 'anthropic', 'ebay', 'cex')`,
    ),
    check('provider_calls_kind_check', sql`${t.kind} in ('actor_run', 'model_call', 'api_call')`),
    check('provider_calls_currency_check', sql`${t.currency} in ('USD', 'GBP')`),
    check('provider_calls_status_check', sql`${t.status} in ('pending', 'succeeded', 'failed')`),
    check(
      'provider_calls_amounts_check',
      sql`${t.reservedMicros} >= 0 and ${t.reservedGbpMicros} >= 0 and coalesce(${t.settledMicros}, 0) >= 0 and coalesce(${t.settledGbpMicros}, 0) >= 0 and ${t.usdGbpRate} > 0`,
    ),
    check(
      'provider_calls_settlement_check',
      sql`(${t.settledAt} is null) = (${t.settledMicros} is null) and (${t.settledAt} is null) = (${t.settledGbpMicros} is null)`,
    ),
    check('provider_calls_latency_check', sql`${t.latencyMs} is null or ${t.latencyMs} >= 0`),
  ],
)

/** The ledger other modules read (CostMeterCall in @nabvy/contracts/modules/cost-meter). */
export const vCosts = schema
  .view('v_costs', {
    id: uuid('id').notNull(),
    module: text('module').notNull(),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    refId: text('ref_id').notNull(),
    currency: text('currency').notNull(),
    reservedMicros: micros('reserved_micros').notNull(),
    settledMicros: micros('settled_micros'),
    reservedGbpMicros: micros('reserved_gbp_micros').notNull(),
    settledGbpMicros: micros('settled_gbp_micros'),
    countedGbpMicros: micros('counted_gbp_micros').notNull(),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    at: timestamp('at', { withTimezone: true }).notNull(),
  })
  .existing()
