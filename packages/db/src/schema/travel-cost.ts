import { sql } from 'drizzle-orm'
import {
  check,
  date,
  doublePrecision,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the travel-cost module, all in the Postgres schema 'travel_cost'
// (packages/db/README.md). Only services/travel-cost writes them. Other modules read dated rates
// through v_rates, and a user's own settings through this module's exported `params()`/`tripCost()`
// functions (rule 12 of docs/design/modules/_rules.md), never this schema directly.
// After changing this file: pnpm db:generate travel-cost

export const schema = moduleSchema('travel-cost')

/**
 * One dated, sourced rate row (services/travel-cost/README.md, "Job"): an HMRC advisory fuel rate,
 * an HMRC approved mileage rate, or the default value of time. `fuel`/`engineBand`/`tier` are
 * empty string where they do not apply to `kind`, not null, so the uniqueness below holds without
 * Postgres's null-is-distinct rule silently admitting a duplicate. Rows are never updated or
 * deleted: a new rate is a new row, so `tripCost`/`params` always price a trip at the rate that
 * held on the date they ask for.
 */
export const travelRates = schema.table(
  'travel_rates',
  {
    id: idColumn(),
    kind: text('kind').notNull(),
    fuel: text('fuel').notNull().default(''),
    engineBand: text('engine_band').notNull().default(''),
    tier: text('tier').notNull().default(''),
    penceAmount: integer('pence_amount').notNull(),
    unit: text('unit').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    sourceUrl: text('source_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('travel_rates_kind_fuel_band_tier_effective_idx').on(
      t.kind,
      t.fuel,
      t.engineBand,
      t.tier,
      t.effectiveFrom,
    ),
    check(
      'travel_rates_kind',
      sql`${t.kind} in ('advisory-fuel-rate', 'approved-mileage-rate', 'value-of-time')`,
    ),
    check('travel_rates_unit', sql`${t.unit} in ('mile', 'hour')`),
    check('travel_rates_fuel', sql`${t.fuel} in ('', 'petrol', 'diesel', 'lpg', 'electric')`),
    check('travel_rates_tier', sql`${t.tier} in ('', 'standard', 'reduced')`),
    check('travel_rates_pence_amount_positive', sql`${t.penceAmount} > 0`),
  ],
)

/**
 * One row per user (RLS): the trip-cost preset and the settings that override the module's config
 * defaults (packages/config/src/modules/travel-cost.ts). Card: "each user's preset (fuel-only,
 * HMRC business rate, or custom), fuel/engine band, value of time (including £0), speed and
 * traffic factor."
 */
export const userTravelSettings = schema.table(
  'user_travel_settings',
  {
    userId: uuid('user_id').primaryKey(),
    preset: text('preset').notNull().default('fuel-only'),
    fuel: text('fuel'),
    engineBand: text('engine_band'),
    custom: jsonb('custom'), // TravelCustomRate; only used while preset = 'custom'
    valueOfTimePenceHour: integer('value_of_time_pence_hour'),
    roadFactor: doublePrecision('road_factor'),
    speedMph: doublePrecision('speed_mph'),
    ...timestampColumns(),
  },
  (t) => [
    check(
      'user_travel_settings_preset',
      sql`${t.preset} in ('fuel-only', 'hmrc-business', 'custom')`,
    ),
    check(
      'user_travel_settings_fuel',
      sql`${t.fuel} is null or ${t.fuel} in ('petrol', 'diesel', 'lpg', 'electric')`,
    ),
    check(
      'user_travel_settings_value_of_time_non_negative',
      sql`${t.valueOfTimePenceHour} is null or ${t.valueOfTimePenceHour} >= 0`,
    ),
    check(
      'user_travel_settings_road_factor_positive',
      sql`${t.roadFactor} is null or ${t.roadFactor} > 0`,
    ),
    check('user_travel_settings_speed_positive', sql`${t.speedMph} is null or ${t.speedMph} > 0`),
  ],
)

/**
 * Internal: every dated rate row, for modules that declare `travel-cost` as a dependency
 * (rule 5 of docs/design/modules/_rules.md). Public reference data, no user rows — the card names
 * this the public rate table, but no module has created the `app` schema yet (services/account's
 * README, "Decisions"), so this stays internal until the web app's oRPC layer exists to build
 * `app.v_travel_rates` from it, per the same precedent.
 */
export const vRates = schema
  .view('v_rates', {
    kind: text('kind').notNull(),
    fuel: text('fuel').notNull(),
    engineBand: text('engine_band').notNull(),
    tier: text('tier').notNull(),
    penceAmount: integer('pence_amount').notNull(),
    unit: text('unit').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    sourceUrl: text('source_url').notNull(),
  })
  .existing()
