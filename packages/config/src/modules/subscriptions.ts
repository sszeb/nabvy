import { z } from 'zod'

// Thresholds of the subscriptions module (rule 14 of docs/design/modules/_rules.md). No prices
// and no Stripe price IDs for plans: those are pricing-console policy rows (docs/decisions.md,
// "Paid ladder"). Stripe keys and the top-up pack price IDs come from the `stripe` env group
// (docs/secrets.md) through `loadEnv`, never from here.

const subscriptionsConfig = z.object({
  webhookToleranceSeconds: z.number().int().min(60).max(600),
  startNowMaxAgeSeconds: z.number().int().min(60).max(3600),
  allowanceSweepBatch: z.number().int().min(100).max(500),
  freeFallback: z.object({
    areas: z.number().int().min(0),
    wants: z.number().int().min(0),
    channels: z.array(z.string()),
  }),
})

const config = subscriptionsConfig.parse({
  /**
   * How old a signed webhook may be before it is refused as a replay. Basis: Stripe's own default
   * tolerance of 300 seconds (`stripe.webhooks.constructEvent`). Status: fixed by Stripe's scheme.
   */
  webhookToleranceSeconds: 300,
  /**
   * How long a "Start my plan now" tick stays valid before the Checkout it opens. Basis: a
   * Checkout is opened straight after the tick; ten minutes covers a slow page. Status: starting
   * value.
   */
  startNowMaxAgeSeconds: 600,
  /**
   * Entitlements per call of the monthly allowance sweep. Basis: CLAUDE.md, "Batches, not items"
   * (100–500). Status: fixed by the rule.
   */
  allowanceSweepBatch: 500,
  /**
   * Free limits used only while pricing-console has no `free` row. Basis: docs/decisions.md,
   * "Free tier: bursts under a lifetime cap" (one want: a keyword and an area) and
   * docs/billing.md, "Entitlements" (Free: Telegram or email digest). Status: starting value;
   * replaced by the policy row once pricing-console merges.
   */
  freeFallback: { areas: 1, wants: 1, channels: ['telegram', 'email'] },
})

export const SUBSCRIPTIONS_WEBHOOK_TOLERANCE_SECONDS = config.webhookToleranceSeconds
export const SUBSCRIPTIONS_START_NOW_MAX_AGE_SECONDS = config.startNowMaxAgeSeconds
export const SUBSCRIPTIONS_ALLOWANCE_SWEEP_BATCH = config.allowanceSweepBatch
export const SUBSCRIPTIONS_FREE_FALLBACK = config.freeFallback
