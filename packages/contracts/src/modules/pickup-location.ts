import { z } from 'zod'
import { defineEvents, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { LocationPoint } from './location'

// Contracts of the pickup-location module (docs/design/modules/pickup-location.md): where an item
// really is, resolved from the listing's location field and the place names and postcodes in its
// title and description, published only at town or area level. Import from
// '@nabvy/contracts/modules/pickup-location'. Nothing here carries a coordinate finer than a
// gazetteer display point, a full postcode, a street or a seller field
// (docs/decisions.md, "Where an item really is"). Model output is facts and text only.

export const module = 'pickup-location'

/**
 * The rule version: `r<n>.<first 8 hex of the sha256 of the cues, stop-list and thresholds>`,
 * part of the idempotency key (listing, pass, evidence hash, rule version).
 */
export const PickupLocationVersion = z.string().regex(/^r\d+\.[0-9a-f]{8}$/)
export type PickupLocationVersion = z.infer<typeof PickupLocationVersion>

/** Which input a resolution ran over: the search card (title, town label) or the detail text. */
export const PickupLocationPass = z.enum(['card', 'detail'])
export type PickupLocationPass = z.infer<typeof PickupLocationPass>

/** What the resolved point rests on (the card's "basis"). */
export const PickupLocationBasis = z.enum(['field', 'text', 'ai', 'fallback'])
export type PickupLocationBasis = z.infer<typeof PickupLocationBasis>

/** The resolution status (listing-location draft §3.7). */
export const PickupLocationStatus = z.enum([
  'confirmed',
  'from_description',
  'conflicting',
  'field_only',
  'uncertain',
  'unknown',
])
export type PickupLocationStatus = z.infer<typeof PickupLocationStatus>

/** Which signal the shown area comes from, as the user-facing view names it. */
export const PickupLocationSource = z.enum(['both', 'description', 'listing', 'none'])
export type PickupLocationSource = z.infer<typeof PickupLocationSource>

/** How sure the rules are; a level, never a number the rules did not measure. */
export const PickupLocationConfidence = z.enum(['high', 'medium', 'low', 'none'])
export type PickupLocationConfidence = z.infer<typeof PickupLocationConfidence>

/** Who settled the resolution. */
export const PickupLocationDecidedBy = z.enum(['rules', 'ai', 'review'])
export type PickupLocationDecidedBy = z.infer<typeof PickupLocationDecidedBy>

/**
 * A note shown beside the area. The wording is the owner's (docs/questions/pickup-location.md);
 * only the code crosses the boundary, and the place it names is always a gazetteer label.
 */
export const PickupLocationNoteCode = z.enum([
  'description_says_collection_from',
  'listed_in',
  'description_names_other_pickup',
  'description_delivers_elsewhere',
  'pickup_place_not_stated',
])
export type PickupLocationNoteCode = z.infer<typeof PickupLocationNoteCode>

/** The role a place mention plays in the text (draft §2.3). */
export const PickupLocationRole = z.enum([
  'pickup',
  'seller_base',
  'meetup',
  'near',
  'delivery_area',
  'origin',
  'mention',
])
export type PickupLocationRole = z.infer<typeof PickupLocationRole>

/** How strong the cue beside a mention is. */
export const PickupLocationCueStrength = z.enum(['strong', 'medium', 'weak'])
export type PickupLocationCueStrength = z.infer<typeof PickupLocationCueStrength>

/** What kind of place a candidate is. */
export const PickupLocationCandidateKind = z.enum(['place', 'postcode_full', 'postcode_district'])
export type PickupLocationCandidateKind = z.infer<typeof PickupLocationCandidateKind>

/** Why a candidate was not used. */
export const PickupLocationRejection = z.enum([
  'stop_list',
  'tag_block',
  'no_gazetteer_match',
  'no_point',
  'weak_cue',
  'not_pickup_class',
  'far_from_field',
])
export type PickupLocationRejection = z.infer<typeof PickupLocationRejection>

/** Where a mention was found. */
export const PickupLocationTextSource = z.enum(['title', 'description'])
export type PickupLocationTextSource = z.infer<typeof PickupLocationTextSource>

/** A handover fact that is stated, denied or unstated. */
export const PickupLocationYesNoUnknown = z.enum(['yes', 'no', 'unknown'])
export type PickupLocationYesNoUnknown = z.infer<typeof PickupLocationYesNoUnknown>

/** Where a delivery or postage offer comes from; the text never overrides a field (draft §2.4). */
export const PickupLocationHandoverSource = z.enum(['field', 'text', 'none'])
export type PickupLocationHandoverSource = z.infer<typeof PickupLocationHandoverSource>

/** The handover facts of one listing version. */
export const PickupLocationHandover = z.strictObject({
  collection: PickupLocationYesNoUnknown,
  meetupOffered: z.boolean(),
  localDelivery: PickupLocationHandoverSource,
  postage: PickupLocationHandoverSource,
  deliveryOnlyText: z.boolean(),
  postageOnlyText: z.boolean(),
  courierOnlyText: z.boolean(),
})
export type PickupLocationHandover = z.infer<typeof PickupLocationHandover>

/** A gazetteer label: a town, area or city-page name; never a street or a full postcode. */
const AreaLabel = z.string().min(1).max(120)
/** A whole postcode district, the finest area ever shown (draft §3.8). */
const District = z.string().regex(/^[A-Z]{1,2}[0-9]{1,2}$/)

/** One row of `pickup_location.v_areas`: the resolved area of a listing, internal readers. */
export const PickupLocationArea = z.strictObject({
  listingId: Uuid,
  townOrArea: AreaLabel.nullable(),
  approximate: z.boolean(),
  conflict: z.boolean(),
  basis: PickupLocationBasis,
  status: PickupLocationStatus,
})
export type PickupLocationArea = z.infer<typeof PickupLocationArea>

/** One row of `app.v_pickup_location`, the user-facing view (draft §4.3, reduced to what exists). */
export const PickupLocationUserRow = z.strictObject({
  listingId: Uuid,
  townOrArea: AreaLabel,
  approximate: z.boolean(),
  areaId: z.string().min(1).max(200),
  areaDistrict: District.nullable(),
  /** Not resolved yet: `location` has no landmass data (README.md, "Decisions"). */
  areaLandmass: z.null(),
  status: PickupLocationStatus,
  source: PickupLocationSource,
  noteCode: PickupLocationNoteCode.nullable(),
  notePlaceLabel: AreaLabel.nullable(),
  listedInLabel: AreaLabel.nullable(),
  /** The display point: a gazetteer centroid, never the listing's own coordinates. */
  lat: LocationPoint.shape.lat,
  lng: LocationPoint.shape.lng,
  uncertaintyKm: z.int().min(0).max(500).nullable(),
  collection: PickupLocationYesNoUnknown,
  meetupOffered: z.boolean(),
  localDelivery: PickupLocationHandoverSource,
  postage: PickupLocationHandoverSource,
})
export type PickupLocationUserRow = z.infer<typeof PickupLocationUserRow>

/** One row of `pickup_location.v_evidence` (review-console only): a mention or a candidate. */
export const PickupLocationEvidence = z.strictObject({
  listingId: Uuid,
  pass: PickupLocationPass,
  evidenceHash: DetailEvidenceHash,
  ruleVersion: PickupLocationVersion,
  kind: z.enum(['mention', 'candidate']),
  seq: z.int().min(0),
  role: PickupLocationRole.nullable(),
  cue: z.string().max(60).nullable(),
  strength: PickupLocationCueStrength.nullable(),
  /** The gazetteer label or district of a candidate; null for a mention. */
  label: AreaLabel.nullable(),
  rejection: PickupLocationRejection.nullable(),
  /** The quote after `quote-redaction`; a full postcode never survives it. */
  quote: z.string().max(400).nullable(),
  source: PickupLocationTextSource.nullable(),
  start: z.int().min(0).nullable(),
  end: z.int().min(1).nullable(),
})
export type PickupLocationEvidence = z.infer<typeof PickupLocationEvidence>

/** The resolved point of one listing, for TypeScript callers of `pointsFor()`. */
export const PickupLocationPoint = z.strictObject({
  listingId: Uuid,
  point: LocationPoint,
  townOrArea: AreaLabel,
  approximate: z.boolean(),
  basis: PickupLocationBasis,
})
export type PickupLocationPoint = z.infer<typeof PickupLocationPoint>

/**
 * Model output for the AI lane (draft §3.9): facts and text only, validated before use. The
 * lane is off in this push and no caller talks to a model; the schema fixes the shape now so a
 * later worker cannot widen it. `quote` must be found verbatim in the redacted text it was
 * given, and `place` is matched against the gazetteer like any text mention: the model never
 * chooses an ID or a coordinate.
 */
export const PickupLocationOutput = z.strictObject({
  answer: z.enum(['text_place', 'listing_field', 'unknown']),
  place: z.string().min(1).max(80).nullable(),
  role: PickupLocationRole.nullable(),
  quote: z.string().min(1).max(200).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type PickupLocationOutput = z.infer<typeof PickupLocationOutput>

/** A reviewer's correction (`review-console`): the area a listing is really in. */
export const PickupLocationOverride = z.strictObject({
  listingId: Uuid,
  /** A gazetteer area ID as `v_areas`' readers know it (`cp:<city page>` or `town:<page>:<slug>`). */
  areaId: z.string().min(1).max(200),
  by: Uuid,
  reason: z.string().min(1).max(500),
})
export type PickupLocationOverride = z.infer<typeof PickupLocationOverride>

const ListingIds = z.array(Uuid).min(1).max(500)

/** Listings whose current version was resolved (a new resolution, or one already stored). */
export const PickupLocationResolvedEvent = z.strictObject({ listingIds: ListingIds })
export type PickupLocationResolvedEvent = z.infer<typeof PickupLocationResolvedEvent>

/** Listings whose user-visible area, status, note, conflict or handover moved. */
export const PickupLocationChangedEvent = z.strictObject({ listingIds: ListingIds })
export type PickupLocationChangedEvent = z.infer<typeof PickupLocationChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'pickup-location.resolved': { 1: PickupLocationResolvedEvent },
  'pickup-location.changed': { 1: PickupLocationChangedEvent },
})

/** Error codes the module returns as values. */
export const PickupLocationErrorCode = z.enum([
  'pickup-location.too_many_listings', // a batch over 500 listing IDs
  'pickup-location.area_not_found', // an override names an area the gazetteer does not know
])
export type PickupLocationErrorCode = z.infer<typeof PickupLocationErrorCode>
