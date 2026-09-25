import { sql } from 'drizzle-orm'
import {
  bigint,
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

// Tables of the parts-ai module, all in the Postgres schema 'parts_ai' (packages/db/README.md).
// Only services/parts-ai writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate parts-ai

export const schema = moduleSchema('parts-ai')

const at = (name: string) => timestamp(name, { withTimezone: true })
const HASH = `'^[0-9a-f]{64}$'`
const VERSION = `'^p[0-9]+\\.[0-9a-f]{8}$'`
const KINDS = `('wanted_or_swap', 'laptop', 'pc', 'not_a_pc')`
const SOURCES = `('title', 'description')`
const PART_TYPES = `('gpu', 'cpu', 'ram_size', 'ram_generation', 'storage_size', 'storage_type', 'psu_wattage', 'chipset')`

/**
 * One row per model call over one listing version: the idempotency key and the cache (listing,
 * evidence hash, prompt version). Holds the model, the provider's response ID (`trace_id`), the
 * cost as cost-meter counted it, how the call ended, and the listing kind when the model was
 * asked and answered. The listing ID is listing-ingest's, held as a plain value (rule 4).
 */
export const calls = schema.table(
  'calls',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    traceId: text('trace_id').notNull(),
    costGbpMicros: bigint('cost_gbp_micros', { mode: 'number' }).notNull(),
    status: text('status').notNull(),
    kind: text('kind'),
    kindSource: text('kind_source'),
    kindQuote: text('kind_quote'),
    kindStart: integer('kind_start'),
    kindEnd: integer('kind_end'),
    doneAt: at('done_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    unique('calls_listing_hash_version_key').on(t.listingId, t.evidenceHash, t.promptVersion),
    index('calls_done_at_idx').on(t.doneAt),
    check('calls_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
    check('calls_version_check', sql.raw(`prompt_version ~ ${VERSION}`)),
    check('calls_status_check', sql`${t.status} in ('extracted', 'quarantined')`),
    check('calls_cost_check', sql`${t.costGbpMicros} >= 0`),
    check('calls_kind_check', sql.raw(`kind in ${KINDS}`)),
    check('calls_kind_source_check', sql.raw(`kind_source in ${SOURCES}`)),
    check(
      'calls_kind_complete_check',
      sql`(${t.kind} is null and ${t.kindSource} is null and ${t.kindQuote} is null and ${t.kindStart} is null and ${t.kindEnd} is null) or (${t.kind} is not null and ${t.kindSource} is not null and ${t.kindQuote} is not null and ${t.kindStart} >= 0 and ${t.kindEnd} > ${t.kindStart} and ${t.status} = 'extracted')`,
    ),
  ],
)

/**
 * One row per part the model named, after its quote was found in the stored text and its product
 * resolved through product-catalogue: the part type, the catalogue ID (or the family when the
 * catalogue named no single item), the inclusion the model read, and where the quote is (source,
 * verbatim quote, UTF-16 offsets). A reviewer's correction is kept beside it, never over it.
 */
export const aiParts = schema.table(
  'ai_parts',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    seq: integer('seq').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    family: text('family'),
    inclusion: text('inclusion').notNull(),
    source: text('source').notNull(),
    quote: text('quote').notNull(),
    quoteStart: integer('quote_start').notNull(),
    quoteEnd: integer('quote_end').notNull(),
    correction: jsonb('correction'),
    ...timestampColumns(),
  },
  (t) => [
    unique('ai_parts_call_seq_key').on(t.listingId, t.evidenceHash, t.promptVersion, t.seq),
    index('ai_parts_catalogue_idx').on(t.catalogueId),
    check('ai_parts_part_type_check', sql.raw(`part_type in ${PART_TYPES}`)),
    check(
      'ai_parts_inclusion_check',
      sql`${t.inclusion} in ('offered', 'mention', 'not_included')`,
    ),
    check('ai_parts_source_check', sql.raw(`source in ${SOURCES}`)),
    check('ai_parts_position_check', sql`${t.quoteStart} >= 0 and ${t.quoteEnd} > ${t.quoteStart}`),
    check('ai_parts_seq_check', sql`${t.seq} >= 0`),
  ],
)

/**
 * One row per quarantined call: why its output was not used. Never retried at the same prompt
 * version (the brief: no retry on invalid output). `detail` is this module's own bounded text,
 * never the model's output.
 */
export const quarantine = schema.table(
  'quarantine',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    problem: text('problem').notNull(),
    detail: text('detail').notNull(),
    at: at('at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    unique('quarantine_listing_hash_version_key').on(t.listingId, t.evidenceHash, t.promptVersion),
    check('quarantine_problem_check', sql`${t.problem} in ('invalid_output', 'quote_not_found')`),
    check('quarantine_detail_check', sql`length(${t.detail}) <= 500`),
  ],
)

/**
 * One row per listing version whose text was partial or missing and was sent to details-queue
 * for a refresh, so a version is refreshed once, never on every event.
 */
export const refreshes = schema.table(
  'refreshes',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    requestedAt: at('requested_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    unique('refreshes_listing_hash_key').on(t.listingId, t.evidenceHash),
    check('refreshes_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
  ],
)

// Published views, created by hand-written SQL (migrations/parts-ai/*_access.sql). Empty while
// the module's switch is off. Row types: `PartsAiPart`, `PartsAiRun` and `PartsAiQuarantined` in
// @nabvy/contracts/modules/parts-ai.

/** Internal: every AI part, checked and resolved, with its quote and position. */
export const vAiParts = schema
  .view('v_ai_parts', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    seq: integer('seq').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    family: text('family'),
    inclusion: text('inclusion').notNull(),
    source: text('source').notNull(),
    quote: text('quote').notNull(),
    start: integer('start').notNull(),
    end: integer('end').notNull(),
    correction: jsonb('correction'),
  })
  .existing()

/** Internal: one row per call: how it ended and the listing kind the model read. No cost. */
export const vRuns = schema
  .view('v_runs', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    status: text('status').notNull(),
    kind: text('kind'),
    kindSource: text('kind_source'),
    kindQuote: text('kind_quote'),
    kindStart: integer('kind_start'),
    kindEnd: integer('kind_end'),
    doneAt: at('done_at').notNull(),
  })
  .existing()

/** Internal: quarantined calls, for review-console and ops-metrics. */
export const vQuarantine = schema
  .view('v_quarantine', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    problem: text('problem').notNull(),
    detail: text('detail').notNull(),
    at: at('at').notNull(),
  })
  .existing()
