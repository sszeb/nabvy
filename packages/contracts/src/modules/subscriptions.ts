import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the subscriptions module (services/subscriptions): Stripe subscriptions turned
// into entitlements, the billing events kept for idempotency, consent and account-integrity's
// signals, and the user's plan. Import from '@nabvy/contracts/modules/subscriptions'.
//
// This module sets no prices (docs/decisions.md, "Paid ladder"): every plan value, Stripe price
// ID included, is a pricing-console policy row read through `SubscriptionsLadderPolicy`.

export const module = 'subscriptions'

// ---------------------------------------------------------------------------------------------
// Plans and entitlements
// ---------------------------------------------------------------------------------------------

/** A plan's name as pricing-console keys it (`free`, `starter`, `pro`, `max`, `business`). */
export const SubscriptionsPlanName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
export type SubscriptionsPlanName = z.infer<typeof SubscriptionsPlanName>

/** The plan everyone without a paid subscription is on. It has no Stripe object. */
export const SUBSCRIPTIONS_FREE_PLAN = 'free'

/** A delivery channel an entitlement allows (`telegram`, `email`, `push`, `channel-feed`). */
export const SubscriptionsChannel = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
export type SubscriptionsChannel = z.infer<typeof SubscriptionsChannel>

const count = z.int().min(0).max(100_000)
/** A cadence in seconds; `null` where the plan has none (Free runs bursts, not a cadence). */
const cadence = z
  .int()
  .min(1)
  .max(7 * 24 * 3600)
  .nullable()
const stripeId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,250}$`))

/**
 * One rung of the paid ladder as pricing-console's policy rows state it (docs/decisions.md,
 * "Paid ladder": base cadence, floor, area and want counts per tier, versioned and audited).
 * The Free row has no Stripe price. Nothing here is a constant in code.
 */
export const SubscriptionsLadderPlan = z.strictObject({
  plan: SubscriptionsPlanName,
  areas: count,
  wants: count,
  channels: z.array(SubscriptionsChannel).max(10),
  /** Included cadence for the plan's areas, funded by the fee. */
  baseCadenceSeconds: cadence,
  /** Fastest cadence a want can buy with credits. */
  floorCadenceSeconds: cadence,
  /** Free-trial days offered at Checkout, or none. */
  trialDays: z.int().min(1).max(90).nullable(),
  stripePriceId: stripeId('price').nullable(),
  stripeAnnualPriceId: stripeId('price').nullable(),
  policyVersion: z.string().min(1).max(100),
})
export type SubscriptionsLadderPlan = z.infer<typeof SubscriptionsLadderPlan>

/**
 * Where an entitlement stands. `free` covers every Stripe status that grants nothing
 * (`canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`) and deleted subscriptions.
 * `past_due` keeps the plan while Stripe's Smart Retries run (docs/billing.md, "Failed payment").
 */
export const SubscriptionsStatus = z.enum(['free', 'trialing', 'active', 'past_due'])
export type SubscriptionsStatus = z.infer<typeof SubscriptionsStatus>

/** What a user may use now (the card's `SubscriptionsEntitlement`; row of `v_entitlements`). */
export const SubscriptionsEntitlement = z.strictObject({
  userId: Uuid,
  tier: SubscriptionsPlanName,
  status: SubscriptionsStatus,
  /** The plan's areas plus paid extra areas. */
  areas: count,
  wants: count,
  channels: z.array(SubscriptionsChannel).max(10),
  baseCadenceSeconds: cadence,
  floorCadenceSeconds: cadence,
  periodEnd: IsoTimestamp.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trialEnd: IsoTimestamp.nullable(),
  /** The pricing-console policy version the limits were read at; null for the Free fallback. */
  policyVersion: z.string().nullable(),
})
export type SubscriptionsEntitlement = z.infer<typeof SubscriptionsEntitlement>

/**
 * The user's own plan, for the account page, through a procedure only. Nothing internal: no
 * Stripe IDs, no policy version, no billing signal.
 */
export const SubscriptionsPlan = SubscriptionsEntitlement.omit({
  userId: true,
  policyVersion: true,
})
export type SubscriptionsPlan = z.infer<typeof SubscriptionsPlan>

// ---------------------------------------------------------------------------------------------
// Checkout: one required tick, "Start my plan now" (docs/decisions.md, "No refunds")
// ---------------------------------------------------------------------------------------------

/** The Checkout metadata key that carries the time the user ticked "Start my plan now". */
export const SUBSCRIPTIONS_START_NOW_KEY = 'nabvy_start_now_at'
/** The Checkout metadata key that marks a usage top-up (payment mode). */
export const SUBSCRIPTIONS_KIND_KEY = 'nabvy_kind'

/** The tick's label and the disclosure, shown before purchase (owner's words; question 1). */
export const SUBSCRIPTIONS_CHECKOUT_WORDING = {
  startNow: 'Start my plan now',
  nonRefundable: 'Payments are non-refundable, except where required by law.',
} as const

const startNow = z.literal(true, { error: 'Tick "Start my plan now" to continue.' })

/** Start a subscription Checkout. `startNow` is the required tick. */
export const SubscriptionsCheckoutInput = z.strictObject({
  plan: SubscriptionsPlanName,
  annual: z.boolean().default(false),
  startNow,
})
export type SubscriptionsCheckoutInput = z.input<typeof SubscriptionsCheckoutInput>

/** Start a usage top-up Checkout for one of the packs (whole pounds; price IDs from config). */
export const SubscriptionsTopupInput = z.strictObject({
  packPounds: z.union([z.literal(5), z.literal(10), z.literal(25)]),
  startNow,
})
export type SubscriptionsTopupInput = z.input<typeof SubscriptionsTopupInput>

/** What a subscription Checkout procedure passes to Better Auth's `upgradeSubscription`. */
export const SubscriptionsUpgradeBody = z.strictObject({
  plan: SubscriptionsPlanName,
  annual: z.boolean(),
  metadata: z.strictObject({ [SUBSCRIPTIONS_START_NOW_KEY]: IsoTimestamp }),
})
export type SubscriptionsUpgradeBody = z.infer<typeof SubscriptionsUpgradeBody>

// ---------------------------------------------------------------------------------------------
// Stripe events: only the fields this module reads. Stripe's own objects carry far more; loose
// objects keep the rest out of our types without refusing it. Verified before parsing.
// ---------------------------------------------------------------------------------------------

export const SubscriptionsStripeEventId = stripeId('evt')
const unix = z.int().nonnegative()
const metadata = z.record(z.string(), z.string()).nullish()
const customerRef = z.union([z.string(), z.looseObject({ id: z.string() })]).nullish()

export const SubscriptionsStripeEvent = z.looseObject({
  id: SubscriptionsStripeEventId,
  type: z.string().min(1).max(100),
  created: unix,
  data: z.looseObject({ object: z.looseObject({ id: z.string().optional() }) }),
})
export type SubscriptionsStripeEvent = z.infer<typeof SubscriptionsStripeEvent>

export const SubscriptionsStripeSubscription = z.looseObject({
  id: stripeId('sub'),
  customer: customerRef,
  status: z.enum([
    'active',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'paused',
    'trialing',
    'unpaid',
  ]),
  cancel_at_period_end: z.boolean().nullish(),
  trial_end: unix.nullish(),
  metadata,
  items: z.looseObject({
    data: z.array(
      z.looseObject({
        price: z.looseObject({ id: z.string() }),
        quantity: z.int().nullish(),
        current_period_start: unix,
        current_period_end: unix,
      }),
    ),
  }),
})
export type SubscriptionsStripeSubscription = z.infer<typeof SubscriptionsStripeSubscription>

export const SubscriptionsStripeCheckoutSession = z.looseObject({
  id: stripeId('cs'),
  mode: z.enum(['payment', 'setup', 'subscription']),
  customer: customerRef,
  client_reference_id: z.string().nullish(),
  payment_intent: customerRef,
  amount_total: z.int().nullish(),
  currency: z.string().nullish(),
  total_details: z.looseObject({ amount_tax: z.int().nullish() }).nullish(),
  consent: z.looseObject({ terms_of_service: z.string().nullish() }).nullish(),
  metadata,
})
export type SubscriptionsStripeCheckoutSession = z.infer<typeof SubscriptionsStripeCheckoutSession>

export const SubscriptionsStripeInvoice = z.looseObject({
  id: stripeId('in'),
  customer: customerRef,
  billing_reason: z.string().nullish(),
  amount_paid: z.int(),
  currency: z.string().nullish(),
  total_taxes: z.array(z.looseObject({ amount: z.int() })).nullish(),
  parent: z
    .looseObject({
      subscription_details: z.looseObject({ subscription: customerRef, metadata }).nullish(),
    })
    .nullish(),
  lines: z.looseObject({
    data: z.array(z.looseObject({ period: z.looseObject({ start: unix, end: unix }) })),
  }),
})
export type SubscriptionsStripeInvoice = z.infer<typeof SubscriptionsStripeInvoice>

export const SubscriptionsStripeCharge = z.looseObject({
  id: stripeId('ch'),
  customer: customerRef,
  amount: z.int().nullish(),
  currency: z.string().nullish(),
  payment_method_details: z
    .looseObject({ card: z.looseObject({ fingerprint: z.string().nullish() }).nullish() })
    .nullish(),
})
export type SubscriptionsStripeCharge = z.infer<typeof SubscriptionsStripeCharge>

export const SubscriptionsStripeDispute = z.looseObject({
  id: stripeId('dp'),
  charge: customerRef,
  amount: z.int().nullish(),
  currency: z.string().nullish(),
})
export type SubscriptionsStripeDispute = z.infer<typeof SubscriptionsStripeDispute>

export const SubscriptionsStripeCustomer = z.looseObject({ id: stripeId('cus'), metadata })
export type SubscriptionsStripeCustomer = z.infer<typeof SubscriptionsStripeCustomer>

/** What account-integrity and ops read from a billing event (never shown to a user). */
export const SubscriptionsBillingSignal = z.enum(['payment_failed', 'dispute'])
export type SubscriptionsBillingSignal = z.infer<typeof SubscriptionsBillingSignal>

// ---------------------------------------------------------------------------------------------
// Events: identifiers only (rule 7)
// ---------------------------------------------------------------------------------------------

/** A user's entitlement changed: readers reload it from `v_entitlements`. */
export const SubscriptionsEntitlementChangedEvent = z.strictObject({ userId: Uuid })
export type SubscriptionsEntitlementChangedEvent = z.infer<
  typeof SubscriptionsEntitlementChangedEvent
>

/** Why a webhook failed, as a code (no text, no secrets). */
export const SubscriptionsWebhookFailure = z.enum([
  /** Signature missing, wrong or too old: nothing was processed. */
  'signature',
  /** No Nabvy account could be tied to the Stripe object yet (Stripe retries). */
  'unknown_customer',
  /** The subscription names no plan the ladder policy knows. */
  'unknown_plan',
  /** A related object has not arrived yet (Stripe retries). */
  'out_of_order',
  /** No pricing-console policy answers (top-up valuation). */
  'no_policy',
  /** Paid, but the completed Checkout carries no "Start my plan now" consent. Recorded. */
  'consent_missing',
  /** Anything else while processing. */
  'processing',
])
export type SubscriptionsWebhookFailure = z.infer<typeof SubscriptionsWebhookFailure>

/** A Stripe webhook failed verification or processing: for `ops-alerts`. */
export const SubscriptionsWebhookFailedEvent = z.strictObject({
  /** Null when the signature did not verify, so no ID can be trusted. */
  stripeEventId: SubscriptionsStripeEventId.nullable(),
  reason: SubscriptionsWebhookFailure,
})
export type SubscriptionsWebhookFailedEvent = z.infer<typeof SubscriptionsWebhookFailedEvent>

export const events = defineEvents(module, {
  'subscriptions.entitlement-changed': { 1: SubscriptionsEntitlementChangedEvent },
  'subscriptions.webhook-failed': { 1: SubscriptionsWebhookFailedEvent },
})

// ---------------------------------------------------------------------------------------------
// Errors: `subscriptions.<code>`
// ---------------------------------------------------------------------------------------------

export const SubscriptionsErrorCode = z.enum([
  /** The module is not on: no Checkout starts. */
  'subscriptions.off',
  /** The "Start my plan now" tick is missing. */
  'subscriptions.start_now_required',
  /** The account is suspended, banned or unknown. */
  'subscriptions.account_inactive',
  /** No ladder row sells this plan (or its annual price). */
  'subscriptions.unknown_plan',
  /** No pricing-console policy answers (pricing-console not built, or no row). */
  'subscriptions.no_policy',
])
export type SubscriptionsErrorCode = z.infer<typeof SubscriptionsErrorCode>

export const SubscriptionsError = z.strictObject({
  code: SubscriptionsErrorCode,
  message: z.string(),
})
export type SubscriptionsError = z.infer<typeof SubscriptionsError>

/** The message a refused Checkout shows. Standing refusals say nothing about why (decisions). */
export const SUBSCRIPTIONS_MESSAGES: Record<SubscriptionsErrorCode, string> = {
  'subscriptions.off':
    'Plans cannot be bought for a moment. Nothing was charged; please try again later.',
  'subscriptions.start_now_required': 'Tick "Start my plan now" to continue.',
  'subscriptions.account_inactive': 'This account cannot start a plan right now.',
  'subscriptions.unknown_plan': 'That plan is not on sale.',
  'subscriptions.no_policy': 'Plans cannot be bought yet. Nothing was charged.',
}
