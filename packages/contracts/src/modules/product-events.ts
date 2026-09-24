import { z } from 'zod'
import { AmountMinor, defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the product-events module (services/product-events, not yet built: catalogue
// card docs/design/modules/product-events.md). This file adds only what task 0.10 needs first:
// the event name list and the property allow-list docs/analytics.md defines (lines 17-30), so
// @nabvy/telemetry can validate an event before it ever reaches PostHog. The module's own
// `track()`, `product_events` table and consent gate are a later task.
// Import from '@nabvy/contracts/modules/product-events'. Samples in fixtures/contracts/product-events/.

export const module = 'product-events'

// Short, controlled values only: never listing text, seller data, photos, emails, postcodes or
// free text (docs/analytics.md:15,40). Enforced by allow-listing property keys per event below,
// not by a denylist, so a key naming anything else -- "email", "postcode", a free-text "note" --
// is rejected for every event because no event declares it.
const ShortString = z.string().trim().min(1).max(120)
const Count = z.number().int().nonnegative()
const Score = z.number()

const signupProperties = z.strictObject({
  method: ShortString,
  referralOrAffiliatePresent: z.boolean(),
})

const onboardingProperties = z.strictObject({
  pack: ShortString,
  radius: Count,
  channel: ShortString,
})

const huntProperties = z.strictObject({
  pack: ShortString,
  radius: Count,
  minDealScore: Score,
})

const alertProperties = z.strictObject({
  source: ShortString,
  channel: ShortString,
  dealScore: Score,
  freshnessSeconds: Count,
  valuationState: ShortString,
})

const alertFeedbackProperties = z.strictObject({
  verdict: ShortString,
  dealScore: Score,
  riskScore: Score,
})

const scanProperties = z.strictObject({
  method: ShortString,
  confidence: z.number().min(0).max(1),
  confirmed: z.boolean(),
  onDemand: z.boolean(),
  valuationState: ShortString,
  latencyMs: Count,
  action: ShortString,
})

const outcomeProperties = z.strictObject({
  productKey: ShortString,
  costMinor: AmountMinor,
  soldPriceMinor: AmountMinor,
  daysToSell: Count,
  linkedAlertId: Uuid.optional(),
  linkedScanId: Uuid.optional(),
})

const usageProperties = z.strictObject({
  action: ShortString,
  pricePence: AmountMinor,
  balanceAfter: AmountMinor,
})

const lifecycleProperties = z.strictObject({
  plan: ShortString,
  trigger: ShortString,
})

const channelLinkedProperties = z.strictObject({ channel: ShortString })

const briefProperties = z.strictObject({
  channel: ShortString,
  sectionsPresent: z.array(ShortString).max(20),
  dealScore: Score,
})

const apiCallProperties = z.strictObject({
  endpoint: ShortString,
  keyId: Uuid,
})

/**
 * `ProductEventsEvent`: one row's `event` and `properties`, before `userId`, `at` and the
 * optional `sessionId` are added (docs/analytics.md:13). Discriminated on `event`, so every
 * event name carries exactly the properties docs/analytics.md lists for it, and no others.
 */
export const ProductEventsEvent = z.discriminatedUnion('event', [
  z.strictObject({ event: z.literal('signup_completed'), properties: signupProperties }),
  z.strictObject({ event: z.literal('onboarding_completed'), properties: onboardingProperties }),
  z.strictObject({ event: z.literal('hunt_created'), properties: huntProperties }),
  z.strictObject({ event: z.literal('hunt_paused'), properties: huntProperties }),
  z.strictObject({ event: z.literal('alert_delivered'), properties: alertProperties }),
  z.strictObject({ event: z.literal('alert_opened'), properties: alertProperties }),
  z.strictObject({ event: z.literal('alert_feedback'), properties: alertFeedbackProperties }),
  z.strictObject({ event: z.literal('scan_started'), properties: scanProperties }),
  z.strictObject({ event: z.literal('scan_identified'), properties: scanProperties }),
  z.strictObject({ event: z.literal('scan_valued'), properties: scanProperties }),
  z.strictObject({ event: z.literal('scan_action'), properties: scanProperties }),
  z.strictObject({ event: z.literal('bought_recorded'), properties: outcomeProperties }),
  z.strictObject({ event: z.literal('sold_recorded'), properties: outcomeProperties }),
  z.strictObject({ event: z.literal('usage_charged'), properties: usageProperties }),
  z.strictObject({ event: z.literal('usage_refused'), properties: usageProperties }),
  z.strictObject({ event: z.literal('topup_completed'), properties: usageProperties }),
  z.strictObject({ event: z.literal('trial_offered'), properties: lifecycleProperties }),
  z.strictObject({ event: z.literal('trial_started'), properties: lifecycleProperties }),
  z.strictObject({ event: z.literal('subscription_active'), properties: lifecycleProperties }),
  z.strictObject({ event: z.literal('subscription_cancelled'), properties: lifecycleProperties }),
  z.strictObject({ event: z.literal('channel_linked'), properties: channelLinkedProperties }),
  z.strictObject({ event: z.literal('brief_sent'), properties: briefProperties }),
  z.strictObject({ event: z.literal('brief_opened'), properties: briefProperties }),
  z.strictObject({ event: z.literal('brief_deal_clicked'), properties: briefProperties }),
  z.strictObject({ event: z.literal('api_call'), properties: apiCallProperties }),
])
export type ProductEventsEvent = z.infer<typeof ProductEventsEvent>

/** The event names, derived from `ProductEventsEvent` so the list is never typed twice. */
export const ProductEventsName = z.enum(
  ProductEventsEvent.options.map((option) => option.shape.event.value) as [string, ...string[]],
)
export type ProductEventsName = z.infer<typeof ProductEventsName>

/** The product-events module publishes no domain events: it is read through `v_events`. */
export const events = defineEvents(module, {})

/**
 * A module switch state as `track()`'s caller read it (rule 11 of `_rules.md`). Unlike a handler,
 * `track()` never refuses on this: while `off` it silently records and forwards nothing (module
 * card, "When off": "nothing recorded; features unaffected"). This module has no user-facing view
 * to hide rows from, so `shadow` and `on` behave the same (services/product-events/README.md,
 * "Decisions").
 */
export const ProductEventsSwitchState = z.enum(['off', 'shadow', 'on'])
export type ProductEventsSwitchState = z.infer<typeof ProductEventsSwitchState>

/** The caller's own session id (Better Auth), the same shape `account.ts` uses for its channels. */
export const ProductEventsSessionId = z.string().trim().min(1).max(200)
export type ProductEventsSessionId = z.infer<typeof ProductEventsSessionId>

/**
 * One row of `product_events.v_events`. Its shape follows the Drizzle table declaration in
 * `packages/db/src/schema/product-events.ts`; `services/product-events/test/contracts.test.ts`
 * fails if they drift. `properties` stays a plain record here (not the discriminated union
 * `ProductEventsEvent` uses): the union enforces the allowlist at write time in `track()`, and a
 * stored row is read back as whatever passed that check.
 */
export const ProductEventsRecord = z.strictObject({
  id: Uuid,
  userId: Uuid,
  event: ProductEventsName,
  properties: z.record(z.string(), z.unknown()),
  sessionId: ProductEventsSessionId.nullable(),
  at: IsoTimestamp,
})
export type ProductEventsRecord = z.infer<typeof ProductEventsRecord>

/** Error codes the module returns as values (`docs/engineering.md`, "Errors"). */
export const ProductEventsErrorCode = z.enum([
  'product-events.invalid_input', // the input failed ProductEventsEvent (unknown event or property)
])
export type ProductEventsErrorCode = z.infer<typeof ProductEventsErrorCode>

export const ProductEventsError = z.strictObject({
  code: ProductEventsErrorCode,
  message: z.string(),
})
export type ProductEventsError = z.infer<typeof ProductEventsError>

/** What `track()` returns: whether the row was written, and whether it reached PostHog. */
export const ProductEventsTracked = z.strictObject({
  recorded: z.boolean(),
  forwarded: z.boolean(),
})
export type ProductEventsTracked = z.infer<typeof ProductEventsTracked>
