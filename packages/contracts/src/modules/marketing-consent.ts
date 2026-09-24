import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the marketing-consent module (services/marketing-consent): preference-centre
// consent, email suppressions and newsletter subscribers. Import from
// '@nabvy/contracts/modules/marketing-consent'. Marketing vs. service messages and the preference
// centre: docs/marketing.md, "Consent and the law (UK PECR and GDPR)".

export const module = 'marketing-consent'

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

/** The preference-centre categories a user sees and toggles (docs/marketing.md). */
export const MARKETING_CONSENT_USER_CATEGORIES = [
  'tips',
  'offers',
  'product_updates',
  'weekly_digest',
] as const
export const MarketingConsentUserCategory = z.enum(MARKETING_CONSENT_USER_CATEGORIES)
export type MarketingConsentUserCategory = z.infer<typeof MarketingConsentUserCategory>

/**
 * `MarketingConsentUserCategory` plus `all`: this module's own row for "pause all marketing for
 * 30 days" (docs/marketing.md, "Preference centre"). `all` is never shown to a user or accepted by
 * `setPreference()`; only `pauseAll()`/`resumeAll()` write it (services/marketing-consent/README.md,
 * "Decisions").
 */
export const MarketingConsentCategory = z.enum([...MARKETING_CONSENT_USER_CATEGORIES, 'all'])
export type MarketingConsentCategory = z.infer<typeof MarketingConsentCategory>

/** Where a consent or pause record came from. */
export const MarketingConsentSource = z.enum(['signup', 'preference-centre', 'admin'])
export type MarketingConsentSource = z.infer<typeof MarketingConsentSource>

/**
 * One row of `marketing_consent.v_consents`. `until` is set only on the `all` pause row; for a
 * real category it is always null. `granted` defaults to false (docs/marketing.md: "Sign-up shows
 * an unticked box"): no row for a category means not granted.
 */
export const MarketingConsent = z.strictObject({
  userId: Uuid,
  category: MarketingConsentCategory,
  granted: z.boolean(),
  until: IsoTimestamp.nullable(),
  source: MarketingConsentSource,
  at: IsoTimestamp,
})
export type MarketingConsent = z.infer<typeof MarketingConsent>

export const MarketingConsentSetPreferenceInput = z.strictObject({
  userId: Uuid,
  category: MarketingConsentUserCategory,
  granted: z.boolean(),
  source: MarketingConsentSource,
})
export type MarketingConsentSetPreferenceInput = z.infer<typeof MarketingConsentSetPreferenceInput>

export const MarketingConsentPauseAllInput = z.strictObject({
  userId: Uuid,
  source: MarketingConsentSource,
})
export type MarketingConsentPauseAllInput = z.infer<typeof MarketingConsentPauseAllInput>

export const MarketingConsentResumeAllInput = z.strictObject({ userId: Uuid })
export type MarketingConsentResumeAllInput = z.infer<typeof MarketingConsentResumeAllInput>

/** One category as the preference centre shows it: on or off, nothing else. */
export const MarketingConsentPreference = z.strictObject({
  category: MarketingConsentUserCategory,
  granted: z.boolean(),
})
export type MarketingConsentPreference = z.infer<typeof MarketingConsentPreference>

/** What `getPreferences()` returns: every user-facing category, and the pause if one is active. */
export const MarketingConsentPreferences = z.strictObject({
  userId: Uuid,
  preferences: z.array(MarketingConsentPreference).length(MARKETING_CONSENT_USER_CATEGORIES.length),
  pausedUntil: IsoTimestamp.nullable(),
})
export type MarketingConsentPreferences = z.infer<typeof MarketingConsentPreferences>

// ---------------------------------------------------------------------------------------------
// canMarket (module card, "Outputs"; the gate every marketing send checks)
// ---------------------------------------------------------------------------------------------

/** Trimmed and lower-cased before validation, the same normalisation `WaitlistEmail` uses. */
export const MarketingConsentEmail = z.string().trim().toLowerCase().max(320).pipe(z.email())
export type MarketingConsentEmail = z.infer<typeof MarketingConsentEmail>

/**
 * `email` is the address the caller is about to send to: this module has no view from `auth` or
 * `account` onto a user's email address, so a suppression check (keyed by email, not `userId`)
 * needs the caller to pass it (services/marketing-consent/README.md, "Decisions": "canMarket()
 * takes the target email").
 */
export const MarketingConsentCanMarketInput = z.strictObject({
  userId: Uuid,
  email: MarketingConsentEmail,
  category: MarketingConsentUserCategory,
})
export type MarketingConsentCanMarketInput = z.infer<typeof MarketingConsentCanMarketInput>

// ---------------------------------------------------------------------------------------------
// Suppressions (Resend and PostHog bounce and complaint webhooks)
// ---------------------------------------------------------------------------------------------

export const MarketingConsentSuppressionReason = z.enum([
  'bounce',
  'complaint',
  'unsubscribe',
  'manual',
])
export type MarketingConsentSuppressionReason = z.infer<typeof MarketingConsentSuppressionReason>

export const MarketingConsentSuppressionSource = z.enum(['resend', 'posthog', 'user', 'admin'])
export type MarketingConsentSuppressionSource = z.infer<typeof MarketingConsentSuppressionSource>

/**
 * A bounce or complaint, already normalised from the provider's own webhook payload. No apps/web
 * webhook route exists yet (that pull request is separate, `services/account/README.md`'s own
 * precedent for the `app` schema): this contract is the boundary a future Resend/PostHog route
 * handler translates its provider-specific payload into before calling this module.
 */
export const MarketingConsentSuppressionEvent = z.strictObject({
  email: MarketingConsentEmail,
  reason: MarketingConsentSuppressionReason,
  source: MarketingConsentSuppressionSource,
})
export type MarketingConsentSuppressionEvent = z.infer<typeof MarketingConsentSuppressionEvent>

export const MarketingConsentSuppression = z.strictObject({
  reason: MarketingConsentSuppressionReason,
  source: MarketingConsentSuppressionSource,
  at: IsoTimestamp,
})
export type MarketingConsentSuppression = z.infer<typeof MarketingConsentSuppression>

// ---------------------------------------------------------------------------------------------
// Newsletter subscribers (the public daily brief and waitlist/price-page sign-ups)
// ---------------------------------------------------------------------------------------------

export const MarketingConsentNewsletterSubscribeInput = z.strictObject({
  email: MarketingConsentEmail,
  source: z.string().trim().min(1).max(100),
})
export type MarketingConsentNewsletterSubscribeInput = z.infer<
  typeof MarketingConsentNewsletterSubscribeInput
>

export const MarketingConsentNewsletterUnsubscribeInput = z.strictObject({
  email: MarketingConsentEmail,
})
export type MarketingConsentNewsletterUnsubscribeInput = z.infer<
  typeof MarketingConsentNewsletterUnsubscribeInput
>

/**
 * This module defines no error codes of its own: every exported function parses its input with
 * the schemas above (throwing Zod's own error on bad input, the same pattern
 * `AccountConfirmTelegramLinkInput.parse` uses) and has no other refusal — writes are never gated
 * by the module switch (README.md, "Decisions": only `canMarket()` fails closed).
 *

 * Events this module publishes: none (module card, "Outputs": only `canMarket()`). It consumes
 * `account.deleted` (purging its own `marketing_consents` rows, rule 12 of `_rules.md`) but
 * publishes nothing of its own yet.
 */
export const events = defineEvents(module, {})
