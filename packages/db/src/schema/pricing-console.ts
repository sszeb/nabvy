import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema } from '../module-schema'

// Tables of the pricing-console module, all in the Postgres schema 'pricing_console'
// (packages/db/README.md). Only services/pricing-console writes them. Other modules read the
// v_ views below, or call the module's functions.
// After changing this file: pnpm db:generate pricing-console
//
// Every price, bundle, offer, ladder value, setting and free-tier number is a versioned row of
// `policy_rows` (docs/decisions.md, "Paid ladder": "versioned policy rows ... never a constant in
// code"). Rows are append-only: a change is a new version of (kind, key); the current row of a
// key is its highest version whose `effective_at` has passed, unless that version is `retired`.
// The card's `price_rules`, `bundles` and `offers` are the kinds `price`, `bundle` and `offer`;
// each kind's `value` is validated by its Zod schema in @nabvy/contracts/modules/pricing-console
// before it is written. Integers only inside values: credits, pence, GBP micros, basis points.

export const schema = moduleSchema('pricing-console')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

export const policyRows = schema.table(
  'policy_rows',
  {
    id: idColumn(),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    retired: boolean('retired').notNull().default(false),
    /** An offer's user, copied from its value so row-level security can hide it from others. */
    targetUserId: uuid('target_user_id'),
    effectiveAt: at('effective_at').notNull().defaultNow(),
    /** The admin who made the change; null for the seeded initial values. */
    createdBy: uuid('created_by'),
    reason: text('reason'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('policy_rows_kind_key_version_key').on(t.kind, t.key, t.version),
    index('policy_rows_target_user_id_idx').on(t.targetUserId),
    check(
      'policy_rows_kind',
      sql`${t.kind} in ('tier', 'price', 'bundle', 'offer', 'free-tier', 'setting', 'cost-basis')`,
    ),
    check('policy_rows_key', sql`${t.key} ~ '^[a-z][a-z0-9-]{0,62}$'`),
    check('policy_rows_version', sql`${t.version} >= 1`),
    check('policy_rows_value', sql`jsonb_typeof(${t.value}) = 'object'`),
    check('policy_rows_target', sql`${t.targetUserId} is null or ${t.kind} = 'offer'`),
    check('policy_rows_reason', sql`${t.reason} is null or length(${t.reason}) <= 1000`),
  ],
)

/**
 * The paid ladder, one row per current tier: the plan ceiling (base and floor cadence) for
 * want-manager, check-scheduler and the cadence slider (PricingConsoleLadderRow in contracts).
 */
export const vLadder = schema
  .view('v_ladder', {
    tier: text('tier').notNull(),
    version: integer('version').notNull(),
    baseCadenceMinutes: integer('base_cadence_minutes').notNull(),
    floorCadenceMinutes: integer('floor_cadence_minutes').notNull(),
    bundledCredits: integer('bundled_credits').notNull(),
    monthlyPriceMinor: integer('monthly_price_minor').notNull(),
    yearlyPriceMinor: integer('yearly_price_minor'),
    topupGrossMicrosPerCredit: integer('topup_gross_micros_per_credit').notNull(),
    topupNetMicrosPerCredit: integer('topup_net_micros_per_credit').notNull(),
    areas: integer('areas').notNull(),
    wants: integer('wants').notNull(),
    roundTheClock: boolean('round_the_clock').notNull(),
    effectiveAt: at('effective_at').notNull(),
  })
  .existing()

/** Current unit prices: checking actions and watching per cadence (PricingConsolePriceRow). */
export const vPrices = schema
  .view('v_prices', {
    item: text('item').notNull(),
    version: integer('version').notNull(),
    unit: text('unit').notNull(),
    credits: integer('credits').notNull(),
    cadenceMinutes: integer('cadence_minutes'),
    costBasis: text('cost_basis'),
    costUnits: integer('cost_units'),
    effectiveAt: at('effective_at').notNull(),
  })
  .existing()

/** Offers live now, while the module is not off (PricingConsoleOfferRow). */
export const vOffers = schema
  .view('v_offers', {
    offer: text('offer').notNull(),
    version: integer('version').notNull(),
    userId: uuid('user_id'),
    segment: text('segment'),
    item: text('item').notNull(),
    discountBps: integer('discount_bps').notNull(),
    startsAt: at('starts_at').notNull(),
    endsAt: at('ends_at').notNull(),
  })
  .existing()

/** The current free-tier policy (backlog 4.10a), one row; the burst shapes as JSON. */
export const vFreePolicy = schema
  .view('v_free_policy', {
    version: integer('version').notNull(),
    wantCount: integer('want_count').notNull(),
    windowCount: integer('window_count').notNull(),
    windowMinutes: integer('window_minutes').notNull(),
    resetHours: integer('reset_hours').notNull(),
    bursts: jsonb('bursts').notNull(),
    lifetimeCapPence: integer('lifetime_cap_pence').notNull(),
    userWeekCapPence: integer('user_week_cap_pence'),
    userMonthCapPence: integer('user_month_cap_pence'),
    poolDayFloorPence: integer('pool_day_floor_pence').notNull(),
    poolRevenueShareBps: integer('pool_revenue_share_bps').notNull(),
    poolWeekPence: integer('pool_week_pence'),
    poolMonthPence: integer('pool_month_pence'),
    signupsPerIpDay: integer('signups_per_ip_day'),
    signupsPerDeviceDay: integer('signups_per_device_day'),
    signupsPerEmailDomainDay: integer('signups_per_email_domain_day'),
    effectiveAt: at('effective_at').notNull(),
  })
  .existing()

/** The current numeric settings, the minimum margin among them (check-scheduler's funding rule). */
export const vSettings = schema
  .view('v_settings', {
    setting: text('setting').notNull(),
    version: integer('version').notNull(),
    value: integer('value').notNull(),
    effectiveAt: at('effective_at').notNull(),
  })
  .existing()
