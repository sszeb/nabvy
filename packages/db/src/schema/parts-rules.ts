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

// Tables of the parts-rules module, all in the Postgres schema 'parts_rules' (packages/db/README.md).
// Only services/parts-rules writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate parts-rules

export const schema = moduleSchema('parts-rules')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * One row per run of the rules over one listing version: the idempotency key is (listing,
 * evidence hash, rule version). Holds the kind the rules settled on, the listing-kind signals and
 * tag blocks found (jsonb arrays, published unnested by `v_kind_signals` and `v_tag_blocks`),
 * the open parts and whether the text was `full_verified`. The listing ID is listing-ingest's,
 * held as a plain value (rule 4).
 */
export const runs = schema.table(
  'runs',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    kind: text('kind'),
    kindGap: text('kind_gap'),
    kindSignals: jsonb('kind_signals').notNull().default(sql`'[]'::jsonb`),
    tagBlocks: jsonb('tag_blocks').notNull().default(sql`'[]'::jsonb`),
    gaps: jsonb('gaps').notNull().default(sql`'[]'::jsonb`),
    fullVerified: boolean('full_verified').notNull(),
    doneAt: at('done_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    unique('runs_listing_hash_version_key').on(t.listingId, t.evidenceHash, t.ruleVersion),
    check('runs_hash_check', sql`${t.evidenceHash} ~ '^[0-9a-f]{64}$'`),
    check('runs_version_check', sql`${t.ruleVersion} ~ '^r[0-9]+\\.[0-9a-f]{8}$'`),
    check('runs_kind_check', sql`${t.kind} in ('wanted_or_swap', 'laptop', 'pc', 'not_a_pc')`),
    check('runs_kind_gap_check', sql`${t.kindGap} in ('no_signal', 'conflict')`),
    check('runs_kind_or_gap_check', sql`(${t.kind} is null) = (${t.kindGap} is not null)`),
  ],
)

/**
 * One row per rule hit: the part type, the catalogue ID when `resolve()` named one item, the
 * attributes stated in the quote, the inclusion candidate, and where it was found (source, the
 * verbatim quote, UTF-16 offsets into the stored text). `seq` orders hits within the run. A
 * reviewer's correction is kept beside the candidate, never over it.
 */
export const ruleParts = schema.table(
  'rule_parts',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    seq: integer('seq').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    attrs: jsonb('attrs').notNull().default(sql`'{}'::jsonb`),
    inclusionCandidate: text('inclusion_candidate').notNull(),
    source: text('source').notNull(),
    quote: text('quote').notNull(),
    quoteStart: integer('quote_start').notNull(),
    quoteEnd: integer('quote_end').notNull(),
    ruleId: text('rule_id').notNull(),
    correction: jsonb('correction'),
    ...timestampColumns(),
  },
  (t) => [
    unique('rule_parts_run_seq_key').on(t.listingId, t.evidenceHash, t.ruleVersion, t.seq),
    index('rule_parts_catalogue_idx').on(t.catalogueId),
    check(
      'rule_parts_part_type_check',
      sql`${t.partType} in ('gpu', 'cpu', 'ram_size', 'ram_generation', 'storage_size', 'storage_type', 'psu_wattage', 'chipset')`,
    ),
    check(
      'rule_parts_inclusion_check',
      sql`${t.inclusionCandidate} in ('offered', 'mention', 'not_included')`,
    ),
    check('rule_parts_source_check', sql`${t.source} in ('title', 'description', 'attribute')`),
    check(
      'rule_parts_position_check',
      sql`${t.quoteStart} >= 0 and ${t.quoteEnd} > ${t.quoteStart}`,
    ),
    check('rule_parts_seq_check', sql`${t.seq} >= 0`),
  ],
)

// Published views, created by hand-written SQL (migrations/parts-rules/*_access.sql). Empty
// while the module's switch is off. Row types: `PartsRulesPart`, `PartsRulesGap`,
// `PartsRulesTagBlock` and `PartsRulesKindSignal` in @nabvy/contracts/modules/parts-rules.

/** Internal: every rule hit, with its quote and position. */
export const vRuleParts = schema
  .view('v_rule_parts', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    seq: integer('seq').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    attrs: jsonb('attrs').notNull(),
    inclusionCandidate: text('inclusion_candidate').notNull(),
    source: text('source').notNull(),
    quote: text('quote').notNull(),
    start: integer('start').notNull(),
    end: integer('end').notNull(),
    ruleId: text('rule_id').notNull(),
    correction: jsonb('correction'),
  })
  .existing()

/** Internal: one row per run: the kind, the open parts and whether the text was complete. */
export const vGaps = schema
  .view('v_gaps', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    kind: text('kind'),
    kindGap: text('kind_gap'),
    parts: jsonb('parts').notNull(),
    fullVerified: boolean('full_verified').notNull(),
    doneAt: at('done_at').notNull(),
  })
  .existing()

/** Internal: the tag blocks the rules ignored. */
export const vTagBlocks = schema
  .view('v_tag_blocks', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    source: text('source').notNull(),
    start: integer('start').notNull(),
    end: integer('end').notNull(),
    ruleId: text('rule_id').notNull(),
  })
  .existing()

/** Internal: the listing-kind signals, with quote and position. */
export const vKindSignals = schema
  .view('v_kind_signals', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    signal: text('signal').notNull(),
    source: text('source').notNull(),
    quote: text('quote').notNull(),
    start: integer('start').notNull(),
    end: integer('end').notNull(),
    ruleId: text('rule_id').notNull(),
  })
  .existing()
