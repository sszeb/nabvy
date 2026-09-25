// Stripe webhooks → entitlements, billing events, consent, signals and usage grants.
//
// Two layers (README.md, "Decisions"):
//   * `createStripeWebhookRoute` wraps the Stripe plugin's endpoint: it verifies the signature
//     first (so a failure emits `subscriptions.webhook-failed`), refuses an event ID already
//     processed, and forwards the untouched body to the plugin;
//   * `processStripeEvent` runs from the plugin's `onEvent` hook, after the plugin has verified
//     the event again and updated its own `subscription` row. It is idempotent by Stripe event
//     ID: one `billing_events` row per event, written in the same transaction as its effects, so
//     a replay writes nothing. A failure rolls everything back, emits `webhook-failed` and
//     rethrows, so the plugin answers non-2xx and Stripe retries.
import { createHash } from 'node:crypto'
import { SUBSCRIPTIONS_WEBHOOK_TOLERANCE_SECONDS } from '@nabvy/config/modules/subscriptions'
import { createEvent, type EventEnvelope, Uuid } from '@nabvy/contracts'
import {
  events,
  SUBSCRIPTIONS_FREE_PLAN,
  SUBSCRIPTIONS_KIND_KEY,
  SUBSCRIPTIONS_START_NOW_KEY,
  SubscriptionsStripeCharge,
  SubscriptionsStripeCheckoutSession,
  SubscriptionsStripeCustomer,
  SubscriptionsStripeDispute,
  SubscriptionsStripeEvent,
  SubscriptionsStripeInvoice,
  SubscriptionsStripeSubscription,
  type SubscriptionsWebhookFailure,
} from '@nabvy/contracts/modules/subscriptions'
import type { Queryable } from '@nabvy/db'
import type { Publisher } from '@nabvy/transport'
import { grantAllowance, grantTopup, type UsageLedgerPolicy } from '@nabvy/usage-ledger'
import type Stripe from 'stripe'
import {
  allowanceRef,
  allowanceWindow,
  entitlementChangedKey,
  entitlementStatus,
  extraAreasOf,
  freeLimits,
  idOf,
  intervalMonthsOf,
  limitsOf,
  matchPlan,
  netCash,
  sameEntitlement,
  webhookFailedKey,
} from '../domain'
import type { SubscriptionsLadderPolicy, SubscriptionsStripePort, TrialEligibility } from '../index'
import { ladderPlans } from '../index'
import * as repo from '../repo'

export interface StripeWebhookDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline`. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  publisher: Publisher
  ladder: SubscriptionsLadderPolicy
  usagePolicy: UsageLedgerPolicy
  trialEligible: TrialEligibility
  stripe: SubscriptionsStripePort
  /** `STRIPE_PRICE_EXTRA_AREA`, or null when extra areas are not sold. */
  extraAreaPriceId: string | null
}

export interface ProcessedStripeEvent {
  /** False when the event ID was already processed: nothing was written. */
  changed: boolean
  outcome: 'applied' | 'recorded' | 'stale' | 'ignored' | 'replayed'
  userId: string | null
  /** Published after commit. */
  events: EventEnvelope[]
}

/** A processing failure with its reason code; the transaction rolls back and Stripe retries. */
export class WebhookFailure extends Error {
  constructor(readonly reason: SubscriptionsWebhookFailure) {
    super(`subscriptions: webhook ${reason}`)
    this.name = 'WebhookFailure'
  }
}

function failedEvent(
  stripeEventId: string | null,
  reason: SubscriptionsWebhookFailure,
  bodyHash = '',
): EventEnvelope {
  return createEvent(
    events,
    'subscriptions.webhook-failed',
    1,
    { stripeEventId, reason },
    { key: webhookFailedKey(stripeEventId, reason, bodyHash) },
  ) as EventEnvelope
}

function changedEvent(userId: string, stripeEventId: string): EventEnvelope {
  return createEvent(
    events,
    'subscriptions.entitlement-changed',
    1,
    { userId },
    { key: entitlementChangedKey(userId, stripeEventId) },
  ) as EventEnvelope
}

const asUser = (value: unknown): string | null =>
  Uuid.safeParse(value).success ? (value as string) : null
const toDate = (unix: number | null | undefined): Date | null =>
  unix ? new Date(unix * 1000) : null

/**
 * Processes one verified Stripe event (the plugin's `onEvent`). Publishes its events after the
 * transaction commits; on failure publishes `subscriptions.webhook-failed` and rethrows.
 */
export async function processStripeEvent(
  event: Stripe.Event | SubscriptionsStripeEvent,
  deps: StripeWebhookDeps,
): Promise<ProcessedStripeEvent> {
  const parsed = SubscriptionsStripeEvent.safeParse(event)
  let result: ProcessedStripeEvent
  try {
    if (!parsed.success) throw new WebhookFailure('processing')
    const e = parsed.data
    result = await deps.transaction((q) => applyStripeEvent(q, e, deps))
  } catch (error) {
    const reason = error instanceof WebhookFailure ? error.reason : 'processing'
    const id = parsed.success ? parsed.data.id : null
    await deps.publisher.publish([failedEvent(id, reason, id ? '' : 'malformed')])
    throw error
  }
  if (result.events.length) await deps.publisher.publish(result.events)
  return result
}

type Effects = {
  outcome: 'applied' | 'recorded' | 'stale' | 'ignored'
  userId: string | null
  events: EventEnvelope[]
  row?: Partial<repo.NewBillingEvent>
}

/** The event's effects and its `billing_events` row, in the caller's transaction. */
export async function applyStripeEvent(
  q: Queryable,
  event: SubscriptionsStripeEvent,
  deps: Omit<StripeWebhookDeps, 'transaction' | 'publisher'>,
): Promise<ProcessedStripeEvent> {
  await repo.lockEvent(q, event.id)
  if (await repo.hasEvent(q, event.id)) {
    return { changed: false, outcome: 'replayed', userId: null, events: [] }
  }
  const effects = await effectsOf(q, event, deps)
  const inserted = await repo.insertBillingEvent(q, {
    stripeEventId: event.id,
    type: event.type,
    stripeObjectId: event.data.object.id ?? null,
    userId: effects.userId,
    outcome: effects.outcome,
    stripeCreatedAt: new Date(event.created * 1000),
    ...effects.row,
  })
  if (!inserted) throw new Error(`subscriptions: event ${event.id} appeared under its lock`)
  return { changed: true, outcome: effects.outcome, userId: effects.userId, events: effects.events }
}

async function effectsOf(
  q: Queryable,
  event: SubscriptionsStripeEvent,
  deps: Omit<StripeWebhookDeps, 'transaction' | 'publisher'>,
): Promise<Effects> {
  const object = event.data.object
  switch (event.type) {
    case 'customer.created':
    case 'customer.updated': {
      const customer = SubscriptionsStripeCustomer.parse(object)
      const userId = await resolveUser(q, customer.metadata?.userId, customer.id)
      return { outcome: 'recorded', userId, events: [] }
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return subscriptionChanged(q, event, SubscriptionsStripeSubscription.parse(object), deps)
    case 'invoice.paid':
      return invoicePaid(q, event, SubscriptionsStripeInvoice.parse(object), deps.usagePolicy)
    case 'invoice.payment_failed': {
      const invoice = SubscriptionsStripeInvoice.parse(object)
      const userId = await requireUser(
        q,
        invoice.parent?.subscription_details?.metadata?.userId,
        idOf(invoice.customer),
      )
      return {
        outcome: 'recorded',
        userId,
        events: [],
        row: { signal: 'payment_failed', currency: invoice.currency ?? null },
      }
    }
    case 'charge.succeeded':
    case 'charge.failed': {
      const charge = SubscriptionsStripeCharge.parse(object)
      const customerId = idOf(charge.customer)
      const userId = customerId ? await requireUser(q, undefined, customerId) : null
      return {
        outcome: 'recorded',
        userId,
        events: [],
        row: {
          cardFingerprint: charge.payment_method_details?.card?.fingerprint ?? null,
          amountMinor: charge.amount ?? null,
          currency: charge.currency ?? null,
        },
      }
    }
    case 'charge.dispute.created': {
      const dispute = SubscriptionsStripeDispute.parse(object)
      const chargeId = idOf(dispute.charge)
      const userId = chargeId ? await repo.userForCharge(q, chargeId) : null
      if (!userId) throw new WebhookFailure('unknown_customer')
      return {
        outcome: 'recorded',
        userId,
        events: [],
        row: {
          signal: 'dispute',
          amountMinor: dispute.amount ?? null,
          currency: dispute.currency ?? null,
        },
      }
    }
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return checkoutCompleted(q, event, SubscriptionsStripeCheckoutSession.parse(object), deps)
    default:
      return { outcome: 'ignored', userId: null, events: [] }
  }
}

/**
 * The user a Stripe object belongs to: the plugin's `userId` metadata (which also links the
 * customer), else the customer link learned earlier. A customer is never moved to another user.
 */
async function resolveUser(
  q: Queryable,
  metadataUserId: unknown,
  customerId: string | null,
): Promise<string | null> {
  const userId = asUser(metadataUserId)
  if (userId) {
    if (customerId && (await repo.linkCustomer(q, customerId, userId)) !== userId) {
      throw new WebhookFailure('processing')
    }
    return userId
  }
  return customerId ? repo.customerUser(q, customerId) : null
}

async function requireUser(
  q: Queryable,
  metadataUserId: unknown,
  customerId: string | null,
): Promise<string> {
  const userId = await resolveUser(q, metadataUserId, customerId)
  if (!userId) throw new WebhookFailure('unknown_customer')
  return userId
}

async function subscriptionChanged(
  q: Queryable,
  event: SubscriptionsStripeEvent,
  sub: SubscriptionsStripeSubscription,
  deps: Omit<StripeWebhookDeps, 'transaction' | 'publisher'>,
): Promise<Effects> {
  const userId = await requireUser(
    q,
    sub.metadata?.userId ?? sub.metadata?.referenceId,
    idOf(sub.customer),
  )
  await repo.lockUser(q, userId)
  const eventAt = new Date(event.created * 1000)
  const existing = await repo.selectEntitlement(q, userId)
  const status = entitlementStatus(sub.status, event.type === 'customer.subscription.deleted')

  // Stripe does not promise order: an older event never overwrites a newer one, and a
  // subscription the user has moved on from never downgrades the current one.
  if (existing && existing.lastEventAt > eventAt) return { outcome: 'stale', userId, events: [] }
  // A deleted subscription is terminal: Stripe never revives it, so no later or same-second
  // event for it may restore the plan (review of PR #54).
  if (
    event.type !== 'customer.subscription.deleted' &&
    (await repo.subscriptionDeleted(q, sub.id))
  ) {
    return { outcome: 'stale', userId, events: [] }
  }
  if (
    existing?.stripeSubscriptionId &&
    existing.stripeSubscriptionId !== sub.id &&
    existing.status !== 'free' &&
    status === 'free'
  ) {
    return { outcome: 'stale', userId, events: [] }
  }

  const plans = await ladderPlans(q, deps.ladder)
  const match = matchPlan(
    plans,
    sub.items.data.map((item) => item.price.id),
  )
  if (status !== 'free' && !match) throw new WebhookFailure('unknown_plan')
  const limits =
    status === 'free' || !match
      ? freeLimits(plans.find((p) => p.plan === SUBSCRIPTIONS_FREE_PLAN))
      : limitsOf(match.plan, extraAreasOf(sub.items.data, deps.extraAreaPriceId))
  const item = sub.items.data[match?.itemIndex ?? 0]
  const periodStart = toDate(item?.current_period_start)
  const periodEnd = toDate(item?.current_period_end)
  const next = {
    ...limits,
    status,
    periodEnd: status === 'free' ? null : periodEnd,
    cancelAtPeriodEnd: status === 'free' ? false : (sub.cancel_at_period_end ?? false),
    trialEnd: status === 'trialing' ? toDate(sub.trial_end) : null,
  }
  await repo.upsertEntitlement(q, {
    userId,
    ...next,
    periodStart: status === 'free' ? null : periodStart,
    stripeSubscriptionId: sub.id,
    intervalMonths: periodStart && periodEnd ? intervalMonthsOf(periodStart, periodEnd) : null,
    lastEventId: event.id,
    lastEventAt: eventAt,
  })

  // account-integrity's trial check (soft): a match on an earlier trial ends this one now.
  if (
    event.type === 'customer.subscription.created' &&
    sub.status === 'trialing' &&
    !(await deps.trialEligible(q, userId))
  ) {
    await deps.stripe.endTrialNow(sub.id, `end-trial:${event.id}`)
  }

  const changed =
    !existing ||
    !sameEntitlement(next, {
      tier: existing.tier,
      status: existing.status,
      areas: existing.areas,
      wants: existing.wants,
      channels: existing.channels,
      baseCadenceSeconds: existing.baseCadenceSeconds,
      floorCadenceSeconds: existing.floorCadenceSeconds,
      policyVersion: existing.policyVersion,
      periodEnd: existing.periodEnd,
      cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
      trialEnd: existing.trialEnd,
    })
  return { outcome: 'applied', userId, events: changed ? [changedEvent(userId, event.id)] : [] }
}

/**
 * A paid subscription invoice: records the period's net cash and grants its current monthly
 * allowance through usage-ledger. Only first and renewal invoices carry an allowance; a
 * proration invoice on an upgrade is recorded only (the new plan's bundle starts at the next
 * renewal; question). A trial's £0 invoice grants nothing.
 */
async function invoicePaid(
  q: Queryable,
  event: SubscriptionsStripeEvent,
  invoice: SubscriptionsStripeInvoice,
  usagePolicy: UsageLedgerPolicy,
): Promise<Effects> {
  const details = invoice.parent?.subscription_details
  const subId = idOf(details?.subscription)
  const row = { amountMinor: invoice.amount_paid, currency: invoice.currency ?? null }
  if (!subId) return { outcome: 'recorded', userId: null, events: [], row }
  const userId = await requireUser(q, details?.metadata?.userId, idOf(invoice.customer))
  const reason = invoice.billing_reason
  if (
    invoice.amount_paid <= 0 ||
    (reason !== 'subscription_create' && reason !== 'subscription_cycle')
  ) {
    return { outcome: 'recorded', userId, events: [], row }
  }
  await repo.lockUser(q, userId)
  const entitlement = await repo.selectEntitlement(q, userId)
  if (!entitlement || entitlement.stripeSubscriptionId !== subId) {
    throw new WebhookFailure('out_of_order')
  }
  const line = invoice.lines.data[0]
  if (!line) throw new WebhookFailure('processing')
  const periodStart = new Date(line.period.start * 1000)
  const periodEnd = new Date(line.period.end * 1000)
  // A Free row with this subscription is either ended (a late invoice after `.deleted`: record
  // it, grant nothing) or not started yet (a Checkout subscription is created `incomplete`, and
  // its first invoice can beat the `.updated` that makes it `active`): fail as `out_of_order`
  // so Stripe retries once the row is active (review of PR #54, rounds 1 and 2).
  if (entitlement.status === 'free') {
    if (await repo.subscriptionDeleted(q, subId)) {
      return { outcome: 'recorded', userId, events: [], row }
    }
    throw new WebhookFailure('out_of_order')
  }
  // A late invoice never moves the period backwards.
  if (entitlement.cashPeriodStart && periodStart < entitlement.cashPeriodStart) {
    return { outcome: 'recorded', userId, events: [], row }
  }
  const intervalMonths = intervalMonthsOf(periodStart, periodEnd)
  if (!intervalMonths) throw new WebhookFailure('processing')
  const cash = netCash(invoice.amount_paid, invoice.total_taxes)
  await repo.setPeriodCash(q, userId, {
    periodStart,
    periodEnd,
    intervalMonths,
    periodCashMinor: cash,
  })

  const eventAt = new Date(event.created * 1000)
  const at = eventAt < periodStart ? periodStart : eventAt
  const window = allowanceWindow(periodStart, periodEnd, intervalMonths, at)
  if (!window) return { outcome: 'recorded', userId, events: [], row }
  const granted = await grantAllowance(
    q,
    {
      userId,
      plan: entitlement.tier,
      refId: allowanceRef(subId, window.start),
      cashMinor: Math.floor(cash / intervalMonths),
      expiresAt: window.end.toISOString(),
    },
    usagePolicy,
  )
  if (!granted.ok) {
    // Without a policy the period's cash stays recorded and the sweep grants later; ops hears now.
    if (granted.error.code === 'usage-ledger.no_policy') {
      return { outcome: 'recorded', userId, events: [failedEvent(event.id, 'no_policy')], row }
    }
    throw new WebhookFailure('processing')
  }
  return { outcome: 'applied', userId, events: [], row }
}

/**
 * A completed Checkout: stores the "Start my plan now" consent and its time with the payment
 * (docs/decisions.md, "No refunds"), and turns a paid top-up into credit. A payment without the
 * consent is still recorded (the money is taken) and reported to ops as `consent_missing`.
 */
async function checkoutCompleted(
  q: Queryable,
  event: SubscriptionsStripeEvent,
  session: SubscriptionsStripeCheckoutSession,
  deps: Omit<StripeWebhookDeps, 'transaction' | 'publisher'>,
): Promise<Effects> {
  const userId = await requireUser(
    q,
    session.client_reference_id ?? session.metadata?.userId,
    idOf(session.customer),
  )
  const tickAt = session.metadata?.[SUBSCRIPTIONS_START_NOW_KEY]
  const tickDate = tickAt && !Number.isNaN(Date.parse(tickAt)) ? new Date(tickAt) : null
  const consentStartNow = session.consent?.terms_of_service === 'accepted' && tickDate !== null
  const amount = session.amount_total ?? null
  // One session sends two events under a delayed method (`completed`, then
  // `async_payment_succeeded`): the first to arrive stores the consent and reports it missing;
  // the second only records its amount (review of PR #54, round 2).
  const consentRecorded = await repo.checkoutRecorded(q, session.id)
  const eventsOut: EventEnvelope[] =
    consentStartNow || consentRecorded ? [] : [failedEvent(event.id, 'consent_missing')]
  const row = {
    amountMinor: amount,
    currency: session.currency ?? null,
    ...(consentRecorded
      ? {}
      : {
          checkoutSessionId: session.id,
          consentStartNow,
          consentAt: tickDate ?? new Date(event.created * 1000),
        }),
  }

  // Credit only for a paid top-up: a delayed method (Bacs, bank transfer) completes the session
  // `unpaid`, and `checkout.session.async_payment_succeeded` grants later under the same refId.
  if (
    session.mode === 'payment' &&
    session.metadata?.[SUBSCRIPTIONS_KIND_KEY] === 'topup' &&
    session.payment_status === 'paid'
  ) {
    const paymentIntent = idOf(session.payment_intent)
    if (!paymentIntent || !amount) throw new WebhookFailure('processing')
    const plan = (await repo.selectEntitlement(q, userId))?.tier ?? SUBSCRIPTIONS_FREE_PLAN
    const granted = await grantTopup(
      q,
      {
        userId,
        plan,
        refId: paymentIntent,
        cashMinor: netCash(amount, [{ amount: session.total_details?.amount_tax ?? 0 }]),
      },
      deps.usagePolicy,
    )
    if (!granted.ok) {
      throw new WebhookFailure(
        granted.error.code === 'usage-ledger.no_policy' ? 'no_policy' : 'processing',
      )
    }
    return { outcome: 'applied', userId, events: eventsOut, row }
  }
  return { outcome: 'recorded', userId, events: eventsOut, row }
}

// ---------------------------------------------------------------------------------------------
// The webhook route
// ---------------------------------------------------------------------------------------------

export interface StripeWebhookRouteOptions {
  /** Verifies signatures (`stripe.webhooks`); no network call. */
  stripe: Pick<Stripe, 'webhooks'>
  /** `STRIPE_WEBHOOK_SECRET`, from `@nabvy/config`. Never logged. */
  webhookSecret: string
  /** The Better Auth handler that serves the plugin's `/stripe/webhook` endpoint. */
  forward(request: Request): Promise<Response>
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  publisher: Publisher
}

/**
 * The route apps/web mounts at `/api/auth/stripe/webhook`. Refuses a bad or stale signature
 * (Stripe's 300-second tolerance) with 400 and a `webhook-failed` event, answers an already
 * processed event ID with 200 and nothing else, and forwards the rest to the plugin. The
 * response never carries the reason, and nothing here logs the body or the secret.
 */
export function createStripeWebhookRoute(
  options: StripeWebhookRouteOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const body = await request.text()
    const signature = request.headers.get('stripe-signature') ?? ''
    let eventId: string
    try {
      const event = options.stripe.webhooks.constructEvent(
        body,
        signature,
        options.webhookSecret,
        SUBSCRIPTIONS_WEBHOOK_TOLERANCE_SECONDS,
      )
      eventId = event.id
    } catch {
      const bodyHash = createHash('sha256').update(body).digest('hex').slice(0, 32)
      await options.publisher.publish([failedEvent(null, 'signature', bodyHash)])
      return Response.json({ error: 'invalid signature' }, { status: 400 })
    }
    if (await options.transaction((q) => repo.hasEvent(q, eventId))) {
      return Response.json({ received: true })
    }
    return options.forward(
      new Request(request.url, { method: 'POST', headers: request.headers, body }),
    )
  }
}
