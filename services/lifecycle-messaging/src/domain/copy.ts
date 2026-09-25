// Pure logic: no I/O. Wording shown to users is placeholder copy the owner will replace
// (this session's brief); kept in this one file so a later pass can replace it without touching
// any decision logic. "The user's real numbers" (module card) are numbers this module can
// actually derive from its declared inputs (v_events, v_profiles) -- counts of the user's own
// events and the properties already recorded on the triggering event itself. A deal card with
// margins (docs/marketing.md's own wording for "Activation" and "Abandoned onboarding") needs
// `alerts`/`valuations`, which this module does not depend on (docs/questions/lifecycle-messaging.md),
// so those steps' placeholders name what a real deal card would show without inventing one.
import type { LifecycleMessagingProgramme } from '@nabvy/contracts/modules/lifecycle-messaging'

export interface RenderedMessage {
  subject: string
  body: string
}

export interface CopyContext {
  displayName: string | null
  /** Real counts and properties this module can read, e.g. `alertsDelivered`, `alertsOpened`. */
  numbers: Readonly<Record<string, number>>
}

type CopyFn = (ctx: CopyContext) => RenderedMessage

const greeting = (ctx: CopyContext): string => (ctx.displayName ? `Hi ${ctx.displayName},` : 'Hi,')

export const COPY: Readonly<Record<string, CopyFn>> = {
  'abandoned-onboarding.24h': (ctx) => ({
    subject: 'PLACEHOLDER: set up your first hunt',
    body: `${greeting(ctx)} PLACEHOLDER copy (docs/marketing.md, "Abandoned onboarding"): a one-tap default hunt for your postcode.`,
  }),
  'abandoned-onboarding.3d': (ctx) => ({
    subject: 'PLACEHOLDER: a deal from your area',
    body: `${greeting(ctx)} PLACEHOLDER copy: a real deal card from your area (needs a deal source outside this module's inputs).`,
  }),
  'channel-not-linked.2h': (ctx) => ({
    subject: 'PLACEHOLDER: your alerts have nowhere to go yet',
    body: `${greeting(ctx)} PLACEHOLDER copy (docs/marketing.md, "Channel not linked"): link Telegram or push to start receiving alerts.`,
  }),
  'activation.24h': (ctx) => ({
    subject: 'PLACEHOLDER: your best deals so far',
    body: `${greeting(ctx)} PLACEHOLDER copy: you have had ${ctx.numbers.alertsDelivered ?? 0} alert(s) delivered. The three best deals with margins need a deal source outside this module's inputs.`,
  }),
  'cap-reached.immediate': (ctx) => ({
    subject: 'PLACEHOLDER: keep going with a trial',
    body: `${greeting(ctx)} PLACEHOLDER copy (docs/marketing.md, "Cap reached"): trial offer with a bonus credit. Your balance was ${ctx.numbers.balanceAfterPence ?? 0}p after your last charge.`,
  }),
  'cap-reached.3d': (ctx) => ({
    subject: 'PLACEHOLDER: what you missed',
    body: `${greeting(ctx)} PLACEHOLDER copy: a reminder of what you missed since your cap was reached.`,
  }),
  'trial.day1': (ctx) => ({
    subject: 'PLACEHOLDER: how alerts and scans work',
    body: `${greeting(ctx)} PLACEHOLDER copy (docs/marketing.md, "Trial"): how alerts and scans work.`,
  }),
  'trial.day5': (ctx) => ({
    subject: 'PLACEHOLDER: two days left',
    body: `${greeting(ctx)} PLACEHOLDER copy: two days left on your trial. So far: ${ctx.numbers.alertsDelivered ?? 0} alert(s) delivered, ${ctx.numbers.alertsOpened ?? 0} opened.`,
  }),
  'trial.day7': (ctx) => ({
    subject: 'PLACEHOLDER: last day of your trial',
    body: `${greeting(ctx)} PLACEHOLDER copy: last day of your trial.`,
  }),
  'win-back.30d': (ctx) => ({
    subject: 'PLACEHOLDER: come back to Nabvy',
    body: `${greeting(ctx)} PLACEHOLDER copy (docs/marketing.md, "Win-back"): what changed since you left, plus a usage credit.`,
  }),
  're-engagement.14d': (ctx) => ({
    subject: 'PLACEHOLDER: still hunting?',
    body: `${greeting(ctx)} PLACEHOLDER copy (docs/marketing.md, "Re-engagement"): pause your hunts or adjust your radius.`,
  }),
}

export function renderCopy(
  programme: LifecycleMessagingProgramme,
  step: string,
  ctx: CopyContext,
): RenderedMessage {
  const fn = COPY[`${programme}.${step}`]
  if (!fn) throw new Error(`lifecycle-messaging: no copy for ${programme}.${step}`)
  return fn(ctx)
}
