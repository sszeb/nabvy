import { z } from 'zod'
import { Currency, defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { ListingIngestCardHash } from './listing-ingest'
import { LocationPoint } from './location'
import { PartsRecordExtractor, PartsRecordSource } from './parts-record'
import {
  WantManagerCriterion,
  WantManagerDeliveryMethod,
  WantManagerPartType,
  WantManagerPriceMinor,
  WantManagerRadiusKm,
} from './want-manager'

// Contracts of the spec-match module (docs/design/modules/spec-match.md): wants matched against
// listings by the parts they contain, including parts inside PCs, and spec searches on demand.
// Each criterion is `match`, `no_match` or `not_stated`; silence is never a "no". Part types come
// from want-manager, sources and extractors from parts-record, never retyped. Nothing here carries
// a computed price, a seller field or a label on behaviour: the only money is the want's own cap
// and the search's own range. Import from '@nabvy/contracts/modules/spec-match'.

export const module = 'spec-match'

/** The matching rule version: `s<n>.<first 8 hex of the rules' digest>`. */
export const SpecMatchRuleVersion = z.string().regex(/^s\d+\.[0-9a-f]{8}$/)
export type SpecMatchRuleVersion = z.infer<typeof SpecMatchRuleVersion>

/** SHA-256 (hex) of everything one verdict read (`SpecMatchMatch` input hash). */
export const SpecMatchInputHash = z.string().regex(/^[0-9a-f]{64}$/)

/**
 * A criterion's status, and a whole verdict: `match` (every criterion matches), `no_match` (one
 * criterion has positive evidence against it) or `not_stated` (nothing against, something
 * unstated: "ask the seller"). A partial or missing description never gives `no_match` on a part.
 */
export const SpecMatchVerdict = z.enum(['match', 'no_match', 'not_stated'])
export type SpecMatchVerdict = z.infer<typeof SpecMatchVerdict>

/** What a criterion is about: a wanted part, the want's price cap, or its area. */
export const SpecMatchCriterionKind = z.enum(['part', 'price', 'distance'])
export type SpecMatchCriterionKind = z.infer<typeof SpecMatchCriterionKind>

/**
 * Why a criterion reads as it does:
 * - parts: `named` (an included part satisfies it), `different` (included parts of that type
 *   name something else, over a full description), `excluded` (the listing says the part is not
 *   included, or says it has no GPU or only integrated graphics, over a full description),
 *   `not_named` (silence), `partial_text` (something else is named but the description is not
 *   `full_verified`), `partly_named` (the part is named but not settled: one wanted attribute is
 *   unstated, such as 16GB RAM with no generation; a family that includes the wanted item; or a
 *   second part of the type that conflicts), `ambiguous` (several sizes that only add up to the
 *   wanted one, or "or better" with no catalogue ranking), `in_photos` (only a photo shows it);
 * - price: `within_cap`, `over_cap`, `other_currency` (never converted), `no_price`;
 * - distance: `within_radius`, `beyond_radius`, `posted` (the listing posts and the want accepts
 *   posting), `not_posted` (a posted-only want and a listing that states collection only),
 *   `unknown_point`.
 */
export const SpecMatchReason = z.enum([
  'named',
  'different',
  'excluded',
  'not_named',
  'partial_text',
  'partly_named',
  'ambiguous',
  'in_photos',
  'within_cap',
  'over_cap',
  'other_currency',
  'no_price',
  'within_radius',
  'beyond_radius',
  'posted',
  'not_posted',
  'unknown_point',
])
export type SpecMatchReason = z.infer<typeof SpecMatchReason>

/**
 * One quoted piece of evidence: a part of parts-record's latest record (by `seq`) or one of
 * listing-assessment's exclusions (`seq` null for a phrase such as "no GPU"). In the user-facing
 * view and in search output the quote has passed `quote-redaction`; it is null while that module
 * is off (fail closed).
 */
export const SpecMatchEvidence = z.strictObject({
  seq: z.int().min(0).nullable(),
  source: PartsRecordSource,
  extractor: PartsRecordExtractor.nullable(),
  quote: z.string().min(1).max(400).nullable(),
  start: z.int().min(0),
  end: z.int().min(1),
})
export type SpecMatchEvidence = z.infer<typeof SpecMatchEvidence>

/** One criterion's result for one want (or search) and one listing. */
export const SpecMatchCriterionResult = z.strictObject({
  kind: SpecMatchCriterionKind,
  /** The criterion's position in the want (part criteria only). */
  position: z.int().min(0).max(9).nullable(),
  /** The wanted part type (part criteria only). */
  partType: WantManagerPartType.nullable(),
  status: SpecMatchVerdict,
  reason: SpecMatchReason,
  evidence: z.array(SpecMatchEvidence).max(10),
  /** The rounded distance for a distance criterion when both points are known. */
  distanceKm: z.number().nonnegative().nullable(),
})
export type SpecMatchCriterionResult = z.infer<typeof SpecMatchCriterionResult>

/** Whether the listing was found by a search for this want, or by another user's search. */
export const SpecMatchOrigin = z.enum(['own_search', 'other_search'])
export type SpecMatchOrigin = z.infer<typeof SpecMatchOrigin>

/**
 * One result as a user sees it (`app.v_spec_match_results`, `results()`, `search()`): the verdict
 * and every criterion, quotes redacted. `insidePc` puts it in the collapsed "inside a PC" section.
 * Search results carry no want, match, origin or T5.
 */
export const SpecMatchResult = z.strictObject({
  matchId: Uuid.nullable(),
  wantId: Uuid.nullable(),
  listingId: Uuid,
  verdict: SpecMatchVerdict,
  insidePc: z.boolean(),
  origin: SpecMatchOrigin.nullable(),
  /** True for a match found by the backfill of a new or edited want: in-app and digest only. */
  backfill: z.boolean(),
  criteria: z.array(SpecMatchCriterionResult).max(12),
  matchedAt: IsoTimestamp.nullable(),
})
export type SpecMatchResult = z.infer<typeof SpecMatchResult>

/** One row of `spec_match.v_matches`: the latest verdict of each want and listing (no user ID). */
export const SpecMatchMatch = z.strictObject({
  matchId: Uuid,
  wantId: Uuid,
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  cardHash: ListingIngestCardHash.nullable(),
  inputHash: SpecMatchInputHash,
  ruleVersion: SpecMatchRuleVersion,
  verdict: SpecMatchVerdict,
  criteria: z.array(SpecMatchCriterionResult).max(12),
  insidePc: z.boolean(),
  origin: SpecMatchOrigin,
  backfill: z.boolean(),
  /** T5: when this verdict was written. */
  matchedAt: IsoTimestamp,
})
export type SpecMatchMatch = z.infer<typeof SpecMatchMatch>

/** The owner's sorts (docs/decisions.md). `best_position` needs asking-price-position (soft). */
export const SpecMatchSort = z.enum(['nearest', 'cheapest', 'newest', 'best_position'])
export type SpecMatchSort = z.infer<typeof SpecMatchSort>

/** A condition token as the feed filter spells it (want-manager's placeholder shape). */
const ConditionToken = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)

/**
 * A spec search on demand: want-shaped criteria plus the owner's filters and sort. Runs over the
 * shared views only: no fetch and no model call.
 */
export const SpecMatchSearchInput = z
  .strictObject({
    userId: Uuid,
    criteria: z.array(WantManagerCriterion).min(1).max(10),
    /** The user's point (from their postcode via `location`); null: distance not stated. */
    point: LocationPoint.nullable(),
    radiusKm: WantManagerRadiusKm.nullable(),
    currency: Currency,
    priceMinMinor: WantManagerPriceMinor.optional(),
    priceMaxMinor: WantManagerPriceMinor.optional(),
    condition: z.array(ConditionToken).max(10).optional(),
    handover: z.array(WantManagerDeliveryMethod).min(1).max(2).optional(),
    sort: SpecMatchSort.default('newest'),
    limit: z.int().min(1).max(100).default(50),
  })
  .refine(
    (s) =>
      s.priceMinMinor === undefined ||
      s.priceMaxMinor === undefined ||
      s.priceMinMinor <= s.priceMaxMinor,
    { message: 'priceMinMinor is at most priceMaxMinor' },
  )
export type SpecMatchSearchInput = z.input<typeof SpecMatchSearchInput>

/** Results in two sections, and how many the user's preferences hid (visible counts). */
export const SpecMatchResults = z.strictObject({
  standalone: z.array(SpecMatchResult).max(100),
  insidePc: z.array(SpecMatchResult).max(100),
  hidden: z.strictObject({
    noise: z.int().nonnegative(),
    spam: z.int().nonnegative(),
    multiQuantity: z.int().nonnegative(),
  }),
})
export type SpecMatchResults = z.infer<typeof SpecMatchResults>

/** Matches whose verdict changed (new, or different from the pair's previous verdict). */
export const SpecMatchMatchedEvent = z.strictObject({
  matchIds: z.array(Uuid).min(1).max(500),
})
export type SpecMatchMatchedEvent = z.infer<typeof SpecMatchMatchedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'spec-match.matched': { 1: SpecMatchMatchedEvent },
})

/** Error codes the module returns as values. */
export const SpecMatchErrorCode = z.enum([
  'spec-match.too_many_listings', // a batch over 500 listing IDs
  'spec-match.too_many_wants', //    a batch over 500 want IDs
  'spec-match.invalid_input', //     a search input that does not parse
  'spec-match.off', //               spec search while the module is not on
  'spec-match.account_inactive', //  the account is suspended or banned
])
export type SpecMatchErrorCode = z.infer<typeof SpecMatchErrorCode>
