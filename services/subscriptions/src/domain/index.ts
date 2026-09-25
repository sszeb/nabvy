// Pure rules of the subscriptions module: the entitlement matrix, plan matching, the monthly
// allowance window, and the keys. No I/O.
import { SUBSCRIPTIONS_FREE_FALLBACK } from '@nabvy/config/modules/subscriptions'
import {
  SUBSCRIPTIONS_FREE_PLAN,
  type SubscriptionsLadderPlan,
  type SubscriptionsStatus,
  type SubscriptionsStripeSubscription,
} from '@nabvy/contracts/modules/subscriptions'

/** The limits an entitlement carries, copied from a ladder row. */
export interface Limits {
  tier: string
  areas: number
  wants: number
  channels: string[]
  baseCadenceSeconds: number | null
  floorCadenceSeconds: number | null
  policyVersion: string | null
}

/**
 * The entitlement matrix, Stripe status → what the user keeps (docs/billing.md, "Flows"):
 * `active` and `trialing` grant the plan; `past_due` keeps it while Smart Retries run; every
 * other status, and a deleted subscription, is Free. A cancellation at the period end keeps
 * `active` until Stripe deletes the subscription, so access runs to the end of the paid period
 * (docs/decisions.md, "No refunds": "access continues until then").
 */
export function entitlementStatus(
  stripeStatus: SubscriptionsStripeSubscription['status'],
  deleted: boolean,
): SubscriptionsStatus {
  if (deleted) return 'free'
  if (stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due') {
    return stripeStatus
  }
  return 'free'
}

/** Free limits: the policy's `free` row, or the documented fallback until pricing-console. */
export function freeLimits(row: SubscriptionsLadderPlan | undefined): Limits {
  if (row) return limitsOf(row, 0)
  return {
    tier: SUBSCRIPTIONS_FREE_PLAN,
    areas: SUBSCRIPTIONS_FREE_FALLBACK.areas,
    wants: SUBSCRIPTIONS_FREE_FALLBACK.wants,
    channels: [...SUBSCRIPTIONS_FREE_FALLBACK.channels],
    baseCadenceSeconds: null,
    floorCadenceSeconds: null,
    policyVersion: null,
  }
}

/** A paid plan's limits, plus paid extra areas (docs/billing.md: "plus extra-area quantity"). */
export function limitsOf(row: SubscriptionsLadderPlan, extraAreas: number): Limits {
  return {
    tier: row.plan,
    areas: row.areas + extraAreas,
    wants: row.wants,
    channels: [...row.channels],
    baseCadenceSeconds: row.baseCadenceSeconds,
    floorCadenceSeconds: row.floorCadenceSeconds,
    policyVersion: row.policyVersion,
  }
}

export interface PlanMatch {
  plan: SubscriptionsLadderPlan
  annual: boolean
  itemIndex: number
}

/** The ladder row a subscription's items are billed at, or null. Free never matches. */
export function matchPlan(
  plans: readonly SubscriptionsLadderPlan[],
  priceIds: readonly string[],
): PlanMatch | null {
  for (const [itemIndex, priceId] of priceIds.entries()) {
    for (const plan of plans) {
      if (plan.plan === SUBSCRIPTIONS_FREE_PLAN) continue
      if (plan.stripePriceId === priceId) return { plan, annual: false, itemIndex }
      if (plan.stripeAnnualPriceId === priceId) return { plan, annual: true, itemIndex }
    }
  }
  return null
}

/** Paid extra areas: the quantity on items billed at the extra-area price. */
export function extraAreasOf(
  items: SubscriptionsStripeSubscription['items']['data'],
  extraAreaPriceId: string | null,
): number {
  if (!extraAreaPriceId) return 0
  return items
    .filter((item) => item.price.id === extraAreaPriceId)
    .reduce((sum, item) => sum + (item.quantity ?? 1), 0)
}

/** The fields whose change is worth an `entitlement-changed` event. */
export function sameEntitlement(
  a: Limits & {
    status: string
    periodEnd: Date | null
    cancelAtPeriodEnd: boolean
    trialEnd: Date | null
  },
  b: Limits & {
    status: string
    periodEnd: Date | null
    cancelAtPeriodEnd: boolean
    trialEnd: Date | null
  },
): boolean {
  return (
    a.tier === b.tier &&
    a.status === b.status &&
    a.areas === b.areas &&
    a.wants === b.wants &&
    a.channels.join(',') === b.channels.join(',') &&
    a.baseCadenceSeconds === b.baseCadenceSeconds &&
    a.floorCadenceSeconds === b.floorCadenceSeconds &&
    a.policyVersion === b.policyVersion &&
    (a.periodEnd?.getTime() ?? null) === (b.periodEnd?.getTime() ?? null) &&
    a.cancelAtPeriodEnd === b.cancelAtPeriodEnd &&
    (a.trialEnd?.getTime() ?? null) === (b.trialEnd?.getTime() ?? null)
  )
}

/** Adds calendar months in UTC, clamping to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + months
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(
    Date.UTC(
      y,
      m,
      Math.min(date.getUTCDate(), last),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  )
}

/** A billing period's length in months: 1 or 12 (a day's slack either way), else null. */
export function intervalMonthsOf(start: Date, end: Date): 1 | 12 | null {
  const day = 86_400_000
  for (const months of [1, 12] as const) {
    if (Math.abs(addMonths(start, months).getTime() - end.getTime()) <= day) return months
  }
  return null
}

export interface Window {
  start: Date
  end: Date
}

/**
 * The monthly allowance window of a paid period that contains `at` (docs/billing.md: "usage
 * allowance still monthly" on annual plans). Windows run from the period start in calendar
 * months; the last one ends with the period. Null outside the period.
 */
export function allowanceWindow(
  periodStart: Date,
  periodEnd: Date,
  intervalMonths: number,
  at: Date,
): Window | null {
  if (at < periodStart || at >= periodEnd) return null
  for (let k = 0; k < intervalMonths; k++) {
    const start = addMonths(periodStart, k)
    const next = k === intervalMonths - 1 ? periodEnd : addMonths(periodStart, k + 1)
    const end = next > periodEnd ? periodEnd : next
    if (at >= start && at < end) return { start, end }
  }
  return null
}

/** Net cash of an invoice in pence: what was paid less the tax on it. */
export function netCash(
  amountPaid: number,
  taxes: readonly { amount: number }[] | null | undefined,
): number {
  const tax = (taxes ?? []).reduce((sum, t) => sum + t.amount, 0)
  return Math.max(0, amountPaid - tax)
}

/** The allowance's idempotency key: one grant per subscription per window. */
export function allowanceRef(stripeSubscriptionId: string, windowStart: Date): string {
  return `allowance:${stripeSubscriptionId}@${windowStart.toISOString()}`
}

/**
 * Whether a "Start my plan now" tick is present and fresh: an ISO time no later than now (a
 * minute's clock slack) and no older than `maxAgeSeconds`.
 */
export function startNowValid(value: unknown, now: Date, maxAgeSeconds: number): boolean {
  if (typeof value !== 'string') return false
  const t = Date.parse(value)
  if (Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false
  return t <= now.getTime() + 60_000 && now.getTime() - t <= maxAgeSeconds * 1000
}

/** A Stripe reference that may be an ID or an expanded object. */
export function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

export const entitlementChangedKey = (userId: string, stripeEventId: string): string =>
  `subscriptions.entitlement-changed:${userId}@${stripeEventId}`

/** Unverified bodies have no trusted ID: the key is a hash of the body. */
export const webhookFailedKey = (
  stripeEventId: string | null,
  reason: string,
  bodyHash = '',
): string => `subscriptions.webhook-failed:${stripeEventId ?? `unverified-${bodyHash}`}#${reason}`
