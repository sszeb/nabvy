// The Better Auth Stripe plugin's options, built by this module (docs/billing.md: subscriptions
// run through Better Auth's Stripe plugin). apps/web passes `stripe(stripePluginOptions(deps))`
// to the auth instance; mounting it is the auth module's change (docs/questions/subscriptions.md).
//
// Entitlements are written from `onEvent`, not from the plugin's per-lifecycle callbacks
// (`onSubscriptionComplete`, `onSubscriptionUpdate`, …): the plugin catches and only logs errors
// thrown by those, so a failed write would be acknowledged to Stripe and lost, while an error in
// `onEvent` turns into a non-2xx answer and Stripe retries (README.md, "Decisions").
import type { StripeOptions } from '@better-auth/stripe'
import { type EnvSource, loadEnv } from '@nabvy/config'
import {
  SUBSCRIPTIONS_FREE_PLAN,
  SUBSCRIPTIONS_START_NOW_KEY,
  type SubscriptionsLadderPlan,
} from '@nabvy/contracts/modules/subscriptions'
import { APIError } from 'better-auth/api'
import Stripe from 'stripe'
import { checkoutConsentParams, checkoutGate, ladderPlans } from '../index'
import { processStripeEvent, type StripeWebhookDeps } from './stripe'

export interface StripePluginDeps extends StripeWebhookDeps {
  stripeClient: Stripe
  webhookSecret: string
  now?: () => Date
}

/** The ladder's sellable rows as the plugin's plans. Free has no Stripe price and is left out. */
export function toStripePlans(rows: readonly SubscriptionsLadderPlan[]) {
  return rows
    .filter((row) => row.plan !== SUBSCRIPTIONS_FREE_PLAN && row.stripePriceId)
    .map((row) => ({
      name: row.plan,
      priceId: row.stripePriceId ?? undefined,
      annualDiscountPriceId: row.stripeAnnualPriceId ?? undefined,
      ...(row.trialDays ? { freeTrial: { days: row.trialDays } } : {}),
      limits: {
        areas: row.areas,
        wants: row.wants,
        baseCadenceSeconds: row.baseCadenceSeconds,
        floorCadenceSeconds: row.floorCadenceSeconds,
        policyVersion: row.policyVersion,
      },
    }))
}

export function stripePluginOptions(deps: StripePluginDeps): StripeOptions {
  const now = deps.now ?? (() => new Date())
  return {
    stripeClient: deps.stripeClient,
    stripeWebhookSecret: deps.webhookSecret,
    createCustomerOnSignUp: true,
    onEvent: async (event) => {
      await processStripeEvent(event, deps)
    },
    subscription: {
      enabled: true,
      requireEmailVerification: true,
      // Read on every call, so a pricing-console change applies without a deploy.
      plans: async () => toStripePlans(await deps.transaction((q) => ladderPlans(q, deps.ladder))),
      // A user acts only for themselves; nobody else's subscription is reachable.
      authorizeReference: async ({ user, referenceId }) => referenceId === user.id,
      // The plugin's own Checkout endpoint enforces the switch, standing and the tick, so a
      // client that skips the procedure is refused too.
      getCheckoutSessionParams: async ({ user }, _request, ctx) => {
        const body = (ctx.body ?? {}) as { metadata?: Record<string, unknown> }
        const tick = body.metadata?.[SUBSCRIPTIONS_START_NOW_KEY]
        const gate = await deps.transaction((q) => checkoutGate(q, user.id, tick, now()))
        if (!gate.ok) {
          throw new APIError('BAD_REQUEST', { message: gate.error.message, code: gate.error.code })
        }
        return { params: checkoutConsentParams() }
      },
    },
  }
}

export interface SubscriptionsStripeEnv {
  stripeClient: Stripe
  webhookSecret: string
  topupPrices: Readonly<Record<5 | 10 | 25, string>>
  extraAreaPriceId: string
}

/**
 * The Stripe client, webhook secret and pack price IDs from the `stripe` group of
 * docs/secrets.md, through `@nabvy/config` (never `process.env` here). Throws `EnvError`, which
 * names missing variables and never their values.
 */
export function subscriptionsStripeFromEnv(source?: EnvSource): SubscriptionsStripeEnv {
  const env = loadEnv(['stripe'], source)
  return {
    stripeClient: new Stripe(env.STRIPE_SECRET_KEY),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    topupPrices: {
      5: env.STRIPE_PRICE_TOPUP_5,
      10: env.STRIPE_PRICE_TOPUP_10,
      25: env.STRIPE_PRICE_TOPUP_25,
    },
    extraAreaPriceId: env.STRIPE_PRICE_EXTRA_AREA,
  }
}
