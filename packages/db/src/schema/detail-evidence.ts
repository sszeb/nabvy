import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the detail-evidence module, all in the Postgres schema 'detail_evidence' (packages/db/README.md).
// Only services/detail-evidence writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate detail-evidence

export const schema = moduleSchema('detail-evidence')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * One row per detail version of a listing: a new row only when the evidence hash changes. The
 * listing ID is listing-ingest's, held as a plain value (rule 4). No seller field: seller data
 * stays in apify-gateway's store, and the raw row is referenced by `item_job_id` and `item_seq`.
 */
export const evidence = schema.table(
  'evidence',
  {
    id: idColumn(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    firstSeenAt: at('first_seen_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    itemJobId: integer('item_job_id').notNull(),
    itemSeq: integer('item_seq').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    descriptionStatus: text('description_status'),
    attributes: jsonb('attributes').notNull().default(sql`'[]'::jsonb`),
    detailSections: jsonb('detail_sections').notNull().default(sql`'[]'::jsonb`),
    customTitle: text('custom_title'),
    customSubtitles: text('custom_subtitles').array().notNull().default(sql`'{}'::text[]`),
    condition: text('condition'),
    categoryId: text('category_id'),
    categoryPath: text('category_path').array().notNull().default(sql`'{}'::text[]`),
    inventoryType: text('inventory_type'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    galleryTotal: integer('gallery_total'),
    galleryComplete: boolean('gallery_complete'),
    photoIds: text('photo_ids').array().notNull().default(sql`'{}'::text[]`),
    linksExpireAt: at('links_expire_at'),
    detailOutcome: text('detail_outcome'),
    staleFallback: boolean('stale_fallback').notNull().default(false),
    conflicts: jsonb('conflicts').notNull().default(sql`'[]'::jsonb`),
    provenance: jsonb('provenance').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns(),
  },
  (t) => [
    unique('evidence_listing_hash_key').on(t.source, t.sourceListingId, t.evidenceHash),
    index('evidence_listing_idx').on(t.listingId),
    check(
      'evidence_source_check',
      sql`${t.source} in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')`,
    ),
    check('evidence_hash_check', sql`${t.evidenceHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'evidence_description_status_check',
      sql`${t.descriptionStatus} in ('full_verified', 'partial', 'missing')`,
    ),
    check('evidence_gallery_total_check', sql`${t.galleryTotal} >= 0`),
  ],
)

/**
 * One row per detail fetch: a listing's detail row in one job, with its outcome, whether the
 * actor could not identify it (`unresolved`), and the version it gave (null when it gave none).
 * The current version and the `changed` events are derived from these rows.
 */
export const fetches = schema.table(
  'fetches',
  {
    id: idColumn(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    listingId: uuid('listing_id'),
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    fetchedAt: at('fetched_at').notNull(),
    detailOutcome: text('detail_outcome'),
    detailAttempts: integer('detail_attempts'),
    descriptionStatus: text('description_status'),
    cacheStatus: text('cache_status'),
    staleFallback: boolean('stale_fallback').notNull().default(false),
    unresolved: boolean('unresolved').notNull().default(false),
    evidenceHash: text('evidence_hash'),
    ...timestampColumns(),
  },
  (t) => [
    unique('fetches_listing_job_key').on(t.source, t.sourceListingId, t.jobId),
    index('fetches_listing_fetched_idx').on(t.source, t.sourceListingId, t.fetchedAt),
    index('fetches_job_idx').on(t.jobId),
    check(
      'fetches_source_check',
      sql`${t.source} in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')`,
    ),
    check('fetches_hash_check', sql`${t.evidenceHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'fetches_description_status_check',
      sql`${t.descriptionStatus} in ('full_verified', 'partial', 'missing')`,
    ),
    check('fetches_unresolved_check', sql`not (${t.unresolved} and ${t.evidenceHash} is not null)`),
  ],
)

// Published views, created by hand-written SQL (migrations/detail-evidence/*_access.sql). Empty
// while the module's switch is off. Row types: `DetailEvidenceVersion`, `DetailEvidenceText`,
// `DetailEvidenceOutcome` and `DetailEvidenceFingerprint` in
// @nabvy/contracts/modules/detail-evidence.

/** Internal: each listing's current version, without the description text. */
export const vCurrent = schema
  .view('v_current', {
    listingId: uuid('listing_id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    firstSeenAt: at('first_seen_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    itemJobId: integer('item_job_id').notNull(),
    itemSeq: integer('item_seq').notNull(),
    descriptionStatus: text('description_status'),
    hasDescription: boolean('has_description').notNull(),
    attributes: jsonb('attributes').notNull(),
    detailSections: jsonb('detail_sections').notNull(),
    customTitle: text('custom_title'),
    customSubtitles: text('custom_subtitles').array().notNull(),
    condition: text('condition'),
    categoryId: text('category_id'),
    categoryPath: text('category_path').array().notNull(),
    inventoryType: text('inventory_type'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    galleryTotal: integer('gallery_total'),
    galleryComplete: boolean('gallery_complete'),
    photoIds: text('photo_ids').array().notNull(),
    linksExpireAt: at('links_expire_at'),
    detailOutcome: text('detail_outcome'),
    staleFallback: boolean('stale_fallback').notNull(),
  })
  .existing()

/** Internal: the description text of every version, by listing and evidence hash. */
export const vText = schema
  .view('v_text', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    descriptionStatus: text('description_status'),
    description: text('description'),
    title: text('title').notNull(),
  })
  .existing()

/** Internal: every detail fetch with its outcome. */
export const vOutcomes = schema
  .view('v_outcomes', {
    listingId: uuid('listing_id'),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    fetchedAt: at('fetched_at').notNull(),
    detailOutcome: text('detail_outcome'),
    detailAttempts: integer('detail_attempts'),
    descriptionStatus: text('description_status'),
    cacheStatus: text('cache_status'),
    staleFallback: boolean('stale_fallback').notNull(),
    unresolved: boolean('unresolved').notNull(),
    evidenceHash: text('evidence_hash'),
  })
  .existing()

/** Internal: SHA-256 of the current version's normalised description, for copy-advert. */
export const vFingerprints = schema
  .view('v_fingerprints', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    fingerprint: text('fingerprint').notNull(),
  })
  .existing()
