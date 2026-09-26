import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'

// Contracts of the noise-filter module (docs/design/modules/noise-filter.md): reason codes that
// mark a listing as not a real offer of what someone searched for (wanted, buy-in and swap
// adverts, laptops, box-only listings, mention-only hits, keyword stuffing, service adverts).
// Nothing is deleted or hidden here: `spec-match` applies the reasons with a visible count.
// Nothing here carries a price, a seller field or a label on behaviour. Import from
// '@nabvy/contracts/modules/noise-filter'. View rows are Zod here, as listing-assessment's are;
// `contracts.test.ts` compares their keys with the Drizzle view declarations.

export const module = 'noise-filter'

/** The classification rule version: `n<n>.<first 8 hex of the rules' digest>`. */
export const NoiseFilterRuleVersion = z.string().regex(/^n\d+\.[0-9a-f]{8}$/)
export type NoiseFilterRuleVersion = z.infer<typeof NoiseFilterRuleVersion>

/** SHA-256 (hex) of everything one classification read (`NoiseFilterClassification.inputHash`). */
export const NoiseFilterInputHash = z.string().regex(/^[0-9a-f]{64}$/)

/**
 * Why a listing is not a real offer of what was searched for:
 * - `wanted`: the title asks for an item (wanted, WTB, looking for, want to buy);
 * - `buy_in`: the listing's own offer is to buy ("I buy", "we buy", "cash for your") in the title,
 *   or in the description's first sentence when the title offers no part;
 * - `swap`: the title offers a swap for something else, not a sale that welcomes swaps;
 * - `laptop`: parts-record's kind is laptop (a mobile RTX 5080 is a different chip);
 * - `box_only`: listing-assessment's form is box only;
 * - `mention_only`: every search term that found it names a part the listing only mentions;
 * - `keyword_stuffing`: every search term that found it hits only inside a tag block;
 * - `service`: a service or repair advert, not an item.
 */
export const NoiseFilterReason = z.enum([
  'wanted',
  'buy_in',
  'swap',
  'laptop',
  'box_only',
  'mention_only',
  'keyword_stuffing',
  'service',
])
export type NoiseFilterReason = z.infer<typeof NoiseFilterReason>

/**
 * How one found-by search term relates to the listing: `generic` (the term names no model
 * number, for example "gaming pc"), `offered` (a part naming it is offered), `mention` (parts
 * name it, none offered), `tag_only` (it occurs only inside tag blocks), `unplaced` (it occurs
 * outside tag blocks but no part reads it) or `absent` (it occurs nowhere in the text and no part
 * names it). `unplaced` and `absent` are unknown, never noise.
 */
export const NoiseFilterTermStatus = z.enum([
  'generic',
  'offered',
  'mention',
  'tag_only',
  'unplaced',
  'absent',
])
export type NoiseFilterTermStatus = z.infer<typeof NoiseFilterTermStatus>

/** One found-by term as the classification read it. */
export const NoiseFilterTerm = z.strictObject({
  term: z.string().min(1).max(200),
  /** The model number the term names ("5080"), or null for a generic term. */
  key: z.string().min(1).max(20).nullable(),
  status: NoiseFilterTermStatus,
})
export type NoiseFilterTerm = z.infer<typeof NoiseFilterTerm>

/** Where a reason's evidence sits: a quote and its offsets in the title or description, or none. */
export const NoiseFilterEvidence = z.strictObject({
  reason: NoiseFilterReason,
  /** `title` or `description` for a quote; `kind`, `form` or `terms` for another module's value. */
  source: z.enum(['title', 'description', 'kind', 'form', 'terms']),
  quote: z.string().min(1).max(400).nullable(),
  start: z.int().min(0).nullable(),
  end: z.int().min(1).nullable(),
})
export type NoiseFilterEvidence = z.infer<typeof NoiseFilterEvidence>

/** One row of `noise_filter.v_classifications`: the latest classification of a listing version. */
export const NoiseFilterClassification = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  inputHash: NoiseFilterInputHash,
  ruleVersion: NoiseFilterRuleVersion,
  /** Empty when the listing is a real offer as far as these rules can tell. */
  reasons: z.array(NoiseFilterReason).max(8),
  evidence: z.array(NoiseFilterEvidence).max(64),
  terms: z.array(NoiseFilterTerm).max(64),
  /** T1 of the input: when listing-ingest first fetched the listing. */
  fetchedAt: IsoTimestamp.nullable(),
  /** This module's done time (rule 10), written once. */
  classifiedAt: IsoTimestamp,
})
export type NoiseFilterClassification = z.infer<typeof NoiseFilterClassification>

/** One row of `app.v_noise_filter_reasons`: a listing with at least one reason. */
export const NoiseFilterListingReasons = z.strictObject({
  listingId: Uuid,
  reasons: z.array(NoiseFilterReason).min(1).max(8),
})
export type NoiseFilterListingReasons = z.infer<typeof NoiseFilterListingReasons>

/** Listings whose current version has a classification (written now, or already current). */
export const NoiseFilterClassifiedEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type NoiseFilterClassifiedEvent = z.infer<typeof NoiseFilterClassifiedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'noise-filter.classified': { 1: NoiseFilterClassifiedEvent },
})

/** Error codes the module returns as values. */
export const NoiseFilterErrorCode = z.enum([
  'noise-filter.too_many_listings', // a batch over 500 listing IDs
])
export type NoiseFilterErrorCode = z.infer<typeof NoiseFilterErrorCode>
