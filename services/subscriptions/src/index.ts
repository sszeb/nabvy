// Public API of the subscriptions module: the functions other modules, procedures and tasks may
// call. Other modules import from '@nabvy/subscriptions' only, never from its internals.
//
// Stripe is the source of truth (docs/billing.md, "Entitlements"): no paid entitlement exists
// without a Stripe event. This module sets no prices: plan limits and Stripe price IDs are
// pricing-console policy rows read through `SubscriptionsLadderPolicy`, top-up credit through
// usage-ledger's `UsageLedgerPolicy`. There is no refund path (docs/decisions.md, "No refunds").
import { isActive } from '@nabvy/account'
import {
  SUBSCRIPTIONS_ALLOWANCE_SWEEP_BATCH,
  SUBSCRIPTIONS_START_NOW_MAX_AGE_SECONDS,
} from '@nabvy/config/modules/subscriptions'
import { err, ok, type Result, Uuid } from '@nabvy/contracts'
import {
  SubscriptionsLadderPlan as LadderPlanSchema,
  SUBSCRIPTIONS_CHECKOUT_WORDING,
  SUBSCRIPTIONS_FREE_PLAN,
  SUBSCRIPTIONS_KIND_KEY,
  SUBSCRIPTIONS_MESSAGES,
  SUBSCRIPTIONS_START_NOW_KEY,
  SubscriptionsCheckoutInput,
  type SubscriptionsEntitlement,
  type SubscriptionsError,
  type SubscriptionsErrorCode,
  type SubscriptionsLadderPlan,
  type SubscriptionsPlan,
  SubscriptionsTopupInput,
  type SubscriptionsUpgradeBody,
} from '@nabvy/contracts/modules/subscriptions'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { grantAllowance, pendingPricingConsole, type UsageLedgerPolicy } from '@nabvy/usage-ledger'
import type Stripe from 'stripe'
import { allowanceRef, allowanceWindow, freeLimits, startNowValid } from './domain'
import * as repo from './repo'

export { events, module } from '@nabvy/contracts/modules/subscriptions'
export { accountDeletedHandler } from './handlers/account-deleted'
export {
  type StripePluginDeps,
  type SubscriptionsStripeEnv,
  stripePluginOptions,
  subscriptionsStripeFromEnv,
} from './handlers/plugin'
export {
  createStripeWebhookRoute,
  type ProcessedStripeEvent,
  processStripeEvent,
  type StripeWebhookDeps,
  type StripeWebhookRouteOptions,
} from './handlers/stripe'

const refuse = (code: SubscriptionsErrorCode): Result<never, SubscriptionsError> =>
  err({ code, message: SUBSCRIPTIONS_MESSAGES[code] })

// ---------------------------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------------------------

/**
 * The paid ladder (docs/decisions.md, "Paid ladder"): every plan's areas, wants, channels, base
 * cadence, floor, trial and Stripe price IDs, as versioned pricing-console policy rows. The
 * `free` row, if present, gives Free's limits. `pricing-console` provides the implementation.
 */
export interface SubscriptionsLadderPolicy {
  plans(q: Queryable): Promise<readonly SubscriptionsLadderPlan[]>
}

/**
 * The documented stub until pricing-console ships: no rows, so no plan is on sale (Checkout is
 * refused with `subscriptions.no_policy`), Free uses the fallback in `@nabvy/config`, and a
 * Stripe subscription naming a plan fails as `unknown_plan` for ops to see.
 */
export const pendingPricingConsoleLadder: SubscriptionsLadderPolicy = { plans: async () => [] }

/** Reads and validates the ladder's rows. */
export async function ladderPlans(
  q: Queryable,
  ladder: SubscriptionsLadderPolicy,
): Promise<SubscriptionsLadderPlan[]> {
  return (await ladder.plans(q)).map((row) => LadderPlanSchema.parse(row))
}

/**
 * account-integrity's trial check (card: `accountIntegrity.checkTrialKeys(userId)`): false when
 * an earlier trial's card, email or device key matches, and the new trial then ends at once.
 * A soft dependency: absent, or with its module off, the trial is allowed.
 */
export type TrialEligibility = (q: Queryable, userId: string) => Promise<boolean>

/** Used until account-integrity merges: every trial is allowed. */
export const allowTrialWhenAbsent: TrialEligibility = async () => true

/** Wraps account-integrity's check so an off module allows (rule 11: readers carry on). */
export function trialEligibilityWithSwitch(check: TrialEligibility): TrialEligibility {
  return async (q, userId) =>
    (await state(q, 'account-integrity')) === 'off' ? true : check(q, userId)
}

/** The few Stripe calls this module makes itself, so tests run on recorded fixtures only. */
export interface SubscriptionsStripePort {
  /**
   * Ends a trial at once and charges the first period (`trial_end: 'now'`). `idempotencyKey` is
   * derived from the Stripe event, so a retried event never repeats the call.
   */
  endTrialNow(stripeSubscriptionId: string, idempotencyKey: string): Promise<void>
  /** Opens a top-up Checkout (payment mode). */
  createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
  ): Promise<{ id: string; url: string | null }>
}

/** The real port over the Stripe SDK. */
export function stripePort(stripe: Stripe): SubscriptionsStripePort {
  return {
    async endTrialNow(id, idempotencyKey) {
      await stripe.subscriptions.update(id, { trial_end: 'now' }, { idempotencyKey })
    },
    async createCheckoutSession(params) {
      const session = await stripe.checkout.sessions.create(params)
      return { id: session.id, url: session.url }
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------------

/**
 * Checkout's consent parameters, for subscriptions, trials and top-ups alike: one required tick
 * inside Stripe Checkout with the "Start my plan now" wording and the non-refundable disclosure
 * (docs/decisions.md, "No refunds"), and Stripe Tax (prices include UK VAT).
 */
export function checkoutConsentParams(): Pick<
  Stripe.Checkout.SessionCreateParams,
  'consent_collection' | 'custom_text' | 'automatic_tax'
> {
  return {
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: {
        message: `${SUBSCRIPTIONS_CHECKOUT_WORDING.startNow}. ${SUBSCRIPTIONS_CHECKOUT_WORDING.nonRefundable}`,
      },
    },
    automatic_tax: { enabled: true },
  }
}

/**
 * Whether this user may open a Checkout now: the module is on (when off, no Checkout starts),
 * the account is in good standing (a banned or suspended account cannot reach Checkout), and the
 * "Start my plan now" tick is present and fresh. Used by the procedures and, again, by the
 * Stripe plugin's own Checkout endpoint, so a client calling it directly is refused too.
 */
export async function checkoutGate(
  q: Queryable,
  userId: string,
  startNowAt: unknown,
  now: Date = new Date(),
): Promise<Result<void, SubscriptionsError>> {
  Uuid.parse(userId)
  if ((await state(q, 'subscriptions')) !== 'on') return refuse('subscriptions.off')
  if (!startNowValid(startNowAt, now, SUBSCRIPTIONS_START_NOW_MAX_AGE_SECONDS)) {
    return refuse('subscriptions.start_now_required')
  }
  if (!(await isActive(q, userId))) return refuse('subscriptions.account_inactive')
  return ok(undefined)
}

/**
 * Starts a subscription Checkout: checks the tick, the switch, standing and that the ladder
 * sells the plan, and returns the body the procedure passes to Better Auth's
 * `upgradeSubscription` (which creates the Checkout Session with `stripePluginOptions`).
 */
export async function startCheckout(
  q: Queryable,
  userId: string,
  input: SubscriptionsCheckoutInput,
  ladder: SubscriptionsLadderPolicy = pendingPricingConsoleLadder,
  now: Date = new Date(),
): Promise<Result<SubscriptionsUpgradeBody, SubscriptionsError>> {
  const parsed = SubscriptionsCheckoutInput.safeParse(input)
  if (!parsed.success) {
    const tick = parsed.error.issues.some((issue) => issue.path[0] === 'startNow')
    if (tick) return refuse('subscriptions.start_now_required')
    throw parsed.error
  }
  const startNowAt = now.toISOString()
  const gate = await checkoutGate(q, userId, startNowAt, now)
  if (!gate.ok) return gate
  const plans = await ladderPlans(q, ladder)
  if (plans.length === 0) return refuse('subscriptions.no_policy')
  const row = plans.find((p) => p.plan === parsed.data.plan && p.plan !== SUBSCRIPTIONS_FREE_PLAN)
  const price = parsed.data.annual ? row?.stripeAnnualPriceId : row?.stripePriceId
  if (!row || !price) return refuse('subscriptions.unknown_plan')
  return ok({
    plan: row.plan,
    annual: parsed.data.annual,
    metadata: { [SUBSCRIPTIONS_START_NOW_KEY]: startNowAt },
  })
}

export interface TopupDeps {
  stripe: SubscriptionsStripePort
  /** The pack price IDs, from `STRIPE_PRICE_TOPUP_*` (docs/secrets.md). */
  topupPrices: Readonly<Record<5 | 10 | 25, string>>
  usagePolicy?: UsageLedgerPolicy
  ladder?: SubscriptionsLadderPolicy
  successUrl: string
  cancelUrl: string
}

/**
 * Opens a usage top-up Checkout (payment mode) for one pack, with the same required tick. Refused
 * unless pricing-console can value the pack for the user's plan, so a paid top-up always turns
 * into credit when its webhook arrives.
 */
export async function startTopup(
  q: Queryable,
  userId: string,
  input: SubscriptionsTopupInput,
  deps: TopupDeps,
  now: Date = new Date(),
): Promise<Result<{ checkoutSessionId: string; url: string | null }, SubscriptionsError>> {
  const parsed = SubscriptionsTopupInput.safeParse(input)
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === 'startNow')) {
      return refuse('subscriptions.start_now_required')
    }
    throw parsed.error
  }
  const startNowAt = now.toISOString()
  const gate = await checkoutGate(q, userId, startNowAt, now)
  if (!gate.ok) return gate
  const plan = (await getEntitlement(q, userId, deps.ladder)).tier
  const cashMinor = parsed.data.packPounds * 100
  const quote = await (deps.usagePolicy ?? pendingPricingConsole).topupCredits(q, plan, cashMinor)
  if (!quote) return refuse('subscriptions.no_policy')
  const customer = await repo.userCustomer(q, userId)
  const metadata = {
    userId,
    [SUBSCRIPTIONS_KIND_KEY]: 'topup',
    [SUBSCRIPTIONS_START_NOW_KEY]: startNowAt,
  }
  const session = await deps.stripe.createCheckoutSession({
    ...checkoutConsentParams(),
    mode: 'payment',
    line_items: [{ price: deps.topupPrices[parsed.data.packPounds], quantity: 1 }],
    ...(customer ? { customer } : { customer_creation: 'always' }),
    client_reference_id: userId,
    metadata,
    payment_intent_data: { metadata },
    success_url: deps.successUrl,
    cancel_url: deps.cancelUrl,
  })
  return ok({ checkoutSessionId: session.id, url: session.url })
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

function toEntitlement(row: repo.EntitlementRow): SubscriptionsEntitlement {
  return {
    userId: row.userId,
    tier: row.tier,
    status: row.status as SubscriptionsEntitlement['status'],
    areas: row.areas,
    wants: row.wants,
    channels: row.channels,
    baseCadenceSeconds: row.baseCadenceSeconds,
    floorCadenceSeconds: row.floorCadenceSeconds,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    trialEnd: row.trialEnd?.toISOString() ?? null,
    policyVersion: row.policyVersion,
  }
}

/**
 * A user's entitlement now: their row, or Free (the ladder's `free` row, else the fallback).
 * Whatever the switch says: entitlements already granted stay (card, "When off").
 */
export async function getEntitlement(
  q: Queryable,
  userId: string,
  ladder: SubscriptionsLadderPolicy = pendingPricingConsoleLadder,
): Promise<SubscriptionsEntitlement> {
  Uuid.parse(userId)
  const row = await repo.selectEntitlement(q, userId)
  if (row) return toEntitlement(row)
  const free = freeLimits(
    (await ladderPlans(q, ladder)).find((p) => p.plan === SUBSCRIPTIONS_FREE_PLAN),
  )
  return {
    userId,
    status: 'free',
    ...free,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
  }
}

/**
 * The signed-in user's plan, for the account page: through an oRPC procedure inside
 * withUser(userId) only (RLS limits the read to the user's own row). No Stripe IDs, no policy
 * version, and never a billing signal.
 */
export async function getPlan(
  q: Queryable,
  userId: string,
  ladder: SubscriptionsLadderPolicy = pendingPricingConsoleLadder,
): Promise<SubscriptionsPlan> {
  const {
    userId: _userId,
    policyVersion: _version,
    ...plan
  } = await getEntitlement(q, userId, ladder)
  return plan
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

/**
 * The monthly allowance sweep, one batch of up to 500 paid entitlements after `after` (pipeline
 * job; pass back `next` until it is null). Grants each one's current window through
 * usage-ledger (idempotent on the window's refId), so annual plans get a monthly allowance and a
 * missed renewal webhook is caught up. Writes nothing while the module is off.
 */
export async function grantDueAllowances(
  q: Queryable,
  options: { after?: string | null; now?: Date; usagePolicy?: UsageLedgerPolicy } = {},
): Promise<{ granted: number; unchanged: number; refused: number; next: string | null }> {
  const counts = { granted: 0, unchanged: 0, refused: 0 }
  if ((await state(q, 'subscriptions')) === 'off') return { ...counts, next: null }
  const now = options.now ?? new Date()
  const due = await repo.dueAllowances(
    q,
    options.after ?? null,
    SUBSCRIPTIONS_ALLOWANCE_SWEEP_BATCH,
  )
  for (const row of due) {
    const window =
      row.periodStart && row.periodEnd && row.intervalMonths && row.stripeSubscriptionId
        ? allowanceWindow(row.periodStart, row.periodEnd, row.intervalMonths, now)
        : null
    if (!window || !row.stripeSubscriptionId || !row.intervalMonths) continue
    const result = await grantAllowance(
      q,
      {
        userId: row.userId,
        plan: row.tier,
        refId: allowanceRef(row.stripeSubscriptionId, window.start),
        cashMinor: Math.floor((row.periodCashMinor ?? 0) / row.intervalMonths),
        expiresAt: window.end.toISOString(),
      },
      options.usagePolicy ?? pendingPricingConsole,
    )
    if (!result.ok) counts.refused += 1
    else if (result.value.changed) counts.granted += 1
    else counts.unchanged += 1
  }
  const next =
    due.length === SUBSCRIPTIONS_ALLOWANCE_SWEEP_BATCH ? (due.at(-1)?.userId ?? null) : null
  return { ...counts, next }
}

/**
 * Erases this module's user rows on `account.deleted` (rule 12): the entitlement. Billing events
 * and the customer link are kept, because they hold the consent a chargeback is answered with
 * (question in docs/questions/subscriptions.md). Runs whatever the switch says. Idempotent.
 */
export async function purge(
  q: Queryable,
  userIds: readonly string[],
): Promise<{ entitlements: number }> {
  for (const id of userIds) Uuid.parse(id)
  return { entitlements: await repo.deleteEntitlements(q, userIds) }
}
