import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { ListingIngestCardHash } from './listing-ingest'
import {
  PartsRecordExtractor,
  PartsRecordKind,
  PartsRecordPartType,
  PartsRecordSource,
} from './parts-record'

// Contracts of the listing-assessment module (docs/design/modules/listing-assessment.md): what a
// listing is and what its parts let us conclude: container or not, form, GPU state, confirmed
// parts, exclusions, cautions and coverage, per listing version. The listing kind stays
// parts-record's (`PartsRecordKind`): `v_assessments` shows it beside these columns and nothing
// here stores it. Part types, sources and extractors are derived from parts-record's contracts,
// never retyped. Nothing here carries a price, a seller field or a label on behaviour. Import from
// '@nabvy/contracts/modules/listing-assessment'. View rows are Zod here, as parts-record's are
// (drizzle-zod is not a dependency yet; services/listing-assessment/README.md).

export const module = 'listing-assessment'

/** The assessment rule version: `a<n>.<first 8 hex of the rules' digest>`. */
export const ListingAssessmentRuleVersion = z.string().regex(/^a\d+\.[0-9a-f]{8}$/)
export type ListingAssessmentRuleVersion = z.infer<typeof ListingAssessmentRuleVersion>

/**
 * What the offer physically is: a whole `system`, a system sold with extras (`bundle`), a
 * standalone `part`, an empty `box_only`, or `unknown` when the evidence places none of these.
 * The listing kind (pc, laptop, wanted or swap, not a PC) is parts-record's, shown beside it.
 */
export const ListingAssessmentForm = z.enum(['system', 'bundle', 'part', 'box_only', 'unknown'])
export type ListingAssessmentForm = z.infer<typeof ListingAssessmentForm>

/**
 * Why a listing is (or is not) a container (R1, R1b): `parts` (at least two of CPU, RAM and
 * storage named in the description, attributes or detail sections), `attributes` (seller-entered
 * attributes such as "Processor type"), `title_words` (package, bundle, setup, job lot), `kind`
 * (the record's kind is `pc`), `unplaced` (the rules could not place it, so it is treated as one),
 * `placed` (not a container: the record placed it and nothing above holds) or `box_only` (not a
 * container: the title says box only, which comes first).
 */
export const ListingAssessmentContainerReason = z.enum([
  'parts',
  'attributes',
  'title_words',
  'kind',
  'unplaced',
  'placed',
  'box_only',
])
export type ListingAssessmentContainerReason = z.infer<typeof ListingAssessmentContainerReason>

/**
 * The GPU state of a listing version: `named` (an offered GPU in the text or attributes), `none`
 * (positive evidence that no GPU comes with it), `integrated` (the text says graphics are
 * integrated or onboard), `in_photos` (only a photo shows one), `not_stated` (silence, never a
 * "no") or `conflicting` (offered GPUs disagree, or a GPU is offered and also said to be absent).
 */
export const ListingAssessmentGpuState = z.enum([
  'named',
  'none',
  'integrated',
  'in_photos',
  'not_stated',
  'conflicting',
])
export type ListingAssessmentGpuState = z.infer<typeof ListingAssessmentGpuState>

/**
 * A caution on the listing version, each a fact: `box_only` (box-only wording), `previous_price`
 * (the card displays a previous price: a fact only, nothing inferred), `photo_only` (a part is
 * evidenced by photos only), `stale_text` (the text came from a stale cache), `bundle_price` (the
 * ask covers bundle extras as well).
 */
export const ListingAssessmentCaution = z.enum([
  'box_only',
  'previous_price',
  'photo_only',
  'stale_text',
  'bundle_price',
])
export type ListingAssessmentCaution = z.infer<typeof ListingAssessmentCaution>

/** What the assessment read: the title always, the full description, photo verdicts. */
export const ListingAssessmentCoverage = z.strictObject({
  title: z.boolean(),
  /** True only for a `full_verified` description with text. */
  fullDescription: z.boolean(),
  /** True when the parts record merged photo verdicts. */
  photos: z.boolean(),
})
export type ListingAssessmentCoverage = z.infer<typeof ListingAssessmentCoverage>

/** Where a piece of evidence sits: parts-record's sources, with a verbatim quote and offsets. */
const Evidence = {
  source: PartsRecordSource,
  quote: z.string().min(1),
  start: z.int().min(0),
  end: z.int().min(1),
}

/** A part the assessment confirms (R5): the record's part, by its `seq`, with its evidence. */
export const ListingAssessmentConfirmedPart = z.strictObject({
  seq: z.int().min(0),
  partType: PartsRecordPartType,
  catalogueId: z.string().nullable(),
  extractor: PartsRecordExtractor,
  ...Evidence,
})
export type ListingAssessmentConfirmedPart = z.infer<typeof ListingAssessmentConfirmedPart>

/** A part the listing expressly leaves out (R6: positive evidence only). */
export const ListingAssessmentExclusion = z.strictObject({
  partType: PartsRecordPartType,
  /** The record's part when a part row carries the exclusion; null for a phrase such as "no GPU". */
  seq: z.int().min(0).nullable(),
  ...Evidence,
})
export type ListingAssessmentExclusion = z.infer<typeof ListingAssessmentExclusion>

/** A bundle extra (R1c): an item sold with the system, named in the title or description. */
export const ListingAssessmentExtra = z.strictObject({
  item: z.string().min(1).max(40),
  ...Evidence,
})
export type ListingAssessmentExtra = z.infer<typeof ListingAssessmentExtra>

/** A reviewer's correction of one assessment (`applyCorrection`, for `review-console`). */
export const ListingAssessmentCorrection = z
  .strictObject({
    listingId: Uuid,
    evidenceHash: DetailEvidenceHash,
    form: ListingAssessmentForm.optional(),
    container: z.boolean().optional(),
    gpuState: ListingAssessmentGpuState.optional(),
    by: Uuid,
    reason: z.string().min(1).max(500),
  })
  .refine((c) => c.form !== undefined || c.container !== undefined || c.gpuState !== undefined, {
    message: 'a correction sets form, container or gpuState',
  })
export type ListingAssessmentCorrection = z.infer<typeof ListingAssessmentCorrection>

/** A stored correction, as `v_assessments` shows it. */
export const ListingAssessmentStoredCorrection = z.strictObject({
  form: ListingAssessmentForm.optional(),
  container: z.boolean().optional(),
  gpuState: ListingAssessmentGpuState.optional(),
  by: Uuid,
  reason: z.string(),
  at: IsoTimestamp,
})
export type ListingAssessmentStoredCorrection = z.infer<typeof ListingAssessmentStoredCorrection>

/** One row of `listing_assessment.v_assessments`: the latest assessment of a listing version. */
export const ListingAssessment = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  /** listing-ingest's card hash at assessment time; null while listing-ingest showed no card. */
  cardHash: ListingIngestCardHash.nullable(),
  /** parts-record's kind for the version, read from `v_records` (null while it is open or off). */
  kind: PartsRecordKind.nullable(),
  /** The decisions below apply a reviewer's correction when there is one. */
  form: ListingAssessmentForm,
  container: z.boolean(),
  containerReason: ListingAssessmentContainerReason,
  gpuState: ListingAssessmentGpuState,
  cautions: z.array(ListingAssessmentCaution),
  coverage: ListingAssessmentCoverage,
  confirmedParts: z.array(ListingAssessmentConfirmedPart),
  exclusions: z.array(ListingAssessmentExclusion),
  extras: z.array(ListingAssessmentExtra),
  ruleVersion: ListingAssessmentRuleVersion,
  /** T3: when the assessment of this version was first written. */
  assessedAt: IsoTimestamp,
  correction: ListingAssessmentStoredCorrection.nullable(),
})
export type ListingAssessment = z.infer<typeof ListingAssessment>

/** One row of `listing_assessment.v_unknowns`: a core part a container does not state. */
export const ListingAssessmentUnknown = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  partType: PartsRecordPartType,
})
export type ListingAssessmentUnknown = z.infer<typeof ListingAssessmentUnknown>

/** Listings whose current version has an assessment (written now, or already current). */
export const ListingAssessmentAssessedEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type ListingAssessmentAssessedEvent = z.infer<typeof ListingAssessmentAssessedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'listing-assessment.assessed': { 1: ListingAssessmentAssessedEvent },
})

/** Error codes the module returns as values. */
export const ListingAssessmentErrorCode = z.enum([
  'listing-assessment.too_many_listings', // a batch over 500 listing IDs
  'listing-assessment.not_found', //        a correction names no assessment of that version
])
export type ListingAssessmentErrorCode = z.infer<typeof ListingAssessmentErrorCode>
