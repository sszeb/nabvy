import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the listing-feedback module (services/listing-feedback, docs/design/modules/
// listing-feedback.md): a user's verdict on a listing (real_deal, not_a_deal, bought) and their
// saved/dismissed state, and the `listing-feedback.recorded` event. Import from
// '@nabvy/contracts/modules/listing-feedback'. A verdict is never a sale price (CLAUDE.md,
// "No invented numbers"); no schema here carries a price.

export const module = 'listing-feedback'

/** The deal-card feedback (docs/web-app.md:30; the build pack's Alert.userVerdict). */
export const ListingFeedbackVerdict = z.enum(['real_deal', 'not_a_deal', 'bought'])
export type ListingFeedbackVerdict = z.infer<typeof ListingFeedbackVerdict>

/** Per-user listing state (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:145). */
export const ListingFeedbackState = z.enum(['saved', 'dismissed'])
export type ListingFeedbackState = z.infer<typeof ListingFeedbackState>

/**
 * A verdict submitted from a deal card or an alert. `alertId` is absent when the feedback was
 * given outside an alert (browsing a listing directly). No client time: `at` is stamped by the
 * server, so verdict-counts days are never picked by the caller.
 */
export const ListingFeedbackRecordVerdictInput = z.strictObject({
  userId: Uuid,
  listingId: Uuid,
  alertId: Uuid.nullable().optional(),
  verdict: ListingFeedbackVerdict,
})
export type ListingFeedbackRecordVerdictInput = z.infer<typeof ListingFeedbackRecordVerdictInput>

/** The user saves or dismisses a listing. */
export const ListingFeedbackSetStateInput = z.strictObject({
  userId: Uuid,
  listingId: Uuid,
  state: ListingFeedbackState,
})
export type ListingFeedbackSetStateInput = z.infer<typeof ListingFeedbackSetStateInput>

/**
 * One row of the internal view `listing_feedback.v_verdict_counts`: verdicts per alert, day and
 * verdict, with no user ID (an alert precision guardrail metric, docs/decisions.md:236, and the
 * review loop).
 */
export const ListingFeedbackVerdictCount = z.strictObject({
  alertId: Uuid.nullable(),
  day: z.string(),
  verdict: ListingFeedbackVerdict,
  n: z.int().nonnegative(),
})
export type ListingFeedbackVerdictCount = z.infer<typeof ListingFeedbackVerdictCount>

/**
 * One row of `listing_feedback.v_bought_for_reports`: a `bought` verdict, granted only to
 * `seller-reply-reports` for the report-then-buy abuse exemption (too-good-to-be-true design
 * §3.3, §6.1, task 1.7s). Carries a user ID; not user-facing and not granted to `nabvy_app`.
 */
export const ListingFeedbackBoughtForReport = z.strictObject({
  userId: Uuid,
  listingId: Uuid,
  at: IsoTimestamp,
})
export type ListingFeedbackBoughtForReport = z.infer<typeof ListingFeedbackBoughtForReport>

/**
 * One row of the user-facing view `app.v_listing_feedback_mine`: the caller's own feedback on a
 * listing. Exactly one of `verdict` and `state` is set. Never a seller field or a listing's own
 * fields (rule 5 of docs/design/modules/_rules.md): this view is about the user's action, not the
 * listing.
 */
export const ListingFeedbackMine = z.strictObject({
  listingId: Uuid,
  alertId: Uuid.nullable(),
  verdict: ListingFeedbackVerdict.nullable(),
  state: ListingFeedbackState.nullable(),
  at: IsoTimestamp,
})
export type ListingFeedbackMine = z.infer<typeof ListingFeedbackMine>

/** Error codes returned as values (rule 3 of docs/design/modules/_rules.md). */
export const ListingFeedbackErrorCode = z.enum([
  'listing-feedback.off', //                the module is off: feedback controls are hidden
  'listing-feedback.invalid_input', //      the form failed its schema
  'listing-feedback.account_restricted', // the account is suspended or banned
])
export type ListingFeedbackErrorCode = z.infer<typeof ListingFeedbackErrorCode>

export const ListingFeedbackError = z.strictObject({
  code: ListingFeedbackErrorCode,
  message: z.string().min(1),
})
export type ListingFeedbackError = z.infer<typeof ListingFeedbackError>

/** The payload of `listing-feedback.recorded`: verdict IDs only (rule 7), 1-500 per envelope. */
export const ListingFeedbackRecordedEvent = z.strictObject({
  verdictIds: z.array(Uuid).min(1).max(500),
})
export type ListingFeedbackRecordedEvent = z.infer<typeof ListingFeedbackRecordedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  /** A verdict was recorded or changed. Never emitted for a saved/dismissed state change. */
  'listing-feedback.recorded': { 1: ListingFeedbackRecordedEvent },
})
