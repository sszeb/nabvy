import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { ListingIngestCardHash } from './listing-ingest'

// Contracts of the warning-signs module (docs/design/modules/warning-signs.md): listing-level
// warning facts, each with its evidence (a redacted quote or a number), a rule ID and a rule
// version. Neutral facts for users and inputs for the scam review; no scores, no labels, no
// seller field or seller key. Import from '@nabvy/contracts/modules/warning-signs'. View rows are
// Zod here, as noise-filter's are; `contracts.test.ts` compares their keys with the Drizzle view
// declarations.

export const module = 'warning-signs'

/** The rule version of the configured rules: `w<n>.<first 8 hex of the rules' digest>`. */
export const WarningSignsRuleVersion = z.string().regex(/^w\d+\.[0-9a-f]{8}$/)
export type WarningSignsRuleVersion = z.infer<typeof WarningSignsRuleVersion>

/** SHA-256 (hex) of everything one evaluation read (`WarningSignsFact.inputHash`). */
export const WarningSignsInputHash = z.string().regex(/^[0-9a-f]{64}$/)

/**
 * A warning fact's code. Text rules read the title always and the description only when it is
 * `full_verified` (too-good-to-be-true design §2.1); on other text a text fact is unknown, never
 * written.
 * - `pay_first_text`: payment, a deposit or a holding fee asked before viewing, collection or
 *   posting, or a kind risky at any time (friends and family, gift, voucher, crypto); replaces the
 *   build pack's `deposit_request` (design §2.2 L2);
 * - `platform_claim_text`: "Facebook delivery", "Meta Pay", a payment link, or a link that is not
 *   facebook.com (L3);
 * - `away_story_text`: the seller cannot meet (W1);
 * - `off_platform_contact_text`: a phone number, email, link or messaging app in the text (W2);
 * - `urgency_text`: "must go today", "first to see will buy" (W4);
 * - `thin_text`: a full description under the configured length once template text is removed (W3);
 * - `viewing_offered_text`: an in-person check offered, "welcome to test" (X1);
 * - `payment_on_collection_text`: payment tied to the handover, "cash on collection" (X1);
 * - `protected_payment_text`: a buyer-protected payment offered, "PayPal goods and services" (X2);
 * - `box_only`: listing-assessment's `box_only` caution (box-only wording);
 * - `mining_text`: mining wording (`docs/packs/gpu-pc.md:40`);
 * - `untested_text`: untested or sold-as-seen wording (`docs/packs/gpu-pc.md:41`);
 * - `not_working_text`: "for parts" or "not working" wording, a real offer and not noise
 *   (`docs/packs/gpu-pc.md:47`);
 * - `stock_phrasing_text`: trade stock phrasing ("7-day return/warranty on all purchases");
 *   internal only, a trade-seller input for `suspected-labels`;
 * - `ask_far_below_similar`: the ask is at or below the configured share of its index group's
 *   median, at n≥10, and no material-state wording explains it;
 * - `low_ask_explained`: such an ask, with wording that may explain it (`reason`).
 */
export const WarningSignsFactCode = z.enum([
  'pay_first_text',
  'platform_claim_text',
  'away_story_text',
  'off_platform_contact_text',
  'urgency_text',
  'thin_text',
  'viewing_offered_text',
  'payment_on_collection_text',
  'protected_payment_text',
  'box_only',
  'mining_text',
  'untested_text',
  'not_working_text',
  'stock_phrasing_text',
  'ask_far_below_similar',
  'low_ask_explained',
])
export type WarningSignsFactCode = z.infer<typeof WarningSignsFactCode>

/**
 * Why a low ask may be explained (design §6.5). The first six are material state and keep
 * `ask_far_below_similar` from being written; `swap_or_trade`, `offers` and `cosmetic` are
 * recorded and never explain it.
 */
export const WarningSignsLowAskReason = z.enum([
  'not_working',
  'for_parts',
  'named_fault',
  'box_only',
  'core_part_missing',
  'part_not_included',
  'swap_or_trade',
  'offers',
  'cosmetic',
])
export type WarningSignsLowAskReason = z.infer<typeof WarningSignsLowAskReason>

/** The payment kind of a `pay_first_text` fact (design §2.2, L2). */
export const WarningSignsPayKind = z.enum([
  'bank_transfer',
  'friends_and_family',
  'deposit',
  'voucher_gift_or_crypto',
  'other',
])
export type WarningSignsPayKind = z.infer<typeof WarningSignsPayKind>

/** The contact kind of an `off_platform_contact_text` fact. */
export const WarningSignsContactKind = z.enum(['phone', 'email', 'link', 'app'])
export type WarningSignsContactKind = z.infer<typeof WarningSignsContactKind>

/** A quote in the title or description, already passed through quote-redaction's `redact`. */
const QuoteEvidence = z.strictObject({
  type: z.literal('quote'),
  source: z.enum(['title', 'description']),
  /** Redacted; offsets are those of the stored text (redaction may change the quote's length). */
  quote: z.string().min(1).max(200),
  start: z.int().min(0),
  end: z.int().min(1),
  /** `pay_first_text` only. */
  payKind: WarningSignsPayKind.optional(),
  /** `pay_first_text` only: an explicit before-cue ("upfront", "to hold") was in the clause. */
  beforeCue: z.boolean().optional(),
  /** `off_platform_contact_text` only. */
  contactKind: WarningSignsContactKind.optional(),
  /** `not_working_text` only. */
  state: z.enum(['not_working', 'for_parts']).optional(),
})

/** Another module's value: listing-assessment's caution or parts, or the description length. */
const ValueEvidence = z.strictObject({
  type: z.literal('value'),
  source: z.enum(['assessment', 'description']),
  /** The caution, part type or exclusion read, e.g. `box_only`, `gpu`. */
  value: z.string().min(1).max(60).nullable(),
  /** `thin_text`: characters left once template text is removed. */
  chars: z.int().min(0).optional(),
})

/** An ask against its index group (asking-price-index `v_groups`, `v_members`). */
const AskEvidence = z.strictObject({
  type: z.literal('ask'),
  groupKey: z.string().min(1).max(400),
  /** The group's `as_of`: the version of the figures read. */
  asOf: IsoTimestamp,
  askMinor: z.int().min(0),
  medianMinor: z.int().min(1),
  n: z.int().min(1),
  currency: z.string().length(3),
  /** ask ÷ median, rounded to 3 places. */
  ratio: z.number().min(0),
})

/** The evidence a fact carries. `low_ask_explained` carries the wording's, not the ask's. */
export const WarningSignsEvidence = z.discriminatedUnion('type', [
  QuoteEvidence,
  ValueEvidence,
  AskEvidence,
])
export type WarningSignsEvidence = z.infer<typeof WarningSignsEvidence>

/** One row of `warning_signs.v_facts`: a fact of the latest evaluation of a listing. */
export const WarningSignsFact = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  cardHash: ListingIngestCardHash,
  inputHash: WarningSignsInputHash,
  code: WarningSignsFactCode,
  /** `low_ask_explained` only. */
  reason: WarningSignsLowAskReason.nullable(),
  evidence: WarningSignsEvidence,
  /** `<module>.<code>`, e.g. `warning-signs.pay_first_text`. */
  ruleId: z.string().regex(/^warning-signs\.[a-z_]+$/),
  ruleVersion: WarningSignsRuleVersion,
  /** T1 of the input: when listing-ingest first fetched the listing. */
  fetchedAt: IsoTimestamp.nullable(),
  /** When this fact was first found for this input (the done time, rule 10). */
  foundAt: IsoTimestamp,
})
export type WarningSignsFact = z.infer<typeof WarningSignsFact>

/**
 * One row of `app.v_warning_signs`: a user-facing fact of a listing's latest evaluation. The
 * evidence text is the redacted quote, and null while quote-redaction is not on (fail closed) or
 * for a fact with no quote.
 */
export const WarningSignsListingFact = z.strictObject({
  listingId: Uuid,
  code: WarningSignsFactCode,
  evidenceText: z.string().min(1).max(200).nullable(),
})
export type WarningSignsListingFact = z.infer<typeof WarningSignsListingFact>

/** Listings whose latest evaluation was written or confirmed by this call. */
export const WarningSignsFoundEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type WarningSignsFoundEvent = z.infer<typeof WarningSignsFoundEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'warning-signs.found': { 1: WarningSignsFoundEvent },
})

/** Error codes the module returns as values. */
export const WarningSignsErrorCode = z.enum([
  'warning-signs.too_many_listings', // a batch over 500 listing IDs
])
export type WarningSignsErrorCode = z.infer<typeof WarningSignsErrorCode>
