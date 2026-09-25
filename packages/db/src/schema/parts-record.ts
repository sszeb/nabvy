import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the parts-record module, all in the Postgres schema 'parts_record'
// (packages/db/README.md). Only services/parts-record writes them. Other modules import only the
// views (v-prefixed exports). After changing this file: pnpm db:generate parts-record

export const schema = moduleSchema('parts-record')

const at = (name: string) => timestamp(name, { withTimezone: true })
const HASH = `'^[0-9a-f]{64}$'`
const RULE_VERSION = `'^r[0-9]+\\.[0-9a-f]{8}$'`
const AI_VERSION = `'^p[0-9]+\\.[0-9a-f]{8}$'`
const PHOTO_VERSION = `'^v[0-9]+\\.[0-9a-f]{8}$'`
const KINDS = `('wanted_or_swap', 'laptop', 'pc', 'not_a_pc')`
const KIND_GAPS = `('no_signal', 'conflict')`
const EXTRACTORS = `('rules', 'ai', 'photo')`
const SOURCES = `('title', 'description', 'attribute', 'photo')`
const INCLUSIONS = `('offered', 'mention', 'not_included')`
const PART_TYPES = `('gpu', 'cpu', 'ram_size', 'ram_generation', 'storage_size', 'storage_type', 'psu_wattage', 'chipset')`

/**
 * One row per merge of one listing version at one set of extractor versions: the idempotency key
 * is (listing, evidence hash, rule version, AI version, photo version), nulls not distinct. A new
 * extractor result for the same version writes a new row; the views show the latest. Holds the
 * kind the record owns, who settled it and where. The listing ID is listing-ingest's, held as a
 * plain value (rule 4).
 */
export const records = schema.table(
  'records',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    aiVersion: text('ai_version'),
    photoVersion: text('photo_version'),
    kind: text('kind'),
    kindGap: text('kind_gap'),
    kindBy: text('kind_by'),
    kindSource: text('kind_source'),
    kindQuote: text('kind_quote'),
    kindStart: integer('kind_start'),
    kindEnd: integer('kind_end'),
    partCount: integer('part_count').notNull(),
    conflict: boolean('conflict').notNull().default(false),
    recordedAt: at('recorded_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    unique('records_version_key')
      .on(t.listingId, t.evidenceHash, t.ruleVersion, t.aiVersion, t.photoVersion)
      .nullsNotDistinct(),
    index('records_listing_recorded_idx').on(t.listingId, t.evidenceHash, t.recordedAt),
    check('records_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
    check('records_rule_version_check', sql.raw(`rule_version ~ ${RULE_VERSION}`)),
    check('records_ai_version_check', sql.raw(`ai_version ~ ${AI_VERSION}`)),
    check('records_photo_version_check', sql.raw(`photo_version ~ ${PHOTO_VERSION}`)),
    check('records_kind_check', sql.raw(`kind in ${KINDS}`)),
    check('records_kind_gap_check', sql.raw(`kind_gap in ${KIND_GAPS}`)),
    check('records_kind_by_check', sql.raw(`kind_by in ('rules', 'ai')`)),
    check('records_kind_source_check', sql.raw(`kind_source in ${SOURCES}`)),
    check('records_part_count_check', sql`${t.partCount} >= 0`),
    check(
      'records_kind_complete_check',
      sql`(${t.kind} is null and ${t.kindGap} is not null and ${t.kindBy} is null and ${t.kindSource} is null and ${t.kindQuote} is null and ${t.kindStart} is null and ${t.kindEnd} is null) or (${t.kind} is not null and ${t.kindGap} is null and ${t.kindBy} is not null and ((${t.kindQuote} is null and ${t.kindSource} is null and ${t.kindStart} is null and ${t.kindEnd} is null) or (${t.kindQuote} is not null and ${t.kindSource} is not null and ${t.kindStart} >= 0 and ${t.kindEnd} > ${t.kindStart})))`,
    ),
  ],
)

/**
 * One row per part on a record: the part type, the catalogue ID (or none), the attributes as the
 * extractor stated them, the inclusion the record decided, where it was found (source, verbatim
 * quote, UTF-16 offsets; a photo part quotes its photo ID), which extractor found it at which
 * version, and whether it conflicts with another offered part of its type. A reviewer's
 * correction is kept beside it, never over it. Cascades with its record (own schema).
 */
export const parts = schema.table(
  'parts',
  {
    id: idColumn(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    seq: integer('seq').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    attrs: jsonb('attrs').notNull().default({}),
    inclusion: text('inclusion').notNull(),
    source: text('source').notNull(),
    extractor: text('extractor').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    quote: text('quote').notNull(),
    quoteStart: integer('quote_start').notNull(),
    quoteEnd: integer('quote_end').notNull(),
    conflict: boolean('conflict').notNull().default(false),
    correction: jsonb('correction'),
    ...timestampColumns(),
  },
  (t) => [
    unique('parts_record_seq_key').on(t.recordId, t.seq),
    index('parts_listing_idx').on(t.listingId, t.evidenceHash),
    index('parts_catalogue_idx').on(t.catalogueId),
    check('parts_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
    check('parts_part_type_check', sql.raw(`part_type in ${PART_TYPES}`)),
    check('parts_inclusion_check', sql.raw(`inclusion in ${INCLUSIONS}`)),
    check('parts_source_check', sql.raw(`source in ${SOURCES}`)),
    check('parts_extractor_check', sql.raw(`extractor in ${EXTRACTORS}`)),
    check(
      'parts_source_extractor_check',
      sql`(${t.extractor} = 'photo') = (${t.source} = 'photo')`,
    ),
    check('parts_position_check', sql`${t.quoteStart} >= 0 and ${t.quoteEnd} > ${t.quoteStart}`),
    check('parts_seq_check', sql`${t.seq} >= 0`),
  ],
)

// Published views, created by hand-written SQL (migrations/parts-record/*_access.sql). Empty
// while the module's switch is off. Row types: `PartsRecordRecord` and `PartsRecordPart` in
// @nabvy/contracts/modules/parts-record.

/** Internal: the latest record of each listing version: its kind, versions and counts. */
export const vRecords = schema
  .view('v_records', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    kind: text('kind'),
    kindGap: text('kind_gap'),
    kindBy: text('kind_by'),
    kindSource: text('kind_source'),
    kindQuote: text('kind_quote'),
    kindStart: integer('kind_start'),
    kindEnd: integer('kind_end'),
    ruleVersion: text('rule_version').notNull(),
    aiVersion: text('ai_version'),
    photoVersion: text('photo_version'),
    parts: integer('parts').notNull(),
    conflict: boolean('conflict').notNull(),
    recordedAt: at('recorded_at').notNull(),
  })
  .existing()

/** Internal: every part of the latest record of each listing version, the decision applied. */
export const vParts = schema
  .view('v_parts', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    seq: integer('seq').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    attrs: jsonb('attrs').notNull(),
    inclusion: text('inclusion').notNull(),
    rejected: boolean('rejected').notNull(),
    source: text('source').notNull(),
    extractor: text('extractor').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    quote: text('quote').notNull(),
    start: integer('start').notNull(),
    end: integer('end').notNull(),
    conflict: boolean('conflict').notNull(),
    correction: jsonb('correction'),
  })
  .existing()
