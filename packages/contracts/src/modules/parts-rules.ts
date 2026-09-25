import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { ProductCatalogueId } from './product-catalogue'

// Contracts of the parts-rules module (docs/design/modules/parts-rules.md): the rule pass over
// each listing version, what the rules found, where, and what they left open. Import from
// '@nabvy/contracts/modules/parts-rules'. The view rows are written here as Zod, as
// detail-evidence's are: drizzle-zod is not a dependency yet (services/parts-rules/README.md).
// Rules find facts and quote where they found them; nothing here carries a price.

export const module = 'parts-rules'

/**
 * The rule version: `r<n>.<first 8 hex of part-patterns.json's sha256>`, so a new copy of the
 * patterns is a new version without anyone remembering to bump it. Part of the idempotency key
 * (listing, evidence hash, rule version).
 */
export const PartsRulesVersion = z.string().regex(/^r\d+\.[0-9a-f]{8}$/)
export type PartsRulesVersion = z.infer<typeof PartsRulesVersion>

/** The part a hit names: one per `fields` pattern of `part-patterns.json`. */
export const PartsRulesPartType = z.enum([
  'gpu',
  'cpu',
  'ram_size',
  'ram_generation',
  'storage_size',
  'storage_type',
  'psu_wattage',
  'chipset',
])
export type PartsRulesPartType = z.infer<typeof PartsRulesPartType>

/** Where a hit or signal was found. `attribute` covers structured attributes and detail sections. */
export const PartsRulesSource = z.enum(['title', 'description', 'attribute'])
export type PartsRulesSource = z.infer<typeof PartsRulesSource>

/**
 * The candidate inclusion status, from about 80 characters around the quote: `offered` when
 * nothing demotes it; `mention` for "upgraded to", "waiting for", "equivalent to", swaps and
 * "I buy"; `not_included` for "not included" and the like. A candidate only: `parts-record`
 * decides.
 */
export const PartsRulesInclusion = z.enum(['offered', 'mention', 'not_included'])
export type PartsRulesInclusion = z.infer<typeof PartsRulesInclusion>

/**
 * What the quote states, parsed from the quote alone (never a guess). `attributeName` is set when
 * the source is an attribute. GPU and CPU carry the catalogue's family and candidates when
 * `resolve()` named a family but not one item; `model` is the `gpuModels` name matched inside a
 * GPU hit.
 */
export const PartsRulesAttrs = z.strictObject({
  attributeName: z.string().max(200).optional(),
  model: z.string().max(100).optional(),
  family: z.string().max(100).optional(),
  candidates: z.array(ProductCatalogueId).max(50).optional(),
  gb: z.number().positive().optional(),
  modules: z.int().positive().optional(),
  moduleGb: z.number().positive().optional(),
  ddr: z.int().min(1).max(9).optional(),
  amount: z.number().positive().optional(),
  unit: z.enum(['gb', 'tb']).optional(),
  type: z.enum(['nvme', 'm2', 'ssd', 'hdd', 'sata']).optional(),
  watts: z.int().positive().optional(),
  chipset: z.string().max(20).optional(),
})
export type PartsRulesAttrs = z.infer<typeof PartsRulesAttrs>

/** A reviewer's correction of one rule part (`applyCorrection`, for `review-console`). */
export const PartsRulesCorrection = z
  .strictObject({
    listingId: Uuid,
    evidenceHash: DetailEvidenceHash,
    ruleVersion: PartsRulesVersion,
    seq: z.int().min(0),
    /** The inclusion status the reviewer read, when it differs from the candidate. */
    inclusion: PartsRulesInclusion.optional(),
    /** True when the hit is not a part at all (a false match). */
    rejected: z.boolean().optional(),
    by: Uuid,
    reason: z.string().min(1).max(500),
  })
  .refine((c) => c.inclusion !== undefined || c.rejected !== undefined, {
    message: 'a correction sets inclusion or rejected',
  })
export type PartsRulesCorrection = z.infer<typeof PartsRulesCorrection>

/** A stored correction, as `v_rule_parts` shows it. */
export const PartsRulesStoredCorrection = z.strictObject({
  inclusion: PartsRulesInclusion.optional(),
  rejected: z.boolean().optional(),
  by: Uuid,
  reason: z.string(),
  at: IsoTimestamp,
})
export type PartsRulesStoredCorrection = z.infer<typeof PartsRulesStoredCorrection>

/** One row of `parts_rules.v_rule_parts`: one hit, with its source, quote and position. */
export const PartsRulesPart = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  ruleVersion: PartsRulesVersion,
  /** The hit's order in the run: attributes first, then title, then description. */
  seq: z.int().min(0),
  partType: PartsRulesPartType,
  /** Null when the catalogue named no single item, or the part type has no catalogue. */
  catalogueId: ProductCatalogueId.nullable(),
  attrs: PartsRulesAttrs,
  inclusionCandidate: PartsRulesInclusion,
  source: PartsRulesSource,
  /** The stored text, verbatim, between `start` and `end`. */
  quote: z.string().min(1),
  /** UTF-16 offsets into the stored title, description or attribute value. */
  start: z.int().min(0),
  end: z.int().min(1),
  ruleId: z.string().min(1).max(100),
  correction: PartsRulesStoredCorrection.nullable(),
})
export type PartsRulesPart = z.infer<typeof PartsRulesPart>

/** The listing kind the rules settle on, or recorded as a signal. */
export const PartsRulesKind = z.enum(['wanted_or_swap', 'laptop', 'pc', 'not_a_pc'])
export type PartsRulesKind = z.infer<typeof PartsRulesKind>

/** A listing-kind signal: one `listingKind` pattern (or box-only wording) that matched. */
export const PartsRulesSignal = z.enum([
  'wanted_or_swap',
  'laptop',
  'laptop_family',
  'pc',
  'not_a_pc',
  'cpu_or_pc',
  'box_only',
])
export type PartsRulesSignal = z.infer<typeof PartsRulesSignal>

/** One row of `parts_rules.v_kind_signals`. */
export const PartsRulesKindSignal = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  ruleVersion: PartsRulesVersion,
  signal: PartsRulesSignal,
  source: PartsRulesSource,
  quote: z.string().min(1),
  start: z.int().min(0),
  end: z.int().min(1),
  ruleId: z.string().min(1).max(100),
})
export type PartsRulesKindSignal = z.infer<typeof PartsRulesKindSignal>

/** One row of `parts_rules.v_tag_blocks`: text the rules ignored as keyword stuffing. */
export const PartsRulesTagBlock = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  ruleVersion: PartsRulesVersion,
  source: PartsRulesSource,
  start: z.int().min(0),
  end: z.int().min(1),
  ruleId: z.string().min(1).max(100),
})
export type PartsRulesTagBlock = z.infer<typeof PartsRulesTagBlock>

/**
 * Why a part is open: `not_stated` (no hit), `mention_only` (hits, none offered), `unresolved`
 * (an offered GPU or CPU hit the catalogue could not name), `conflict` (offered hits naming
 * different GPUs or CPUs).
 */
export const PartsRulesGapReason = z.enum(['not_stated', 'mention_only', 'unresolved', 'conflict'])
export type PartsRulesGapReason = z.infer<typeof PartsRulesGapReason>

export const PartsRulesPartGap = z.strictObject({
  partType: PartsRulesPartType,
  reason: PartsRulesGapReason,
})
export type PartsRulesPartGap = z.infer<typeof PartsRulesPartGap>

/** Why the kind is open: no signal at all, or signals that disagree. */
export const PartsRulesKindGap = z.enum(['no_signal', 'conflict'])
export type PartsRulesKindGap = z.infer<typeof PartsRulesKindGap>

/** One row of `parts_rules.v_gaps`: one run of the rules over one listing version. */
export const PartsRulesGap = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  ruleVersion: PartsRulesVersion,
  /** The kind the rules settled on; null when `kindGap` is set. */
  kind: PartsRulesKind.nullable(),
  kindGap: PartsRulesKindGap.nullable(),
  /** Open parts of a PC or laptop (or of a listing whose kind is open); empty otherwise. */
  parts: z.array(PartsRulesPartGap),
  /** Whether the description is `full_verified`: rules over partial text leave more open. */
  fullVerified: z.boolean(),
  doneAt: IsoTimestamp,
})
export type PartsRulesGap = z.infer<typeof PartsRulesGap>

/** Listings whose current version the rules ran over (a new run, or one already stored). */
export const PartsRulesRanEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type PartsRulesRanEvent = z.infer<typeof PartsRulesRanEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'parts-rules.ran': { 1: PartsRulesRanEvent },
})

/** Error codes the module returns as values. */
export const PartsRulesErrorCode = z.enum([
  'parts-rules.too_many_listings', // a batch over 500 listing IDs
  'parts-rules.part_not_found', // a correction names no stored rule part
])
export type PartsRulesErrorCode = z.infer<typeof PartsRulesErrorCode>
