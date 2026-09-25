// Public API of the marketing-consent module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/marketing-consent' only, never from its internals.
import { isActive } from '@nabvy/account'
import { MARKETING_CONSENT_PAUSE_ALL_DURATION_MS } from '@nabvy/config/modules/marketing-consent'
import {
  MARKETING_CONSENT_USER_CATEGORIES,
  MarketingConsentCanMarketInput,
  MarketingConsentNewsletterSubscribeInput,
  MarketingConsentNewsletterUnsubscribeInput,
  MarketingConsentPauseAllInput,
  type MarketingConsentPreferences,
  MarketingConsentResumeAllInput,
  MarketingConsentSetPreferenceInput,
  MarketingConsentSuppressionEvent,
} from '@nabvy/contracts/modules/marketing-consent'
import type { Queryable } from '@nabvy/db'
import { isOn } from '@nabvy/switches'
import { decideCanMarket, hashEmail, isPaused, PAUSE_ALL_CATEGORY } from './domain'
import * as repo from './repo'
import { InMemorySuppressionSyncClient, type SuppressionSyncClient } from './suppression-sync'

export { events, module } from '@nabvy/contracts/modules/marketing-consent'
export { type AccountDeletedDeps, accountDeletedHandler } from './handlers'
export { InMemorySuppressionSyncClient, type SuppressionSyncClient } from './suppression-sync'

// ---------------------------------------------------------------------------------------------
// canMarket: the gate every marketing send checks (module card, "Outputs")
// ---------------------------------------------------------------------------------------------

/**
 * Whether a marketing message in `category` may go to `userId` at `email`, right now. Fails
 * closed while the module's own switch is off (module card, "When off": "no marketing sends";
 * service messages never call this) and while the account is not active (rule 12 of
 * `docs/design/modules/_rules.md`: every job acting for a user checks standing through `account`
 * first). `email` is the address the caller is about to send to (README.md, "Decisions": this
 * module has no way to look up a user's email from `userId` alone).
 */
export async function canMarket(
  q: Queryable,
  rawInput: MarketingConsentCanMarketInput,
): Promise<boolean> {
  const input = MarketingConsentCanMarketInput.parse(rawInput)
  const [moduleOn, accountActive, suppressed, rows] = await Promise.all([
    isOn(q, 'marketing-consent'),
    isActive(q, input.userId),
    isSuppressed(q, input.email),
    repo.selectConsentRows(q, input.userId),
  ])
  return decideCanMarket({
    moduleOn,
    accountActive,
    suppressed,
    rows,
    category: input.category,
    now: new Date(),
  })
}

// ---------------------------------------------------------------------------------------------
// Preference centre (docs/marketing.md, "Preference centre"). Never gated by the module switch:
// a user's own consent choice is a record this module always takes, whether or not the switch
// that gates sending is on (only `canMarket()` fails closed, per its own doc comment above).
// ---------------------------------------------------------------------------------------------

export async function getPreferences(
  q: Queryable,
  userId: string,
): Promise<MarketingConsentPreferences> {
  const rows = await repo.selectConsentRows(q, userId)
  const pause = rows.find((row) => row.category === PAUSE_ALL_CATEGORY)
  const pausedUntil = pause?.until && isPaused(rows, new Date()) ? pause.until.toISOString() : null
  return {
    userId,
    preferences: MARKETING_CONSENT_USER_CATEGORIES.map((category) => ({
      category,
      granted: rows.find((row) => row.category === category)?.granted === true,
    })),
    pausedUntil,
  }
}

export async function setPreference(
  q: Queryable,
  rawInput: MarketingConsentSetPreferenceInput,
): Promise<void> {
  const input = MarketingConsentSetPreferenceInput.parse(rawInput)
  const at = new Date()
  await repo.upsertConsent(q, {
    userId: input.userId,
    category: input.category,
    granted: input.granted,
    until: null,
    source: input.source,
    at,
  })
}

/** "Pause all marketing for 30 days" (docs/marketing.md, "Preference centre"). */
export async function pauseAll(
  q: Queryable,
  rawInput: MarketingConsentPauseAllInput,
): Promise<void> {
  const input = MarketingConsentPauseAllInput.parse(rawInput)
  const at = new Date()
  await repo.upsertConsent(q, {
    userId: input.userId,
    category: PAUSE_ALL_CATEGORY,
    granted: false,
    until: new Date(at.getTime() + MARKETING_CONSENT_PAUSE_ALL_DURATION_MS),
    source: input.source,
    at,
  })
}

export async function resumeAll(
  q: Queryable,
  rawInput: MarketingConsentResumeAllInput,
): Promise<void> {
  const input = MarketingConsentResumeAllInput.parse(rawInput)
  await repo.deletePause(q, input.userId)
}

// ---------------------------------------------------------------------------------------------
// Suppressions (Resend and PostHog bounce and complaint webhooks)
// ---------------------------------------------------------------------------------------------

export async function isSuppressed(q: Queryable, email: string): Promise<boolean> {
  const row = await repo.selectSuppression(q, hashEmail(email))
  return row != null
}

/**
 * Records a bounce or complaint and pushes it into the other provider's suppression list through
 * `syncClient` (`InMemorySuppressionSyncClient` by default: services/marketing-consent/README.md,
 * "Decisions"). Idempotent (rule 8): a repeated report for the same address upserts the same row.
 * Never gated by the module switch: an address that should not be mailed stays suppressed even
 * while the module is off (the same fail-safe reasoning `docs/design/modules/_rules.md` rule 11
 * gives `listing-suppression`).
 */
export async function recordSuppression(
  q: Queryable,
  rawInput: MarketingConsentSuppressionEvent,
  syncClient: SuppressionSyncClient = new InMemorySuppressionSyncClient(),
): Promise<void> {
  const input = MarketingConsentSuppressionEvent.parse(rawInput)
  const emailHash = hashEmail(input.email)
  await repo.upsertSuppression(q, {
    emailHash,
    reason: input.reason,
    source: input.source,
    at: new Date(),
  })
  await syncClient.sync({ emailHash, reason: input.reason })
}

// ---------------------------------------------------------------------------------------------
// Newsletter subscribers
// ---------------------------------------------------------------------------------------------

export async function subscribeNewsletter(
  q: Queryable,
  rawInput: MarketingConsentNewsletterSubscribeInput,
): Promise<void> {
  const input = MarketingConsentNewsletterSubscribeInput.parse(rawInput)
  const emailHash = hashEmail(input.email)
  await repo.upsertNewsletterSubscriber(q, {
    emailHash,
    consentSource: input.source,
    at: new Date(),
  })
}

export async function unsubscribeNewsletter(
  q: Queryable,
  rawInput: MarketingConsentNewsletterUnsubscribeInput,
): Promise<void> {
  const input = MarketingConsentNewsletterUnsubscribeInput.parse(rawInput)
  await repo.markNewsletterUnsubscribed(q, hashEmail(input.email), new Date())
}

// ---------------------------------------------------------------------------------------------
// Deletion (rule 12: every module holding user rows purges them on `account.deleted`)
// ---------------------------------------------------------------------------------------------

/** Erases this module's rows for one deleted user; called by `onAccountDeleted` (`./handlers`). */
export async function purgeUser(q: Queryable, userId: string): Promise<void> {
  await repo.purgeUser(q, userId)
}
