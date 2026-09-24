import { z } from 'zod'
import { defineEvents, IsoTimestamp, Source, Uuid } from '../index'

// Contracts of the detail-evidence module (docs/design/modules/detail-evidence.md): every detail
// version of a listing, keyed by its evidence hash, with how complete it is, and the record of
// every detail fetch. Import from '@nabvy/contracts/modules/detail-evidence'. The view rows are
// written here as Zod, as listing-ingest's are: drizzle-zod is not a dependency yet
// (services/detail-evidence/README.md, "Decisions").

export const module = 'detail-evidence'

/**
 * The evidence hash (rule 8 of docs/design/modules/_rules.md): SHA-256, lowercase hex, of the
 * brief's allowlist only (title, full description, attributes, detail sections, custom title and
 * subtitles, condition, category). Price, availability, status, location and cache status stay
 * out. The idempotency key of a detail stage is `source + sourceListingId + evidenceHash`.
 */
export const DetailEvidenceHash = z.string().regex(/^[0-9a-f]{64}$/)
export type DetailEvidenceHash = z.infer<typeof DetailEvidenceHash>

/**
 * The actor's `descriptionStatus`. Only `full_verified` counts as complete; `descriptionComplete`
 * is undocumented and is not read (docs/questions.md, question 10).
 */
export const DetailEvidenceDescriptionStatus = z.enum(['full_verified', 'partial', 'missing'])
export type DetailEvidenceDescriptionStatus = z.infer<typeof DetailEvidenceDescriptionStatus>

/** One seller attribute or detail section as the actor gives it (`{ label, value, attribute_name }`). */
export const DetailEvidenceAttribute = z.strictObject({
  name: z.string().nullable(),
  label: z.string().nullable(),
  value: z.string().nullable(),
})
export type DetailEvidenceAttribute = z.infer<typeof DetailEvidenceAttribute>

const JobId = z.int().positive()
const SourceListingId = z.string().regex(/^[0-9A-Za-z_-]{1,200}$/)

/** One row of `detail_evidence.v_current`: the listing's current version, without the text. */
export const DetailEvidenceVersion = z.strictObject({
  listingId: Uuid,
  source: Source,
  sourceListingId: SourceListingId,
  evidenceHash: DetailEvidenceHash,
  firstSeenAt: IsoTimestamp,
  lastSeenAt: IsoTimestamp,
  itemJobId: JobId,
  itemSeq: z.int().min(0),
  descriptionStatus: DetailEvidenceDescriptionStatus.nullable(),
  /** Whether the version has any description text (the text itself is in `v_text`). */
  hasDescription: z.boolean(),
  attributes: z.array(DetailEvidenceAttribute),
  detailSections: z.array(DetailEvidenceAttribute),
  customTitle: z.string().nullable(),
  customSubtitles: z.array(z.string()),
  /** The machine value of the Condition attribute (`used_good`, `new`, ...), never the label. */
  condition: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryPath: z.array(z.string()),
  inventoryType: z.string().nullable(),
  /** Coarse coordinates, as the actor gives them. */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  galleryTotal: z.int().min(0).nullable(),
  galleryComplete: z.boolean().nullable(),
  /** Gallery photo IDs in gallery order; empty when the route returned no gallery. */
  photoIds: z.array(z.string()),
  /** When the gallery links stop working: 104 hours after collection unless the links say. */
  linksExpireAt: IsoTimestamp.nullable(),
  detailOutcome: z.string().nullable(),
  /** True while every fetch of this version came from a stale cache (`stale-fallback`). */
  staleFallback: z.boolean(),
})
export type DetailEvidenceVersion = z.infer<typeof DetailEvidenceVersion>

/** One row of `detail_evidence.v_text`: the description text of every version. */
export const DetailEvidenceText = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  descriptionStatus: DetailEvidenceDescriptionStatus.nullable(),
  description: z.string().nullable(),
  title: z.string(),
})
export type DetailEvidenceText = z.infer<typeof DetailEvidenceText>

/** One row of `detail_evidence.v_outcomes`: one detail fetch of one listing in one job. */
export const DetailEvidenceOutcome = z.strictObject({
  listingId: Uuid.nullable(),
  source: Source,
  sourceListingId: SourceListingId,
  jobId: JobId,
  seq: z.int().min(0),
  fetchedAt: IsoTimestamp,
  detailOutcome: z.string().nullable(),
  detailAttempts: z.int().min(0).nullable(),
  descriptionStatus: DetailEvidenceDescriptionStatus.nullable(),
  cacheStatus: z.string().nullable(),
  staleFallback: z.boolean(),
  /** The actor could not identify the requested ID: recorded as unresolved, never as sold. */
  unresolved: z.boolean(),
  /** Null when the fetch gave no evidence (unresolved, or an extraction error). */
  evidenceHash: DetailEvidenceHash.nullable(),
})
export type DetailEvidenceOutcome = z.infer<typeof DetailEvidenceOutcome>

/** One row of `detail_evidence.v_fingerprints`: hash of the current normalised description. */
export const DetailEvidenceFingerprint = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
})
export type DetailEvidenceFingerprint = z.infer<typeof DetailEvidenceFingerprint>

const ListingIds = z.array(Uuid).min(1).max(500)

/** Listings whose current version changed (a new version, or a fresh fetch of another one). */
export const DetailEvidenceChangedEvent = z.strictObject({ listingIds: ListingIds })
export type DetailEvidenceChangedEvent = z.infer<typeof DetailEvidenceChangedEvent>

/** Listings whose detail fetch could not identify the item: unresolved, never sold. */
export const DetailEvidenceUnresolvedEvent = z.strictObject({ listingIds: ListingIds })
export type DetailEvidenceUnresolvedEvent = z.infer<typeof DetailEvidenceUnresolvedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'detail-evidence.changed': { 1: DetailEvidenceChangedEvent },
  'detail-evidence.unresolved': { 1: DetailEvidenceUnresolvedEvent },
})

/** Error codes the module returns as values. */
export const DetailEvidenceErrorCode = z.enum([
  'detail-evidence.job_not_found', // the job is not in apify_gateway.v_jobs (or the gateway is off)
  'detail-evidence.listing_not_ingested', // a detail row's listing is not in listing_ingest.v_listings yet
])
export type DetailEvidenceErrorCode = z.infer<typeof DetailEvidenceErrorCode>
