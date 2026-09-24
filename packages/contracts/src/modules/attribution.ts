import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the attribution module (services/attribution): who brought each user (UTM tags,
// Dub partner links and customer referral codes), and the calls that follow a paid invoice.
// Import from '@nabvy/contracts/modules/attribution'.
//
// Two kinds of "referred", never mixed (services/attribution/README.md, "Decisions"):
//   - a peer's own referral code (`referral_codes` / `referrals`): give-£5-get-£5, entirely on
//     usage-ledger, never touches Dub;
//   - a Dub partner link or creator code (`affiliateClickId` / `affiliateCode`): the creator's
//     commission is tracked and clawed back through the injected `AttributionPartnerClient`.
// This module publishes no events: nothing downstream consumes a lead, sale or reversal (card,
// "Outputs"); the registry below is declared for `test/contracts.test.ts` and stays empty until
// a reader needs one.

export const module = 'attribution'

export const events = defineEvents(module, {})

// ---------------------------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------------------------

const utmField = z.string().min(1).max(200).nullable()
/** A caller-supplied idempotency key: a Stripe invoice or event ID. Same shape as usage-ledger's. */
export const AttributionRefId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/, 'printable ASCII, no spaces')
export type AttributionRefId = z.infer<typeof AttributionRefId>

/** A peer's own shareable code: 8 characters, unambiguous alphabet (no 0/O/1/I). */
export const AttributionReferralCode = z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/)
export type AttributionReferralCode = z.infer<typeof AttributionReferralCode>

/** A Dub-issued creator code, looser than our own (Dub's own format, not ours to constrain). */
export const AttributionAffiliateCode = z.string().min(1).max(64)
export type AttributionAffiliateCode = z.infer<typeof AttributionAffiliateCode>

export const AttributionSaleKind = z.enum(['subscription', 'topup'])
export type AttributionSaleKind = z.infer<typeof AttributionSaleKind>

export const AttributionReversalReason = z.enum(['chargeback', 'refund'])
export type AttributionReversalReason = z.infer<typeof AttributionReversalReason>

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** Captured once at sign-up: UTM tags, a Dub click or creator code, and a peer's referral code. */
export const AttributionCaptureInput = z.strictObject({
  userId: Uuid,
  utmSource: utmField.default(null),
  utmMedium: utmField.default(null),
  utmCampaign: utmField.default(null),
  utmContent: utmField.default(null),
  utmTerm: utmField.default(null),
  /** Dub's first-party click cookie, read at sign-up. */
  affiliateClickId: z.string().min(1).max(200).nullable().default(null),
  /** A creator's code typed with no click ("codes attribute without a click", docs/affiliates.md). */
  affiliateCode: AttributionAffiliateCode.nullable().default(null),
  /** A peer's own code, resolved against `referral_codes`. Unknown or self is dropped, not refused. */
  referralCode: AttributionReferralCode.nullable().default(null),
})
export type AttributionCaptureInput = z.infer<typeof AttributionCaptureInput>
export type AttributionCaptureInputRaw = z.input<typeof AttributionCaptureInput>

/** A paid invoice, already resolved by the caller (this module verifies no Stripe signature). */
export const AttributionSaleInput = z.strictObject({
  userId: Uuid,
  invoiceId: AttributionRefId,
  kind: AttributionSaleKind,
  amountMinor: z.int().min(1).max(2_147_483_647),
  currency: z.literal('GBP'),
})
export type AttributionSaleInput = z.infer<typeof AttributionSaleInput>
export type AttributionSaleInputRaw = z.input<typeof AttributionSaleInput>

/** A dispute or a legally required refund on a previously tracked sale. */
export const AttributionReversalInput = z.strictObject({
  userId: Uuid,
  /** The Stripe dispute or refund event ID: this reversal's own idempotency key. */
  stripeEventId: AttributionRefId,
  reason: AttributionReversalReason,
})
export type AttributionReversalInput = z.infer<typeof AttributionReversalInput>

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

/** One user's attribution: the `attribution.v_attributions` row (rule 3: never typed twice). */
export const AttributionRecord = z.strictObject({
  userId: Uuid,
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  utmContent: z.string().nullable(),
  utmTerm: z.string().nullable(),
  affiliateClickId: z.string().nullable(),
  affiliateCode: z.string().nullable(),
  affiliatePartnerId: z.string().nullable(),
  referralCode: AttributionReferralCode,
  referredBy: Uuid.nullable(),
  referredAt: IsoTimestamp.nullable(),
  creditedAt: IsoTimestamp.nullable(),
  capturedAt: IsoTimestamp,
})
export type AttributionRecord = z.infer<typeof AttributionRecord>

export const AttributionSaleResult = z.strictObject({
  /** Whether a Dub sale was tracked: false when the user carries no affiliate attribution. */
  trackedSale: z.boolean(),
  /** Whether the give-£5-get-£5 pair was credited by this call (false on a replay or no pair). */
  creditedReferral: z.boolean(),
})
export type AttributionSaleResult = z.infer<typeof AttributionSaleResult>

// ---------------------------------------------------------------------------------------------
// The injected partner platform (services/attribution/README.md, "Decisions"): Dub Partners does
// not exist as an account yet, so callers inject a client; the default is in-memory only.
// ---------------------------------------------------------------------------------------------

export const AttributionLeadResult = z.strictObject({ partnerId: z.string().nullable() })
export type AttributionLeadResult = z.infer<typeof AttributionLeadResult>

// ---------------------------------------------------------------------------------------------
// Errors: `attribution.<code>`
// ---------------------------------------------------------------------------------------------

export const AttributionErrorCode = z.enum([
  /** The module is not on: rule 11 names no exception for this module. */
  'attribution.off',
  /** A referral code that resolves to the signing-up user themself (docs/affiliates.md, "Prohibited"). */
  'attribution.self_referral',
  /** Sign-up was already captured for this user; a second call with different details is refused. */
  'attribution.mismatch',
  /** The account named is inactive (suspended or banned). */
  'attribution.account_inactive',
])
export type AttributionErrorCode = z.infer<typeof AttributionErrorCode>

export const AttributionError = z.strictObject({ code: AttributionErrorCode, message: z.string() })
export type AttributionError = z.infer<typeof AttributionError>

export const ATTRIBUTION_MESSAGES: Record<AttributionErrorCode, string> = {
  'attribution.off': 'Attribution is paused for a moment. Nothing was recorded.',
  'attribution.self_referral': 'A referral code cannot be your own.',
  'attribution.mismatch': 'Sign-up was already recorded with different details.',
  'attribution.account_inactive': 'This account cannot be credited right now.',
}
