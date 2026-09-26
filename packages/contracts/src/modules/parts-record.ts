import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { PartsAiPromptVersion } from './parts-ai'
import {
  PartsRulesAttrs,
  PartsRulesInclusion,
  PartsRulesKind,
  PartsRulesKindGap,
  PartsRulesPartType,
  PartsRulesSource,
  PartsRulesVersion,
} from './parts-rules'
import { ProductCatalogueId } from './product-catalogue'

// Contracts of the parts-record module (docs/design/modules/parts-record.md): one versioned parts
// record per listing version, merged from the rule rows, the AI rows and (later) the photo
// verdicts. The record owns the listing kind. Every enum here is derived from parts-rules' and
// parts-ai's contracts, never retyped. Nothing here carries a price. Import from
// '@nabvy/contracts/modules/parts-record'. The view rows are written here as Zod, as parts-rules'
// and parts-ai's are: drizzle-zod is not a dependency yet (services/parts-record/README.md).

export const module = 'parts-record'

/** The listing kind the record owns: parts-rules' kinds (the model answers in the same set). */
export const PartsRecordKind = PartsRulesKind
export type PartsRecordKind = z.infer<typeof PartsRecordKind>

/** Why the kind is open when no input settled it: parts-rules' reasons. */
export const PartsRecordKindGap = PartsRulesKindGap
export type PartsRecordKindGap = z.infer<typeof PartsRecordKindGap>

/** The part a row names: parts-rules' part types (parts-ai answers in the same set). */
export const PartsRecordPartType = PartsRulesPartType
export type PartsRecordPartType = z.infer<typeof PartsRecordPartType>

/** The inclusion status the record decides: parts-rules' set, which parts-ai shares. */
export const PartsRecordInclusion = PartsRulesInclusion
export type PartsRecordInclusion = z.infer<typeof PartsRecordInclusion>

/** Where a part was found: parts-rules' sources plus `photo` (photo-review, later). */
export const PartsRecordSource = z.enum([...PartsRulesSource.options, 'photo'])
export type PartsRecordSource = z.infer<typeof PartsRecordSource>

/** Which extractor found a part, or settled the kind. */
export const PartsRecordExtractor = z.enum(['rules', 'ai', 'photo'])
export type PartsRecordExtractor = z.infer<typeof PartsRecordExtractor>

/** What a part states: parts-rules' attributes (AI parts carry the catalogue's family only). */
export const PartsRecordAttrs = PartsRulesAttrs
export type PartsRecordAttrs = z.infer<typeof PartsRecordAttrs>

/**
 * The photo-review version stamped on a record: the seam for `photo-review`, which does not exist
 * yet (docs/design/modules/soft-edges.json). Same shape as the other extractor versions.
 */
export const PartsRecordPhotoVersion = z.string().regex(/^v\d+\.[0-9a-f]{8}$/)
export type PartsRecordPhotoVersion = z.infer<typeof PartsRecordPhotoVersion>

/**
 * One photo verdict as this module accepts it from the injected `photoVerdicts` function
 * (README.md, "Decisions"): a part read from a photo, or a brand-only sighting (`catalogueId`
 * null, `family` set). Until photo-review ships, the stub returns none.
 */
export const PartsRecordPhotoVerdict = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  photoVersion: PartsRecordPhotoVersion,
  partType: PartsRecordPartType,
  catalogueId: ProductCatalogueId.nullable(),
  family: z.string().max(100).nullable(),
  /** Facebook's gallery photo ID: the "quote" of a photo part (never a URL, never bytes). */
  photoId: z.string().min(1).max(64),
})
export type PartsRecordPhotoVerdict = z.infer<typeof PartsRecordPhotoVerdict>

/** A reviewer's correction of one recorded part (`applyCorrection`, for `review-console`). */
export const PartsRecordCorrection = z
  .strictObject({
    listingId: Uuid,
    evidenceHash: DetailEvidenceHash,
    seq: z.int().min(0),
    /** The inclusion status the reviewer read, when it differs from the record's. */
    inclusion: PartsRecordInclusion.optional(),
    /** True when the row is not a part at all (a false match). */
    rejected: z.boolean().optional(),
    by: Uuid,
    reason: z.string().min(1).max(500),
  })
  .refine((c) => c.inclusion !== undefined || c.rejected !== undefined, {
    message: 'a correction sets inclusion or rejected',
  })
export type PartsRecordCorrection = z.infer<typeof PartsRecordCorrection>

/** A stored correction, as `v_parts` shows it. */
export const PartsRecordStoredCorrection = z.strictObject({
  inclusion: PartsRecordInclusion.optional(),
  rejected: z.boolean().optional(),
  by: Uuid,
  reason: z.string(),
  at: IsoTimestamp,
})
export type PartsRecordStoredCorrection = z.infer<typeof PartsRecordStoredCorrection>

/** One row of `parts_record.v_records`: the latest record of one listing version. */
export const PartsRecordRecord = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  /** Null while no input settled the kind; then `kindGap` says why. */
  kind: PartsRecordKind.nullable(),
  kindGap: PartsRecordKindGap.nullable(),
  /** Who settled the kind (`rules` or `ai`), with its quote and position. */
  kindBy: PartsRecordExtractor.nullable(),
  kindSource: PartsRecordSource.nullable(),
  kindQuote: z.string().nullable(),
  kindStart: z.int().min(0).nullable(),
  kindEnd: z.int().min(1).nullable(),
  ruleVersion: PartsRulesVersion,
  /** Null while parts-ai has no extracted result for the version (or is off). */
  aiVersion: PartsAiPromptVersion.nullable(),
  /** Null while photo-review has no verdict for the version (always, until it ships). */
  photoVersion: PartsRecordPhotoVersion.nullable(),
  /** The number of parts on the record. */
  parts: z.int().min(0),
  /** Whether any two offered parts of one type name different products (rule 6 of the card). */
  conflict: z.boolean(),
  recordedAt: IsoTimestamp,
})
export type PartsRecordRecord = z.infer<typeof PartsRecordRecord>

/** One row of `parts_record.v_parts`: one part of the latest record of a listing version. */
export const PartsRecordPart = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  /** The part's order on the record: rule parts first, then AI parts, then photo parts. */
  seq: z.int().min(0),
  partType: PartsRecordPartType,
  /** Null when no input named a single catalogue item, or the part type has no catalogue. */
  catalogueId: ProductCatalogueId.nullable(),
  attrs: PartsRecordAttrs,
  /** The record's decision: the reviewer's correction when there is one, else the extractor's. */
  inclusion: PartsRecordInclusion,
  /** True when a reviewer rejected the row as not a part; the row stays for the audit trail. */
  rejected: z.boolean(),
  source: PartsRecordSource,
  extractor: PartsRecordExtractor,
  /** The rule, prompt or photo-review version that found the part. */
  extractorVersion: z.string().min(1),
  /** The stored text between `start` and `end` (a photo part quotes its photo ID). */
  quote: z.string().min(1),
  /** UTF-16 offsets into the stored title, description or attribute value; 0 and 1 for a photo. */
  start: z.int().min(0),
  end: z.int().min(1),
  /** True when another offered part of the same type names a different product or value. */
  conflict: z.boolean(),
  correction: PartsRecordStoredCorrection.nullable(),
})
export type PartsRecordPart = z.infer<typeof PartsRecordPart>

/** Listings whose current version has a record (written now, or already current). */
export const PartsRecordRecordedEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type PartsRecordRecordedEvent = z.infer<typeof PartsRecordRecordedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'parts-record.recorded': { 1: PartsRecordRecordedEvent },
})

/** Error codes the module returns as values. */
export const PartsRecordErrorCode = z.enum([
  'parts-record.too_many_listings', // a batch over 500 listing IDs
  'parts-record.part_not_found', //   a correction names no part on the latest record
])
export type PartsRecordErrorCode = z.infer<typeof PartsRecordErrorCode>
