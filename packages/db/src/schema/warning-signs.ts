import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the warning-signs module, all in the Postgres schema 'warning_signs' (packages/db/README.md).
// Only services/warning-signs writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate warning-signs

export const schema = moduleSchema('warning-signs')

const at = (name: string) => timestamp(name, { withTimezone: true })
const HASH = `'^[0-9a-f]{64}$'`
const RULE_VERSION = `'^w[0-9]+\\.[0-9a-f]{8}$'`
const CODES = `('pay_first_text', 'platform_claim_text', 'away_story_text', 'off_platform_contact_text', 'urgency_text', 'thin_text', 'viewing_offered_text', 'payment_on_collection_text', 'protected_payment_text', 'box_only', 'mining_text', 'untested_text', 'not_working_text', 'stock_phrasing_text', 'ask_far_below_similar', 'low_ask_explained')`
const REASONS = `('not_working', 'for_parts', 'named_fault', 'box_only', 'core_part_missing', 'part_not_included', 'swap_or_trade', 'offers', 'cosmetic')`

/**
 * One row per evaluation of one listing against one set of inputs and one rule version: the
 * idempotency key is (listing, evidence hash, card hash, input hash, rule version). `input_hash`
 * is the SHA-256 of everything the rules read (the text, the assessment's cautions and
 * exclusions, and each index group's key, `as_of`, ask, median and n: a cross-listing stage under
 * rule 8), so any new input gives a new row and a replay does not. The views show each listing's
 * latest evaluation, so an evaluation that finds nothing clears the facts an earlier one found.
 * `evaluated_at` moves forward when inputs return to an earlier state (the only update).
 * `fetched_at` is the input's T1 (rule 10). The listing ID is listing-ingest's, a plain value
 * (rule 4).
 */
export const evaluations = schema.table(
  'evaluations',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    cardHash: text('card_hash').notNull(),
    inputHash: text('input_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    fetchedAt: at('fetched_at'),
    evaluatedAt: at('evaluated_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('evaluations_version_key').on(
      t.listingId,
      t.evidenceHash,
      t.cardHash,
      t.inputHash,
      t.ruleVersion,
    ),
    index('evaluations_listing_evaluated_idx').on(t.listingId, t.evaluatedAt),
    check('evaluations_evidence_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
    check('evaluations_card_hash_check', sql.raw(`card_hash ~ ${HASH}`)),
    check('evaluations_input_hash_check', sql.raw(`input_hash ~ ${HASH}`)),
    check('evaluations_rule_version_check', sql.raw(`rule_version ~ ${RULE_VERSION}`)),
  ],
)

/**
 * The card's `facts`: one row per fact an evaluation found, with its evidence (a redacted quote,
 * another module's value, or the ask against its group), rule ID and rule version. At most one
 * row per code, and per reason for `low_ask_explained`. Written once with its evaluation, never
 * updated; `found_at` is the done time (rule 10).
 */
export const facts = schema.table(
  'facts',
  {
    id: idColumn(),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    cardHash: text('card_hash').notNull(),
    code: text('code').notNull(),
    reason: text('reason'),
    evidence: jsonb('evidence').notNull(),
    /** The redacted quote, for the user-facing view; null for a fact with no quote. */
    evidenceText: text('evidence_text'),
    ruleId: text('rule_id').notNull(),
    ruleVersion: text('rule_version').notNull(),
    foundAt: at('found_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('facts_evaluation_code_key').on(t.evaluationId, t.code, t.reason).nullsNotDistinct(),
    index('facts_listing_idx').on(t.listingId),
    check('facts_code_check', sql.raw(`code in ${CODES}`)),
    check(
      'facts_reason_check',
      sql.raw(
        `(code = 'low_ask_explained') = (reason is not null) and (reason is null or reason in ${REASONS})`,
      ),
    ),
    check('facts_evidence_check', sql`jsonb_typeof(${t.evidence}) = 'object'`),
    check(
      'facts_evidence_text_check',
      sql`${t.evidenceText} is null or char_length(${t.evidenceText}) between 1 and 200`,
    ),
    check('facts_rule_id_check', sql.raw(`rule_id ~ '^warning-signs\\.[a-z_]+$'`)),
    check('facts_rule_version_check', sql.raw(`rule_version ~ ${RULE_VERSION}`)),
  ],
)

// Published views, created by hand-written SQL (migrations/warning-signs/*_access.sql). Row
// types: `WarningSignsFact` and `WarningSignsListingFact` in @nabvy/contracts/modules/warning-signs.

/** Internal: the facts of each listing's latest evaluation. Empty while the switch is off. */
export const vFacts = schema
  .view('v_facts', {
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    cardHash: text('card_hash').notNull(),
    inputHash: text('input_hash').notNull(),
    code: text('code').notNull(),
    reason: text('reason'),
    evidence: jsonb('evidence').notNull(),
    ruleId: text('rule_id').notNull(),
    ruleVersion: text('rule_version').notNull(),
    fetchedAt: at('fetched_at'),
    foundAt: at('found_at').notNull(),
  })
  .existing()

/**
 * User-facing: `app.v_warning_signs`, the user-facing codes of each listing's latest evaluation;
 * rows only while this module and listing-suppression are `on`, never a suppressed listing.
 * `evidence_text` passes through `quote_redaction.quote()`, null while that module is not on.
 */
export const vWarningSigns = pgSchema('app')
  .view('v_warning_signs', {
    listingId: uuid('listing_id').notNull(),
    code: text('code').notNull(),
    evidenceText: text('evidence_text'),
  })
  .existing()
