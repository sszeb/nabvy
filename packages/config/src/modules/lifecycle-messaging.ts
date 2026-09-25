import { z } from 'zod'

// Thresholds of the lifecycle-messaging module (rule 14 of docs/design/modules/_rules.md). The
// programmes' own shape (trigger, exit, goal, step order and channel) is not a threshold and
// lives in services/lifecycle-messaging/src/domain/programmes.ts; only the numbers below do.

const lifecycleMessagingConfig = z.object({
  dailyMarketingCap: z.number().int().positive(),
  stepDelayMinutes: z.record(z.string(), z.number().int().nonnegative()),
  reEngagementInactivityDays: z.number().int().positive(),
  triggerLookbackDays: z.record(z.string(), z.number().int().positive()),
  batchSize: z.number().int().positive(),
})

const config = lifecycleMessagingConfig.parse({
  /**
   * "a cap of one marketing message per user per day" (docs/marketing.md, "Lifecycle programmes").
   * Status: fixed by docs/marketing.md's own wording, not a starting value to calibrate. Never
   * counts a service-category step (docs/marketing.md, "Consent and the law": trial and billing
   * notices need no marketing consent).
   */
  dailyMarketingCap: 1,
  /**
   * Each step's delay after its programme's trigger, keyed `<programme>.<step>`, straight from
   * docs/marketing.md's "Lifecycle programmes" table. Status: fixed by that table's own wording
   * for every row that states a time; `cap-reached.immediate` and `win-back.30d` read their delay
   * from the table's own words ("Immediate", "+ 30 days").
   */
  stepDelayMinutes: {
    'abandoned-onboarding.24h': 24 * 60,
    'abandoned-onboarding.3d': 3 * 24 * 60,
    'channel-not-linked.2h': 2 * 60,
    'activation.24h': 24 * 60,
    'cap-reached.immediate': 0,
    'cap-reached.3d': 3 * 24 * 60,
    'trial.day1': 1 * 24 * 60,
    'trial.day5': 5 * 24 * 60,
    'trial.day7': 7 * 24 * 60,
    'win-back.30d': 30 * 24 * 60,
    're-engagement.14d': 14 * 24 * 60,
  },
  /**
   * "no `alert_opened` or `scan_started` for 14 days" (docs/marketing.md). Status: fixed by the
   * table's own wording.
   */
  reEngagementInactivityDays: 14,
  /**
   * How far back `run()` scans `product_events.v_events` for a programme's trigger event, keyed
   * by programme: the longest step delay plus a week's grace, so a user who was offline when a
   * step became due still gets it on the next tick. Status: starting value, derived mechanically
   * from `stepDelayMinutes` above rather than measured; safe to widen if a real gap is found.
   */
  triggerLookbackDays: {
    'abandoned-onboarding': 3 + 7,
    'channel-not-linked': 1 + 7,
    activation: 1 + 7,
    'cap-reached': 3 + 7,
    trial: 7 + 7,
    'win-back': 30 + 7,
  },
  /**
   * Batch size for both the trigger-event scan and the programme_runs / marketing-consent lookups
   * it drives (CLAUDE.md, "Batches, not items": 100-500). Status: starting value, the batch
   * rule's own upper bound.
   */
  batchSize: 500,
})

export const LIFECYCLE_MESSAGING_DAILY_MARKETING_CAP = config.dailyMarketingCap
export const LIFECYCLE_MESSAGING_STEP_DELAY_MINUTES: Readonly<Record<string, number>> =
  config.stepDelayMinutes
export const LIFECYCLE_MESSAGING_RE_ENGAGEMENT_INACTIVITY_DAYS = config.reEngagementInactivityDays
export const LIFECYCLE_MESSAGING_TRIGGER_LOOKBACK_DAYS: Readonly<Record<string, number>> =
  config.triggerLookbackDays
export const LIFECYCLE_MESSAGING_BATCH_SIZE = config.batchSize
