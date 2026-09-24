import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema } from '../module-schema'

// Tables of the subscriptions module, all in the Postgres schema 'subscriptions'
// (packages/db/README.md). Only services/subscriptions writes them, as the pipeline (Stripe
// webhooks and the allowance sweep). Other modules read v_entitlements; account-integrity reads
// v_billing_signals. After changing this file: pnpm db:generate subscriptions
//
// Money is integer pence. Stripe IDs are kept as Stripe gives them.

export const schema = moduleSchema('subscriptions')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * One row per user who has ever had a Stripe subscription: what they may use now. A user with no
 * row is on Free. Limits are copied from the ladder policy row (with its version) when a Stripe
 * event changes the subscription.
 */
export const entitlements = schema.table(
  'entitlements',
  {
    userId: uuid('user_id').primaryKey(),
    tier: text('tier').notNull(),
    status: text('status').notNull(),
    areas: integer('areas').notNull(),
    wants: integer('wants').notNull(),
    channels: text('channels').array().notNull(),
    baseCadenceSeconds: integer('base_cadence_seconds'),
    floorCadenceSeconds: integer('floor_cadence_seconds'),
    periodStart: at('period_start'),
    periodEnd: at('period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    trialEnd: at('trial_end'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    /** 1 for monthly, 12 for annual: the allowance is monthly either way (docs/billing.md). */
    intervalMonths: smallint('interval_months'),
    /** Net cash (after tax) of the paid period in `cash_period_start`, for the allowance. */
    periodCashMinor: integer('period_cash_minor'),
    cashPeriodStart: at('cash_period_start'),
    policyVersion: text('policy_version'),
    /** The last Stripe event applied, and its `created` time: older events never overwrite. */
    lastEventId: text('last_event_id').notNull(),
    lastEventAt: at('last_event_at').notNull(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('entitlements_status_idx').on(t.status),
    check('entitlements_status', sql`${t.status} in ('free', 'trialing', 'active', 'past_due')`),
    check('entitlements_counts', sql`${t.areas} >= 0 and ${t.wants} >= 0`),
    check(
      'entitlements_interval',
      sql`${t.intervalMonths} is null or ${t.intervalMonths} in (1, 12)`,
    ),
    check('entitlements_cash', sql`${t.periodCashMinor} is null or ${t.periodCashMinor} >= 0`),
  ],
)

/** Stripe customer → Nabvy user, learned from events that carry the user (plugin metadata). */
export const customers = schema.table('customers', {
  stripeCustomerId: text('stripe_customer_id').primaryKey(),
  userId: uuid('user_id').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
})

/**
 * One row per Stripe event processed, keyed by its ID: webhook idempotency and replay refusal
 * (docs/billing.md, "Entitlements"), the "Start my plan now" consent with its time, stored with
 * the payment (docs/decisions.md, "No refunds"), and the signals account-integrity reads.
 * Append-only: a failed event writes nothing and Stripe retries it.
 */
export const billingEvents = schema.table(
  'billing_events',
  {
    id: idColumn(),
    stripeEventId: text('stripe_event_id').notNull(),
    type: text('type').notNull(),
    /** The Stripe object the event is about (`sub_…`, `ch_…`, `cs_…`), for later lookups. */
    stripeObjectId: text('stripe_object_id'),
    userId: uuid('user_id'),
    outcome: text('outcome').notNull(),
    stripeCreatedAt: at('stripe_created_at').notNull(),
    checkoutSessionId: text('checkout_session_id'),
    consentStartNow: boolean('consent_start_now'),
    consentAt: at('consent_at'),
    signal: text('signal'),
    cardFingerprint: text('card_fingerprint'),
    amountMinor: integer('amount_minor'),
    currency: text('currency'),
    processedAt: at('processed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('billing_events_stripe_event_id_key').on(t.stripeEventId),
    index('billing_events_user_id_idx').on(t.userId),
    index('billing_events_stripe_object_id_idx').on(t.stripeObjectId),
    check(
      'billing_events_outcome',
      sql`${t.outcome} in ('applied', 'recorded', 'stale', 'ignored')`,
    ),
    check(
      'billing_events_signal',
      sql`${t.signal} is null or ${t.signal} in ('payment_failed', 'dispute')`,
    ),
    check(
      'billing_events_consent',
      sql`(${t.checkoutSessionId} is null) = (${t.consentStartNow} is null) and (${t.consentStartNow} is null) = (${t.consentAt} is null)`,
    ),
  ],
)

/**
 * Internal: each user's entitlement, for want-manager, the crawl planner and the rest. Exempt
 * from the switch filter (rule 11): it always returns its rows. nabvy_pipeline only.
 */
export const vEntitlements = schema
  .view('v_entitlements', {
    userId: uuid('user_id').notNull(),
    tier: text('tier').notNull(),
    status: text('status').notNull(),
    areas: integer('areas').notNull(),
    wants: integer('wants').notNull(),
    channels: text('channels').array().notNull(),
    baseCadenceSeconds: integer('base_cadence_seconds'),
    floorCadenceSeconds: integer('floor_cadence_seconds'),
    periodEnd: at('period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull(),
    trialEnd: at('trial_end'),
    policyVersion: text('policy_version'),
    updatedAt: at('updated_at').notNull(),
  })
  .existing()

/**
 * Internal only, never user-facing: failed payments, chargebacks and card fingerprints per user,
 * for account-integrity (ban evasion) and ops. nabvy_pipeline only; rows while not off.
 */
export const vBillingSignals = schema
  .view('v_billing_signals', {
    userId: uuid('user_id').notNull(),
    failedPayments: integer('failed_payments').notNull(),
    disputes: integer('disputes').notNull(),
    lastFailedPaymentAt: at('last_failed_payment_at'),
    lastDisputeAt: at('last_dispute_at'),
    cardFingerprints: text('card_fingerprints').array().notNull(),
  })
  .existing()

export type vEntitlementsRow = typeof vEntitlements.$inferSelect
export type vBillingSignalsRow = typeof vBillingSignals.$inferSelect
