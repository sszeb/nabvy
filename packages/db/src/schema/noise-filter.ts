import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the noise-filter module, all in the Postgres schema 'noise_filter' (packages/db/README.md).
// Only services/noise-filter writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate noise-filter

export const schema = moduleSchema('noise-filter')

const at = (name: string) => timestamp(name, { withTimezone: true })
const HASH = `'^[0-9a-f]{64}$'`
const RULE_VERSION = `'^n[0-9]+\\.[0-9a-f]{8}$'`
const REASONS = `'["wanted", "buy_in", "swap", "laptop", "box_only", "mention_only", "keyword_stuffing", "service"]'::jsonb`

/**
 * One row per classification of one listing version against one set of inputs and one rule
 * version: the idempotency key is (listing, evidence hash, input hash, rule version). `input_hash`
 * is the SHA-256 of everything the classification read (the kind, the form, the kind signals, the
 * tag blocks, the parts, the text and the found-by terms), so a new input from any upstream module,
 * or a search that finds the listing under a new term, gives a new row; a replay does not. The
 * views show the latest. `reasons` is empty for a listing the rules read as a real offer.
 * `fetched_at` is the input's T1 and `classified_at` this module's done time (rule 10), written
 * once. The listing ID is listing-ingest's, held as a plain value (rule 4).
 */
export const classifications = schema.table(
  'classifications',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    inputHash: text('input_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    reasons: jsonb('reasons').notNull().default([]),
    evidence: jsonb('evidence').notNull().default([]),
    terms: jsonb('terms').notNull().default([]),
    fetchedAt: at('fetched_at'),
    classifiedAt: at('classified_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('classifications_version_key').on(
      t.listingId,
      t.evidenceHash,
      t.inputHash,
      t.ruleVersion,
    ),
    index('classifications_listing_classified_idx').on(t.listingId, t.classifiedAt),
    check('classifications_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
    check('classifications_input_hash_check', sql.raw(`input_hash ~ ${HASH}`)),
    check('classifications_rule_version_check', sql.raw(`rule_version ~ ${RULE_VERSION}`)),
    check(
      'classifications_reasons_check',
      sql.raw(`jsonb_typeof(reasons) = 'array' and ${REASONS} @> reasons`),
    ),
    check(
      'classifications_arrays_check',
      sql`jsonb_typeof(${t.evidence}) = 'array' and jsonb_typeof(${t.terms}) = 'array'`,
    ),
  ],
)

// Published views, created by hand-written SQL (migrations/noise-filter/*_access.sql). Row
// types: `NoiseFilterClassification` and `NoiseFilterListingReasons` in
// @nabvy/contracts/modules/noise-filter.

/** Internal: the latest classification of each listing version. Empty while the switch is off. */
export const vClassifications = schema
  .view('v_classifications', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    inputHash: text('input_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    reasons: jsonb('reasons').notNull(),
    evidence: jsonb('evidence').notNull(),
    terms: jsonb('terms').notNull(),
    fetchedAt: at('fetched_at'),
    classifiedAt: at('classified_at').notNull(),
  })
  .existing()

/**
 * User-facing: `app.v_noise_filter_reasons`, one row per listing whose latest classification has
 * a reason; rows only while this module and listing-suppression are `on`, never a suppressed
 * listing. Off or shadow: no rows, so every listing shows.
 */
export const vNoiseFilterReasons = pgSchema('app')
  .view('v_noise_filter_reasons', {
    listingId: uuid('listing_id').notNull(),
    reasons: jsonb('reasons').notNull(),
  })
  .existing()
