import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the listing-assessment module, all in the Postgres schema 'listing_assessment'
// (packages/db/README.md). Only services/listing-assessment writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate listing-assessment

export const schema = moduleSchema('listing-assessment')

const at = (name: string) => timestamp(name, { withTimezone: true })
const HASH = `'^[0-9a-f]{64}$'`
const RULE_VERSION = `'^a[0-9]+\\.[0-9a-f]{8}$'`
const FORMS = `('system', 'bundle', 'part', 'box_only', 'unknown')`
const REASONS = `('parts', 'attributes', 'title_words', 'kind', 'unplaced', 'placed', 'box_only')`
const GPU_STATES = `('named', 'none', 'integrated', 'in_photos', 'not_stated', 'conflicting')`

/**
 * One row per assessment of one listing version against one parts record, one card and one rule
 * version: the idempotency key is (listing, evidence hash, card hash, record hash, rule version),
 * nulls not distinct. `record_hash` is the SHA-256 of what the assessment read from parts-record
 * (the kind, the record's versions and every part's decision), so a new record, or a reviewer's
 * correction there, gives a new row; the views show the latest. No `kind` column: parts-record
 * owns the kind, and `v_assessments` reads it from `parts_record.v_records`. `assessed_at` is T3
 * (rule 10), written once. The listing ID is listing-ingest's, held as a plain value (rule 4).
 */
export const assessments = schema.table(
  'assessments',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    cardHash: text('card_hash'),
    recordHash: text('record_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    form: text('form').notNull(),
    container: boolean('container').notNull(),
    containerReason: text('container_reason').notNull(),
    gpuState: text('gpu_state').notNull(),
    cautions: jsonb('cautions').notNull().default([]),
    coverage: jsonb('coverage').notNull(),
    confirmedParts: jsonb('confirmed_parts').notNull().default([]),
    exclusions: jsonb('exclusions').notNull().default([]),
    extras: jsonb('extras').notNull().default([]),
    unknowns: jsonb('unknowns').notNull().default([]),
    assessedAt: at('assessed_at').notNull(),
    correction: jsonb('correction'),
    ...timestampColumns(),
  },
  (t) => [
    unique('assessments_version_key')
      .on(t.listingId, t.evidenceHash, t.cardHash, t.recordHash, t.ruleVersion)
      .nullsNotDistinct(),
    index('assessments_listing_assessed_idx').on(t.listingId, t.evidenceHash, t.assessedAt),
    check('assessments_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
    check('assessments_card_hash_check', sql.raw(`card_hash ~ ${HASH}`)),
    check('assessments_record_hash_check', sql.raw(`record_hash ~ ${HASH}`)),
    check('assessments_rule_version_check', sql.raw(`rule_version ~ ${RULE_VERSION}`)),
    check('assessments_form_check', sql.raw(`form in ${FORMS}`)),
    check('assessments_container_reason_check', sql.raw(`container_reason in ${REASONS}`)),
    check(
      'assessments_container_check',
      sql`(${t.containerReason} in ('placed', 'box_only')) = (not ${t.container})`,
    ),
    check('assessments_gpu_state_check', sql.raw(`gpu_state in ${GPU_STATES}`)),
    check(
      'assessments_arrays_check',
      sql`jsonb_typeof(${t.cautions}) = 'array' and jsonb_typeof(${t.confirmedParts}) = 'array' and jsonb_typeof(${t.exclusions}) = 'array' and jsonb_typeof(${t.extras}) = 'array' and jsonb_typeof(${t.unknowns}) = 'array'`,
    ),
    check('assessments_coverage_check', sql`jsonb_typeof(${t.coverage}) = 'object'`),
  ],
)

// Published views, created by hand-written SQL (migrations/listing-assessment/*_access.sql).
// Empty while the module's switch is off. Row types: `ListingAssessment` and
// `ListingAssessmentUnknown` in @nabvy/contracts/modules/listing-assessment.

/** Internal: the latest assessment of each listing version, parts-record's kind beside it. */
export const vAssessments = schema
  .view('v_assessments', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    cardHash: text('card_hash'),
    kind: text('kind'),
    form: text('form').notNull(),
    container: boolean('container').notNull(),
    containerReason: text('container_reason').notNull(),
    gpuState: text('gpu_state').notNull(),
    cautions: jsonb('cautions').notNull(),
    coverage: jsonb('coverage').notNull(),
    confirmedParts: jsonb('confirmed_parts').notNull(),
    exclusions: jsonb('exclusions').notNull(),
    extras: jsonb('extras').notNull(),
    ruleVersion: text('rule_version').notNull(),
    assessedAt: at('assessed_at').notNull(),
    correction: jsonb('correction'),
  })
  .existing()

/** Internal: each core part a container does not state, for "ask the seller". */
export const vUnknowns = schema
  .view('v_unknowns', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    partType: text('part_type').notNull(),
  })
  .existing()
