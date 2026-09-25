import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the pickup-location module, all in the Postgres schema 'pickup_location'
// (packages/db/README.md). Only services/pickup-location writes them. Other modules import only
// the views (v-prefixed exports) or call pointsFor() from '@nabvy/pickup-location'. Precise
// points, full postcodes and raw mention text stay in these tables; every view below stops at a
// gazetteer label and its centroid (docs/decisions.md, "Where an item really is").
// After changing this file: pnpm db:generate pickup-location

export const schema = moduleSchema('pickup-location')

const at = (name: string) => timestamp(name, { withTimezone: true })
const HASH = "~ '^[0-9a-f]{64}$'"
const VERSION = "~ '^r[0-9]+\\.[0-9a-f]{8}$'"
const STATUSES =
  "in ('confirmed', 'from_description', 'conflicting', 'field_only', 'uncertain', 'unknown')"
const BASES = "in ('field', 'text', 'ai', 'fallback')"
const SOURCES = "in ('both', 'description', 'listing', 'none')"
const NOTES =
  "in ('description_says_collection_from', 'listed_in', 'description_names_other_pickup', 'description_delivers_elsewhere', 'pickup_place_not_stated')"
const ROLES = "in ('pickup', 'seller_base', 'meetup', 'near', 'delivery_area', 'origin', 'mention')"
const STRENGTHS = "in ('strong', 'medium', 'weak')"
const HANDOVER_SOURCES = "in ('field', 'text', 'none')"
const YES_NO = "in ('yes', 'no', 'unknown')"

/**
 * One row per run of the rules over one listing version: the idempotency key is (listing, pass,
 * evidence hash, rule version). `pass` is `card` (title and town label, from
 * `listing-ingest.first-seen`) or `detail` (the detail text, from `detail-evidence.changed`).
 * `field_lat`/`field_lng` hold the field point the rules compared against (detail coordinates
 * or the city page's point) and never leave this table; `lat`/`lng` are the display point, a
 * gazetteer centroid.
 */
export const resolutions = schema.table(
  'resolutions',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    pass: text('pass').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    status: text('status').notNull(),
    basis: text('basis').notNull(),
    source: text('source').notNull(),
    confidence: text('confidence').notNull(),
    decidedBy: text('decided_by').notNull().default('rules'),
    conflict: boolean('conflict').notNull().default(false),
    approximate: boolean('approximate').notNull().default(true),
    townOrArea: text('town_or_area'),
    areaId: text('area_id'),
    areaDistrict: text('area_district'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    uncertaintyKm: integer('uncertainty_km'),
    noteCode: text('note_code'),
    notePlaceLabel: text('note_place_label'),
    listedInLabel: text('listed_in_label'),
    fieldLabel: text('field_label'),
    fieldLat: doublePrecision('field_lat'),
    fieldLng: doublePrecision('field_lng'),
    fieldDistanceKm: doublePrecision('field_distance_km'),
    aiEligible: boolean('ai_eligible').notNull().default(false),
    inputFetchedAt: at('input_fetched_at'),
    doneAt: at('done_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    unique('resolutions_listing_pass_hash_version_key').on(
      t.listingId,
      t.pass,
      t.evidenceHash,
      t.ruleVersion,
    ),
    index('resolutions_listing_idx').on(t.listingId),
    check('resolutions_pass_check', sql`${t.pass} in ('card', 'detail')`),
    check('resolutions_hash_check', sql.raw(`evidence_hash ${HASH}`)),
    check('resolutions_version_check', sql.raw(`rule_version ${VERSION}`)),
    check('resolutions_status_check', sql.raw(`status ${STATUSES}`)),
    check('resolutions_basis_check', sql.raw(`basis ${BASES}`)),
    check('resolutions_source_check', sql.raw(`source ${SOURCES}`)),
    check(
      'resolutions_confidence_check',
      sql`${t.confidence} in ('high', 'medium', 'low', 'none')`,
    ),
    check('resolutions_decided_by_check', sql`${t.decidedBy} in ('rules', 'ai', 'review')`),
    check('resolutions_note_check', sql.raw(`note_code is null or note_code ${NOTES}`)),
    check(
      'resolutions_district_check',
      sql`${t.areaDistrict} is null or ${t.areaDistrict} ~ '^[A-Z]{1,2}[0-9]{1,2}$'`,
    ),
    check(
      'resolutions_point_check',
      sql`(${t.lat} is null) = (${t.lng} is null)
        and (${t.lat} is null or ${t.lat} between -90 and 90)
        and (${t.lng} is null or ${t.lng} between -180 and 180)`,
    ),
    check(
      'resolutions_area_check',
      sql`(${t.townOrArea} is null) = (${t.areaId} is null) and (${t.townOrArea} is null) = (${t.lat} is null)`,
    ),
    check(
      'resolutions_uncertainty_check',
      sql`${t.uncertaintyKm} is null or ${t.uncertaintyKm} between 0 and 500`,
    ),
  ],
)

/**
 * Every place or postcode the rules found in one resolution's text, with its role, cue,
 * strength, the gazetteer match (or why it was rejected) and its distance to the field point.
 * `value` is the text as found (a full postcode stays here, internal only); `label` is the
 * gazetteer label or the postcode district, the only form a view shows.
 */
export const candidates = schema.table(
  'candidates',
  {
    id: idColumn(),
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => resolutions.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    label: text('label'),
    areaId: text('area_id'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    role: text('role').notNull(),
    cue: text('cue'),
    strength: text('strength').notNull(),
    rejection: text('rejection'),
    fieldDistanceKm: doublePrecision('field_distance_km'),
    ...timestampColumns(),
  },
  (t) => [
    unique('candidates_resolution_seq_key').on(t.resolutionId, t.seq),
    index('candidates_listing_idx').on(t.listingId),
    check('candidates_seq_check', sql`${t.seq} >= 0`),
    check(
      'candidates_kind_check',
      sql`${t.kind} in ('place', 'postcode_full', 'postcode_district')`,
    ),
    check('candidates_role_check', sql.raw(`role ${ROLES}`)),
    check('candidates_strength_check', sql.raw(`strength ${STRENGTHS}`)),
    check(
      'candidates_rejection_check',
      sql`${t.rejection} is null or ${t.rejection} in ('stop_list', 'tag_block', 'no_gazetteer_match', 'no_point', 'weak_cue', 'not_pickup_class', 'far_from_field')`,
    ),
    check('candidates_point_check', sql`(${t.lat} is null) = (${t.lng} is null)`),
  ],
)

/**
 * Where each candidate was found: the source, UTF-16 offsets into the stored text, and the
 * quote after `quote-redaction` (a full postcode never survives it), so `review-console` can
 * show evidence without the raw text.
 */
export const mentions = schema.table(
  'mentions',
  {
    id: idColumn(),
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => resolutions.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').notNull(),
    seq: integer('seq').notNull(),
    candidateSeq: integer('candidate_seq').notNull(),
    source: text('source').notNull(),
    quoteStart: integer('quote_start').notNull(),
    quoteEnd: integer('quote_end').notNull(),
    quoteRedacted: text('quote_redacted').notNull(),
    role: text('role').notNull(),
    cue: text('cue'),
    strength: text('strength').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('mentions_resolution_seq_key').on(t.resolutionId, t.seq),
    index('mentions_listing_idx').on(t.listingId),
    check('mentions_source_check', sql`${t.source} in ('title', 'description')`),
    check('mentions_position_check', sql`${t.quoteStart} >= 0 and ${t.quoteEnd} > ${t.quoteStart}`),
    check('mentions_role_check', sql.raw(`role ${ROLES}`)),
    check('mentions_strength_check', sql.raw(`strength ${STRENGTHS}`)),
  ],
)

/**
 * One row per listing: the resolution consumers read, upserted with `resolutions` in one
 * transaction. A `detail` pass replaces a `card` pass; a newer evidence hash replaces an older
 * one; a review override replaces the rules' answer (`decided_by = 'review'`).
 */
export const current = schema.table(
  'current',
  {
    listingId: uuid('listing_id').primaryKey(),
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => resolutions.id, { onDelete: 'cascade' }),
    pass: text('pass').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    status: text('status').notNull(),
    basis: text('basis').notNull(),
    source: text('source').notNull(),
    decidedBy: text('decided_by').notNull().default('rules'),
    conflict: boolean('conflict').notNull().default(false),
    approximate: boolean('approximate').notNull().default(true),
    townOrArea: text('town_or_area'),
    areaId: text('area_id'),
    areaDistrict: text('area_district'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    uncertaintyKm: integer('uncertainty_km'),
    noteCode: text('note_code'),
    notePlaceLabel: text('note_place_label'),
    listedInLabel: text('listed_in_label'),
    ...timestampColumns(),
  },
  (t) => [
    check('current_pass_check', sql`${t.pass} in ('card', 'detail')`),
    check('current_status_check', sql.raw(`status ${STATUSES}`)),
    check('current_basis_check', sql.raw(`basis ${BASES}`)),
    check('current_source_check', sql.raw(`source ${SOURCES}`)),
    check('current_note_check', sql.raw(`note_code is null or note_code ${NOTES}`)),
    check(
      'current_district_check',
      sql`${t.areaDistrict} is null or ${t.areaDistrict} ~ '^[A-Z]{1,2}[0-9]{1,2}$'`,
    ),
    check(
      'current_point_check',
      sql`(${t.lat} is null) = (${t.lng} is null)
        and (${t.lat} is null or ${t.lat} between -90 and 90)
        and (${t.lng} is null or ${t.lng} between -180 and 180)`,
    ),
    check(
      'current_area_check',
      sql`(${t.townOrArea} is null) = (${t.areaId} is null) and (${t.townOrArea} is null) = (${t.lat} is null)`,
    ),
  ],
)

/** The handover facts of each listing's current version (draft §2.4): field first, text adds. */
export const handover = schema.table(
  'handover',
  {
    listingId: uuid('listing_id').primaryKey(),
    evidenceHash: text('evidence_hash').notNull(),
    collection: text('collection').notNull().default('unknown'),
    meetupOffered: boolean('meetup_offered').notNull().default(false),
    localDelivery: text('local_delivery').notNull().default('none'),
    postage: text('postage').notNull().default('none'),
    deliveryOnlyText: boolean('delivery_only_text').notNull().default(false),
    postageOnlyText: boolean('postage_only_text').notNull().default(false),
    courierOnlyText: boolean('courier_only_text').notNull().default(false),
    ...timestampColumns(),
  },
  () => [
    check('handover_collection_check', sql.raw(`collection ${YES_NO}`)),
    check('handover_local_delivery_check', sql.raw(`local_delivery ${HANDOVER_SOURCES}`)),
    check('handover_postage_check', sql.raw(`postage ${HANDOVER_SOURCES}`)),
  ],
)

/** A reviewer's correction: the gazetteer area a listing is really in. Applied on every pass. */
export const overrides = schema.table(
  'overrides',
  {
    listingId: uuid('listing_id').primaryKey(),
    areaId: text('area_id').notNull(),
    townOrArea: text('town_or_area').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    by: uuid('by').notNull(),
    reason: text('reason').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    check(
      'overrides_point_check',
      sql`${t.lat} between -90 and 90 and ${t.lng} between -180 and 180`,
    ),
    check('overrides_reason_check', sql`length(${t.reason}) between 1 and 500`),
  ],
)

/**
 * Listing versions the rules could not settle, for the AI lane (draft §3.9). The lane is off in
 * this push (question 12): rows are queued so a later worker has its work, and `done_at` stays
 * null until one runs. One row per version, whatever the rule version.
 */
export const aiQueue = schema.table(
  'ai_queue',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    reason: text('reason').notNull(),
    queuedAt: at('queued_at').notNull().defaultNow(),
    doneAt: at('done_at'),
    ...timestampColumns(),
  },
  (t) => [
    unique('ai_queue_listing_hash_key').on(t.listingId, t.evidenceHash),
    check('ai_queue_hash_check', sql.raw(`evidence_hash ${HASH}`)),
    check('ai_queue_reason_check', sql`${t.reason} in ('uncertain', 'delivers_elsewhere')`),
  ],
)

// Published views, created by hand-written SQL (migrations/pickup-location/*_access.sql). Empty
// while the module's switch is off; app.v_pickup_location has rows only while it is on. Row
// types: `PickupLocationArea`, `PickupLocationEvidence`, `PickupLocationHandover` and
// `PickupLocationUserRow` in @nabvy/contracts/modules/pickup-location.

/** Internal: the resolved area of each listing (town or area only). */
export const vAreas = schema
  .view('v_areas', {
    listingId: uuid('listing_id').notNull(),
    townOrArea: text('town_or_area'),
    approximate: boolean('approximate').notNull(),
    conflict: boolean('conflict').notNull(),
    basis: text('basis').notNull(),
    status: text('status').notNull(),
  })
  .existing()

/** Internal, review-console only: mentions and candidates with redacted quotes. */
export const vEvidence = schema
  .view('v_evidence', {
    listingId: uuid('listing_id').notNull(),
    pass: text('pass').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    kind: text('kind').notNull(),
    seq: integer('seq').notNull(),
    role: text('role'),
    cue: text('cue'),
    strength: text('strength'),
    label: text('label'),
    rejection: text('rejection'),
    quote: text('quote'),
    source: text('source'),
    start: integer('start'),
    end: integer('end'),
  })
  .existing()

/** Internal: the handover facts (for `warning-signs` and `suspected-labels`). */
export const vHandover = schema
  .view('v_handover', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    collection: text('collection').notNull(),
    meetupOffered: boolean('meetup_offered').notNull(),
    localDelivery: text('local_delivery').notNull(),
    postage: text('postage').notNull(),
    deliveryOnlyText: boolean('delivery_only_text').notNull(),
    postageOnlyText: boolean('postage_only_text').notNull(),
    courierOnlyText: boolean('courier_only_text').notNull(),
  })
  .existing()

/** Internal, for `ops-metrics`: the AI lane's queue (no calls are made in this push). */
export const vAiUsage = schema
  .view('v_ai_usage', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    reason: text('reason').notNull(),
    queuedAt: at('queued_at').notNull(),
    doneAt: at('done_at'),
  })
  .existing()

/**
 * User-facing: `app.v_pickup_location`, rows only while the module is `on`, suppressed listings
 * left out, explicit columns (draft §4.3 reduced to what this push resolves). `lat`/`lng` are
 * the display point: a gazetteer centroid, never the listing's own coordinates.
 */
export const vPickupLocation = pgSchema('app')
  .view('v_pickup_location', {
    listingId: uuid('listing_id').notNull(),
    townOrArea: text('town_or_area').notNull(),
    approximate: boolean('approximate').notNull(),
    areaId: text('area_id').notNull(),
    areaDistrict: text('area_district'),
    areaLandmass: text('area_landmass'),
    status: text('status').notNull(),
    source: text('source').notNull(),
    noteCode: text('note_code'),
    notePlaceLabel: text('note_place_label'),
    listedInLabel: text('listed_in_label'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    uncertaintyKm: integer('uncertainty_km'),
    collection: text('collection').notNull(),
    meetupOffered: boolean('meetup_offered').notNull(),
    localDelivery: text('local_delivery').notNull(),
    postage: text('postage').notNull(),
  })
  .existing()
