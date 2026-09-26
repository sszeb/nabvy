import { z } from 'zod'
import { defineEvents, IsoTimestamp, Source, Uuid, UuidV7 } from '../index'

// Contracts of the seller-reply-reports module (services/seller-reply-reports, docs/design/
// modules/seller-reply-reports.md; the too-good-to-be-true design §6.4): one-tap reports of what
// a seller told a buyer, the evidence they add up to per listing and family, and the module's
// three events. Import from '@nabvy/contracts/modules/seller-reply-reports'. No schema here
// carries free text, a link, a price or a seller field: a report is a set of fixed codes.

export const module = 'seller-reply-reports'

/** The card's fixed report reasons (design §3.1). `as_listed` ("Nothing odd") is a counter-report. */
export const SellerReplyReportsReason = z.enum([
  'collection_elsewhere',
  'postage_only',
  'payment_first',
  'link_or_fb_delivery',
  'not_as_described',
  'other',
  'as_listed',
])
export type SellerReplyReportsReason = z.infer<typeof SellerReplyReportsReason>

/** The evidence family a reason counts towards. `other` and `as_listed` belong to none. */
export const SellerReplyReportsFamily = z.enum(['location', 'handover', 'payment', 'link', 'item'])
export type SellerReplyReportsFamily = z.infer<typeof SellerReplyReportsFamily>

export const SellerReplyReportsPaymentKind = z.enum([
  'bank_transfer',
  'friends_and_family',
  'deposit',
  'voucher_gift_or_crypto',
  'other',
])
export type SellerReplyReportsPaymentKind = z.infer<typeof SellerReplyReportsPaymentKind>
export const SellerReplyReportsLinkKind = z.enum([
  'payment_link',
  'delivery_link',
  'facebook_delivery',
])
export type SellerReplyReportsLinkKind = z.infer<typeof SellerReplyReportsLinkKind>
export const SellerReplyReportsItemKind = z.enum([
  'different_model',
  'photos_not_this_item',
  'faulty_or_missing_parts',
  'other',
])
export type SellerReplyReportsItemKind = z.infer<typeof SellerReplyReportsItemKind>
/** "Could you still see it and pay when you collect there?" `yes` never counts; `didnt_ask` counts only in path B. */
export const SellerReplyReportsCollectionAnswer = z.enum(['yes', 'no', 'didnt_ask'])
export type SellerReplyReportsCollectionAnswer = z.infer<typeof SellerReplyReportsCollectionAnswer>
/** "How did they want paying?" on a postage-only report. `protected` never counts. */
export const SellerReplyReportsPostagePayment = z.enum([
  'bank_transfer',
  'friends_and_family',
  'protected',
  'didnt_say',
])
export type SellerReplyReportsPostagePayment = z.infer<typeof SellerReplyReportsPostagePayment>
/**
 * A reported collection place: a city-page ID from the gazetteer (town, area or Facebook page),
 * never a postcode or a street (README.md, "Decisions").
 */
export const SellerReplyReportsPlaceId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
export type SellerReplyReportsPlaceId = z.infer<typeof SellerReplyReportsPlaceId>
/**
 * The listing a report is about: listing-ingest's listing ID, the key listing-feedback,
 * pickup-location and copy-advert use (README.md, "Decisions"; the design's `sourceListingId`).
 */
export const SellerReplyReportsListingId = Uuid
export type SellerReplyReportsListingId = z.infer<typeof SellerReplyReportsListingId>

/** One chip and its optional second tap (design §3.1). No free text in version 1 (owner decision 14). */
export const SellerReplyReportsReasonInput = z.discriminatedUnion('reason', [
  z.strictObject({
    reason: z.literal('collection_elsewhere'),
    placeId: SellerReplyReportsPlaceId.nullable(), // null = "Didn't say"
    canSeeAndPay: SellerReplyReportsCollectionAnswer.nullable(), // null = not answered: `didnt_ask`
  }),
  z.strictObject({
    reason: z.literal('postage_only'),
    paidHow: SellerReplyReportsPostagePayment.nullable(),
  }),
  z.strictObject({
    reason: z.literal('payment_first'),
    kind: SellerReplyReportsPaymentKind.nullable(),
  }),
  z.strictObject({
    reason: z.literal('link_or_fb_delivery'),
    kind: SellerReplyReportsLinkKind.nullable(),
  }),
  z.strictObject({
    reason: z.literal('not_as_described'),
    kind: SellerReplyReportsItemKind.nullable(),
  }),
  z.strictObject({ reason: z.literal('other') }),
  z.strictObject({ reason: z.literal('as_listed') }),
])
export type SellerReplyReportsReasonInput = z.infer<typeof SellerReplyReportsReasonInput>

const Reasons = z
  .array(SellerReplyReportsReasonInput)
  .min(1)
  .max(6)
  .superRefine((reasons, ctx) => {
    const codes = reasons.map((r) => r.reason)
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', message: 'seller-reply-reports.duplicate_reason' })
    }
    if (codes.includes('as_listed') && codes.length > 1) {
      ctx.addIssue({ code: 'custom', message: 'seller-reply-reports.as_listed_alone' })
    }
  })

/** A tap on a chip. `userId` is the session's user, set by the procedure, never by the client. */
export const SellerReplyReportsSubmitInput = z.strictObject({
  userId: Uuid,
  source: Source,
  listingId: SellerReplyReportsListingId,
  reasons: Reasons,
})
export type SellerReplyReportsSubmitInput = z.infer<typeof SellerReplyReportsSubmitInput>

/** Replaces a report's reasons, within the edit window (24 h). */
export const SellerReplyReportsEditInput = z.strictObject({
  userId: Uuid,
  reportId: UuidV7,
  reasons: Reasons,
})
export type SellerReplyReportsEditInput = z.infer<typeof SellerReplyReportsEditInput>

export const SellerReplyReportsWithdrawInput = z.strictObject({ userId: Uuid, reportId: UuidV7 })
export type SellerReplyReportsWithdrawInput = z.infer<typeof SellerReplyReportsWithdrawInput>

/** Whether the report sheet may be offered on this listing for this user. */
export const SellerReplyReportsCanReportInput = z.strictObject({
  userId: Uuid,
  listingIds: z.array(SellerReplyReportsListingId).min(1).max(500),
})
export type SellerReplyReportsCanReportInput = z.infer<typeof SellerReplyReportsCanReportInput>

/** Shown to the reporter. Deliberately coarse: `not_shown` covers every internal cause. */
export const SellerReplyReportsStatus = z.enum([
  'saved',
  'helping_warn',
  'not_shown',
  'removed_after_check',
  'withdrawn',
])
export type SellerReplyReportsStatus = z.infer<typeof SellerReplyReportsStatus>

/** Internal only; never in a user-facing view. `pending` until the aggregator has assessed it. */
export const SellerReplyReportsEligibility = z.enum([
  'pending',
  'eligible',
  'no_open',
  'too_soon',
  'too_late',
  'email_unverified',
  'not_active',
  'too_new',
  'rate_limited',
  'burst_hold',
  'tester',
  'messaging_off',
  'noise',
  'suppressed',
])
export type SellerReplyReportsEligibility = z.infer<typeof SellerReplyReportsEligibility>

export const SellerReplyReportsLevel = z.enum(['none', 'single', 'multiple'])
export type SellerReplyReportsLevel = z.infer<typeof SellerReplyReportsLevel>
export const SellerReplyReportsOutcome = z.enum(['upheld', 'not_upheld', 'void', 'unknown'])
export type SellerReplyReportsOutcome = z.infer<typeof SellerReplyReportsOutcome>
export const SellerReplyReportsOutcomeBy = z.enum([
  'review',
  'corroboration',
  'correction',
  'report_then_buy',
  'ban',
])
export type SellerReplyReportsOutcomeBy = z.infer<typeof SellerReplyReportsOutcomeBy>
/** Whether a stored reason counts: in every path, only in path B (design §4.1), or never. */
export const SellerReplyReportsCounts = z.enum(['any_path', 'path_b_only', 'none'])
export type SellerReplyReportsCounts = z.infer<typeof SellerReplyReportsCounts>
/** Distance from the listing's display place to the reported place, in km bands (ASCII codes). */
export const SellerReplyReportsDistanceBand = z.enum([
  'lt_10',
  '10_25',
  '25_50',
  '50_100',
  '100_plus',
  'unknown',
])
export type SellerReplyReportsDistanceBand = z.infer<typeof SellerReplyReportsDistanceBand>
/** `own`: reports on the listing itself; `copy`: reports spread from its copy-advert cluster. */
export const SellerReplyReportsScope = z.enum(['own', 'copy'])
export type SellerReplyReportsScope = z.infer<typeof SellerReplyReportsScope>
export const SellerReplyReportsHoldReason = z.enum(['burst', 'gem_burst', 'counter_report'])
export type SellerReplyReportsHoldReason = z.infer<typeof SellerReplyReportsHoldReason>
/** How many people, as shown: never an exact count under 10 (docs/decisions.md:15). */
export const SellerReplyReportsPersonsBand = z.enum(['none', 'one', 'several', 'exact'])
export type SellerReplyReportsPersonsBand = z.infer<typeof SellerReplyReportsPersonsBand>

export const SellerReplyReportsResolveInput = z.strictObject({
  reportIds: z.array(UuidV7).min(1).max(500),
  outcome: SellerReplyReportsOutcome,
  by: SellerReplyReportsOutcomeBy,
})
export type SellerReplyReportsResolveInput = z.infer<typeof SellerReplyReportsResolveInput>

/** One row of the internal view `seller_reply_reports.v_listing_evidence`. No user ID. */
export const SellerReplyReportsListingEvidence = z.strictObject({
  listingId: Uuid,
  source: Source,
  family: SellerReplyReportsFamily,
  scope: SellerReplyReportsScope,
  personsBand: SellerReplyReportsPersonsBand,
  personsExact: z.int().min(10).nullable(),
  level: SellerReplyReportsLevel,
  placeId: SellerReplyReportsPlaceId.nullable(),
  distanceBand: SellerReplyReportsDistanceBand.nullable(),
  held: z.boolean(),
  holdReason: SellerReplyReportsHoldReason.nullable(),
  carriedFromRelist: z.boolean(),
  ruleVersion: z.string().min(1),
  asOf: IsoTimestamp,
})
export type SellerReplyReportsListingEvidence = z.infer<typeof SellerReplyReportsListingEvidence>

/** One row of `seller_reply_reports.v_reporter_signals` (account-integrity and the admin path only). */
export const SellerReplyReportsReporterSignal = z.strictObject({
  userId: Uuid,
  reports24h: z.int().nonnegative(),
  reports30d: z.int().nonnegative(),
  notUpheld: z.int().nonnegative(),
  voided: z.int().nonnegative(),
  overLimit: z.int().nonnegative(),
  burstInvolvement: z.int().nonnegative(),
})
export type SellerReplyReportsReporterSignal = z.infer<typeof SellerReplyReportsReporterSignal>

/** One row of the user-facing `app.v_seller_reply_reports_mine`: the caller's own reports. */
export const SellerReplyReportsMine = z.strictObject({
  reportId: UuidV7,
  listingId: Uuid,
  reasons: z.array(SellerReplyReportsReason).min(1),
  status: SellerReplyReportsStatus,
  createdAt: IsoTimestamp,
  withdrawable: z.boolean(),
})
export type SellerReplyReportsMine = z.infer<typeof SellerReplyReportsMine>

/** Error codes returned as values (rule 3). `rate_limited` is never returned: the report saves. */
export const SellerReplyReportsErrorCode = z.enum([
  'seller-reply-reports.off',
  'seller-reply-reports.invalid_input',
  'seller-reply-reports.not_eligible',
  'seller-reply-reports.duplicate_reason',
  'seller-reply-reports.as_listed_alone',
  'seller-reply-reports.edit_window_closed',
  'seller-reply-reports.not_found',
])
export type SellerReplyReportsErrorCode = z.infer<typeof SellerReplyReportsErrorCode>

export const SellerReplyReportsError = z.strictObject({
  code: SellerReplyReportsErrorCode,
  message: z.string().min(1),
})
export type SellerReplyReportsError = z.infer<typeof SellerReplyReportsError>

const ReportIds = z.array(UuidV7).min(1).max(500)
const ListingIds = z.array(Uuid).min(1).max(500)

export const SellerReplyReportsRecordedEvent = z.strictObject({
  source: Source,
  reportIds: ReportIds,
  recordedAt: IsoTimestamp,
})
export type SellerReplyReportsRecordedEvent = z.infer<typeof SellerReplyReportsRecordedEvent>
export const SellerReplyReportsEvidenceChangedEvent = z.strictObject({
  source: Source,
  listingIds: ListingIds,
  changedAt: IsoTimestamp,
})
export type SellerReplyReportsEvidenceChangedEvent = z.infer<
  typeof SellerReplyReportsEvidenceChangedEvent
>
export const SellerReplyReportsResolvedEvent = z.strictObject({
  reportIds: ReportIds,
  resolvedAt: IsoTimestamp,
})
export type SellerReplyReportsResolvedEvent = z.infer<typeof SellerReplyReportsResolvedEvent>

/** Events this module publishes. Payloads carry IDs and times only (rule 7). */
export const events = defineEvents(module, {
  /** Reports were submitted, edited or withdrawn: their listings need aggregating. */
  'seller-reply-reports.recorded': { 1: SellerReplyReportsRecordedEvent },
  /** The evidence of these listings changed (suspected-labels re-evaluates them). */
  'seller-reply-reports.evidence-changed': { 1: SellerReplyReportsEvidenceChangedEvent },
  /** These reports received an outcome. */
  'seller-reply-reports.resolved': { 1: SellerReplyReportsResolvedEvent },
})
