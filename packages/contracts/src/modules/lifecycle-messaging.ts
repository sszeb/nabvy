import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the lifecycle-messaging module (services/lifecycle-messaging):
// docs/design/modules/lifecycle-messaging.md. Runs the behaviour-triggered programmes of
// docs/marketing.md, "Lifecycle programmes (PostHog Workflows)" through PostHog Workflows and
// Resend. Import from '@nabvy/contracts/modules/lifecycle-messaging'.
//
// Scope (services/lifecycle-messaging/README.md, "Decisions"): only the programmes whose trigger,
// exit and goal events already exist in `ProductEventsName`
// (packages/contracts/src/modules/product-events.ts) are built here — this module never adds an
// event to that module's own allowlist (docs/design/modules/_rules.md rule 2: a module session
// touches only its own files). "Abandoned checkout" (`checkout_started`), "Failed payment"
// (Stripe `invoice.payment_failed`) and "Affiliate onboarding" (a Dub webhook) are not built for
// that reason and are recorded in docs/questions/lifecycle-messaging.md. "Nabvy Daily" and "Weekly
// review" are the `daily-brief` module's job (docs/backlog.md, task 4.6c), not this one's.

export const module = 'lifecycle-messaging'

// ---------------------------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------------------------

/** The programmes this module runs (services/lifecycle-messaging/README.md, "Decisions"). */
export const LIFECYCLE_MESSAGING_PROGRAMMES = [
  'abandoned-onboarding',
  'channel-not-linked',
  'activation',
  'cap-reached',
  'trial',
  'win-back',
  're-engagement',
] as const
export const LifecycleMessagingProgramme = z.enum(LIFECYCLE_MESSAGING_PROGRAMMES)
export type LifecycleMessagingProgramme = z.infer<typeof LifecycleMessagingProgramme>

/** A step's key within its programme, e.g. `24h`, `day5`, `immediate` (never reused across programmes). */
export const LifecycleMessagingStep = z.string().trim().min(1).max(40)
export type LifecycleMessagingStep = z.infer<typeof LifecycleMessagingStep>

/**
 * `marketing-consent`'s four preference-centre categories, or `null` for a service message
 * (docs/marketing.md, "Consent and the law": "trial and billing notices need no marketing
 * consent"). A `null`-category step is never gated by `canMarket()` and never counts toward the
 * one-marketing-message-a-day cap.
 */
export const LifecycleMessagingCategory = z.enum([
  'tips',
  'offers',
  'product_updates',
  'weekly_digest',
])
export type LifecycleMessagingCategory = z.infer<typeof LifecycleMessagingCategory>

// ---------------------------------------------------------------------------------------------
// programme_runs (module card, "Owns")
// ---------------------------------------------------------------------------------------------

/**
 * One row of `lifecycle_messaging.v_runs`: a message actually sent. `triggeredAt` is the
 * qualifying trigger event's own timestamp (or, for an inactivity-triggered programme, the
 * computed last-activity time) — services/lifecycle-messaging/README.md, "Decisions": the card's
 * literal `(userId, programme, step, at)` is extended with `triggeredAt` so a programme whose
 * trigger recurs (`cap-reached`, `win-back`, `re-engagement`) can run again for a later
 * occurrence, not only once per user for life.
 */
export const LifecycleMessagingRun = z.strictObject({
  userId: Uuid,
  programme: LifecycleMessagingProgramme,
  step: LifecycleMessagingStep,
  triggeredAt: IsoTimestamp,
  at: IsoTimestamp,
})
export type LifecycleMessagingRun = z.infer<typeof LifecycleMessagingRun>

/**
 * This module publishes no domain events (module card, "Outputs": "sends" only — the sends
 * themselves are the effect, not an event another module consumes). It consumes `account.deleted`
 * (rule 12 of `_rules.md`: every module holding user rows purges them) but defines that
 * consumption in `services/lifecycle-messaging/src/handlers`, not here.
 */
export const events = defineEvents(module, {})
