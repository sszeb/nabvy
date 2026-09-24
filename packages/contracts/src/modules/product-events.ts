import { z } from 'zod'
import { AmountMinor, defineEvents, Uuid } from '../index'

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
export const ProductEventName = z.enum(
  ProductEventsEvent.options.map((option) => option.shape.event.value) as [string, ...string[]],
)
export type ProductEventName = z.infer<typeof ProductEventName>

/** The product-events module publishes no domain events: it is read through `v_events`. */
export const events = defineEvents(module, {})
