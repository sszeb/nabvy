import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the spec-match module, all in the Postgres schema 'spec_match' (packages/db/README.md).
// Only services/spec-match writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate spec-match

export const schema = moduleSchema('spec-match')

const at = (name: string) => timestamp(name, { withTimezone: true })
const HASH = `'^[0-9a-f]{64}$'`
const RULE_VERSION = `'^s[0-9]+\\.[0-9a-f]{8}$'`

/**
 * One row per verdict of one want against one listing for one set of inputs and one rule
 * version: the idempotency key is (want, listing, input hash, rule version). `input_hash` is the
 * SHA-256 of everything the verdict read (the want's criteria, cap, area and handover, the
 * listing's card, parts, assessment and point), so any new input gives a new row and a replay
 * does not. The views show the latest row of each want and listing. `user_id` is the want's owner
 * (want-manager's `wantOwners`), for row-level security on the user-facing view only; no internal
 * view carries it. `matched_at` is T5 (rule 10), written once. Want, user and listing IDs are
 * other modules' IDs held as plain values (rule 4).
 */
export const matches = schema.table(
  'matches',
  {
    id: idColumn(),
    wantId: uuid('want_id').notNull(),
    userId: uuid('user_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    cardHash: text('card_hash'),
    inputHash: text('input_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    verdict: text('verdict').notNull(),
    criteria: jsonb('criteria').notNull().default([]),
    insidePc: boolean('inside_pc').notNull(),
    origin: text('origin').notNull(),
    backfill: boolean('backfill').notNull().default(false),
    matchedAt: at('matched_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('matches_input_key').on(t.wantId, t.listingId, t.inputHash, t.ruleVersion),
    index('matches_pair_matched_idx').on(t.wantId, t.listingId, t.matchedAt),
    index('matches_listing_idx').on(t.listingId),
    index('matches_user_idx').on(t.userId),
    check('matches_evidence_hash_check', sql.raw(`evidence_hash ~ ${HASH}`)),
    check('matches_card_hash_check', sql.raw(`card_hash is null or card_hash ~ ${HASH}`)),
    check('matches_input_hash_check', sql.raw(`input_hash ~ ${HASH}`)),
    check('matches_rule_version_check', sql.raw(`rule_version ~ ${RULE_VERSION}`)),
    check('matches_verdict_check', sql`${t.verdict} in ('match', 'no_match', 'not_stated')`),
    check('matches_origin_check', sql`${t.origin} in ('own_search', 'other_search')`),
    check('matches_criteria_check', sql`jsonb_typeof(${t.criteria}) = 'array'`),
  ],
)

// Published views, created by hand-written SQL (migrations/spec-match/*_access.sql). Row types:
// `SpecMatchMatch` and `SpecMatchResult` in @nabvy/contracts/modules/spec-match.

/** Internal: the latest verdict of each want and listing. No user ID. Empty while off. */
export const vMatches = schema
  .view('v_matches', {
    matchId: uuid('match_id').notNull(),
    wantId: uuid('want_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    cardHash: text('card_hash'),
    inputHash: text('input_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    verdict: text('verdict').notNull(),
    criteria: jsonb('criteria').notNull(),
    insidePc: boolean('inside_pc').notNull(),
    origin: text('origin').notNull(),
    backfill: boolean('backfill').notNull(),
    matchedAt: at('matched_at').notNull(),
  })
  .existing()

/**
 * User-facing: `app.v_spec_match_results`, the caller's own results (row-level security on
 * `user_id`): the latest verdict of each of their wants and listing when it is not `no_match`,
 * quotes redacted by `quote_redaction.quote()` (null while that module is off). Rows only while
 * this module and listing-suppression are `on`, never a suppressed listing.
 */
export const vSpecMatchResults = pgSchema('app')
  .view('v_spec_match_results', {
    matchId: uuid('match_id').notNull(),
    wantId: uuid('want_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    verdict: text('verdict').notNull(),
    insidePc: boolean('inside_pc').notNull(),
    origin: text('origin').notNull(),
    backfill: boolean('backfill').notNull(),
    criteria: jsonb('criteria').notNull(),
    matchedAt: at('matched_at').notNull(),
  })
  .existing()
