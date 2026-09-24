import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, text, timestamp } from 'drizzle-orm/pg-core'
import { moduleSchema, timestampColumns } from '../module-schema'

// Tables of the spend-governor module, all in the Postgres schema 'spend_governor' (packages/db/README.md).
// Only services/spend-governor writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate spend-governor

export const schema = moduleSchema('spend-governor')

const micros = (name: string) => bigint(name, { mode: 'number' })

/**
 * The owner's budgets. Seeded and changed by migrations only (owner decisions); the pipeline reads
 * them. Limits are integer micros of `unit` (USD, GBP, or GB of residential proxy).
 */
export const budgets = schema.table(
  'budgets',
  {
    name: text('name').primaryKey(),
    provider: text('provider'),
    unit: text('unit').notNull(),
    period: text('period').notNull(),
    limitMicros: micros('limit_micros').notNull(),
    setBy: text('set_by').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    check('budgets_name_check', sql`${t.name} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'`),
    check(
      'budgets_provider_check',
      sql`${t.provider} is null or ${t.provider} in ('apify', 'anthropic', 'ebay', 'cex')`,
    ),
    check('budgets_unit_check', sql`${t.unit} in ('USD', 'GBP', 'GB')`),
    check('budgets_period_check', sql`${t.period} = 'month'`),
    check('budgets_limit_check', sql`${t.limitMicros} > 0`),
    check('budgets_set_by_check', sql`length(${t.setBy}) > 0`),
  ],
)

/**
 * The last recompute of each budget: its level since when, and the committed spend and forecast
 * it was computed from. `valid_until` is when the row goes stale and `v_throttle` reads `hold-new`.
 */
export const throttle = schema.table(
  'throttle',
  {
    budget: text('budget').primaryKey(),
    level: text('level').notNull(),
    since: timestamp('since', { withTimezone: true }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    committedMicros: micros('committed_micros'),
    forecastMicros: micros('forecast_micros'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    ...timestampColumns(),
  },
  (t) => [
    foreignKey({ columns: [t.budget], foreignColumns: [budgets.name] }).onDelete('cascade'),
    check(
      'throttle_level_check',
      sql`${t.level} in ('none', 'slow-free', 'slow-paid', 'slow-sweeps', 'hold-new')`,
    ),
    check(
      'throttle_amounts_check',
      sql`coalesce(${t.committedMicros}, 0) >= 0 and coalesce(${t.forecastMicros}, 0) >= 0`,
    ),
    check(
      'throttle_measured_check',
      sql`(${t.committedMicros} is null) = (${t.forecastMicros} is null)`,
    ),
    check('throttle_valid_check', sql`${t.validUntil} > ${t.computedAt}`),
  ],
)

/** Budgets and where they stand (SpendGovernorBudget in @nabvy/contracts/modules/spend-governor). */
export const vBudgets = schema
  .view('v_budgets', {
    name: text('name').notNull(),
    provider: text('provider'),
    unit: text('unit').notNull(),
    period: text('period').notNull(),
    limitMicros: micros('limit_micros').notNull(),
    committedMicros: micros('committed_micros'),
    remainingMicros: micros('remaining_micros'),
    forecastMicros: micros('forecast_micros'),
    level: text('level'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }),
    setBy: text('set_by').notNull(),
  })
  .existing()

/** The level each budget imposes (SpendGovernorThrottle); fails closed at `hold-new`. */
export const vThrottle = schema
  .view('v_throttle', {
    budget: text('budget').notNull(),
    level: text('level').notNull(),
    reason: text('reason').notNull(),
    since: timestamp('since', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }),
  })
  .existing()
