// Pure logic: no I/O. The programme catalogue itself (docs/marketing.md, "Lifecycle programmes
// (PostHog Workflows)"), scoped to the programmes this module actually builds
// (README.md, "Decisions").
import {
  LIFECYCLE_MESSAGING_RE_ENGAGEMENT_INACTIVITY_DAYS,
  LIFECYCLE_MESSAGING_STEP_DELAY_MINUTES,
} from '@nabvy/config/modules/lifecycle-messaging'
import type {
  LifecycleMessagingCategory,
  LifecycleMessagingProgramme,
} from '@nabvy/contracts/modules/lifecycle-messaging'
import type { ProductEventsName } from '@nabvy/contracts/modules/product-events'

/** One message a programme may send. `category: null` is a service message (README.md). */
export interface ProgrammeStep {
  key: string
  delayMinutes: number
  category: LifecycleMessagingCategory | null
}

interface EventTrigger {
  kind: 'event'
  event: ProductEventsName
}

interface InactivityTrigger {
  kind: 'inactivity'
  events: ProductEventsName[]
  days: number
}

export interface ProgrammeDefinition {
  id: LifecycleMessagingProgramme
  trigger: EventTrigger | InactivityTrigger
  /** Any of these events, at or after the trigger time, cancels every step not yet sent. */
  exitEvents: ProductEventsName[]
  goalEvent: ProductEventsName
  steps: ProgrammeStep[]
}

const delay = (programme: string, step: string): number => {
  const key = `${programme}.${step}`
  const minutes = LIFECYCLE_MESSAGING_STEP_DELAY_MINUTES[key]
  if (minutes === undefined) throw new Error(`lifecycle-messaging: no configured delay for ${key}`)
  return minutes
}

/**
 * The seven programmes this module runs. Every trigger, exit and goal event name here must exist
 * in `ProductEventsName`; a programme whose event does not exist yet (abandoned checkout, failed
 * payment, affiliate onboarding) is left out rather than inventing the event in another module's
 * contract file (docs/questions/lifecycle-messaging.md).
 */
export const PROGRAMMES: readonly ProgrammeDefinition[] = [
  {
    id: 'abandoned-onboarding',
    trigger: { kind: 'event', event: 'signup_completed' },
    exitEvents: ['hunt_created'],
    goalEvent: 'hunt_created',
    steps: [
      { key: '24h', delayMinutes: delay('abandoned-onboarding', '24h'), category: 'tips' },
      { key: '3d', delayMinutes: delay('abandoned-onboarding', '3d'), category: 'tips' },
    ],
  },
  {
    id: 'channel-not-linked',
    trigger: { kind: 'event', event: 'hunt_created' },
    exitEvents: ['channel_linked'],
    goalEvent: 'channel_linked',
    steps: [{ key: '2h', delayMinutes: delay('channel-not-linked', '2h'), category: 'tips' }],
  },
  {
    id: 'activation',
    trigger: { kind: 'event', event: 'alert_delivered' },
    exitEvents: ['alert_opened'],
    goalEvent: 'alert_opened',
    steps: [{ key: '24h', delayMinutes: delay('activation', '24h'), category: 'tips' }],
  },
  {
    id: 'cap-reached',
    trigger: { kind: 'event', event: 'usage_refused' },
    exitEvents: ['trial_started', 'topup_completed'],
    goalEvent: 'trial_started',
    steps: [
      { key: 'immediate', delayMinutes: delay('cap-reached', 'immediate'), category: 'offers' },
      { key: '3d', delayMinutes: delay('cap-reached', '3d'), category: 'offers' },
    ],
  },
  {
    id: 'trial',
    trigger: { kind: 'event', event: 'trial_started' },
    exitEvents: ['subscription_active', 'subscription_cancelled'],
    goalEvent: 'subscription_active',
    // Service messages (docs/marketing.md, "Consent and the law": "trial and billing notices
    // need no marketing consent"): category null, never gated by canMarket(), never counted
    // toward the daily marketing cap.
    steps: [
      { key: 'day1', delayMinutes: delay('trial', 'day1'), category: null },
      { key: 'day5', delayMinutes: delay('trial', 'day5'), category: null },
      { key: 'day7', delayMinutes: delay('trial', 'day7'), category: null },
    ],
  },
  {
    id: 'win-back',
    trigger: { kind: 'event', event: 'subscription_cancelled' },
    exitEvents: ['subscription_active'],
    goalEvent: 'subscription_active',
    steps: [{ key: '30d', delayMinutes: delay('win-back', '30d'), category: 'offers' }],
  },
  {
    id: 're-engagement',
    trigger: {
      kind: 'inactivity',
      events: ['alert_opened', 'scan_started'],
      days: LIFECYCLE_MESSAGING_RE_ENGAGEMENT_INACTIVITY_DAYS,
    },
    // "any activity" (docs/marketing.md): re-evaluated fresh from real data every run rather than
    // stored, because a fresh alert_opened/scan_started moves the inactivity anchor itself and the
    // condition stops being true (services/lifecycle-messaging/README.md, "Decisions").
    exitEvents: [],
    goalEvent: 'alert_opened',
    steps: [{ key: '14d', delayMinutes: 0, category: 'tips' }],
  },
] as const

export function programmeById(id: LifecycleMessagingProgramme): ProgrammeDefinition {
  const programme = PROGRAMMES.find((p) => p.id === id)
  if (!programme) throw new Error(`lifecycle-messaging: unknown programme ${id}`)
  return programme
}

/** The category of a (programme, step) pair, looked up from the static catalogue above. */
export function categoryOf(
  programme: LifecycleMessagingProgramme,
  step: string,
): LifecycleMessagingCategory | null {
  const found = programmeById(programme).steps.find((s) => s.key === step)
  if (!found) throw new Error(`lifecycle-messaging: unknown step ${programme}.${step}`)
  return found.category
}

/** Whether a (programme, step) pair is a marketing message (counts toward the daily cap). */
export function isMarketingStep(programme: LifecycleMessagingProgramme, step: string): boolean {
  return categoryOf(programme, step) != null
}
