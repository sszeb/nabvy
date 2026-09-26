import {
  boolean,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { moduleSchema } from '../module-schema'

// Tables of the suspected-labels module, all in the Postgres schema 'suspected_labels' (packages/db/README.md).
// Only services/suspected-labels writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate suspected-labels

export const schema = moduleSchema('suspected-labels')

/**
 * Rules for label types. Each rule has a version, thresholds, and a mode.
 */
export const rules = schema.table(
  'rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    label_type: text().notNull(), // 'suspected_too_good_to_be_true', etc.
    rule_id: text().notNull(), // Unique identifier for the rule
    version: text().notNull(), // r<n>.<hash>
    thresholds: jsonb().notNull(), // Rule-specific thresholds
    mode: text().notNull().default('shadow'), // 'shadow', 'reviewed', or 'on'
    changed_by: text(), // User who made the change
    audit_id: uuid(), // Reference to audit log entry
    changed_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('rules_label_type_rule_id_version').on(table.label_type, table.rule_id, table.version),
    index('idx_rules_label_type').on(table.label_type),
    index('idx_rules_mode').on(table.mode),
  ],
)

/**
 * Evaluations track when rules are applied to listings.
 * Idempotency key: source + source_listing_id + evidence_hash + rule_version
 */
export const evaluations = schema.table(
  'evaluations',
  {
    source: text().notNull(), // 'facebook', 'ebay', etc.
    source_listing_id: text().notNull(), // Listing ID from the source
    evidence_hash: text().notNull(), // SHA-256 hash of the evidence
    card_hash: text(), // Hash of the listing card data
    inputs_hash: text(), // Hash of all inputs to the evaluation
    rule_version: text().notNull(), // Version of the rule applied
    signals: jsonb(), // Signal states as JSON
    paths_met: text().array(), // Paths that met criteria (A, B, C, B-P)
    t1_fetched_at: timestamp({ withTimezone: true }), // When the listing was fetched
    done_at: timestamp({ withTimezone: true }).notNull().defaultNow(), // When evaluation completed
  },
  (table) => [
    primaryKey({
      columns: [table.source, table.source_listing_id, table.evidence_hash, table.rule_version],
    }),
    index('idx_evaluations_done_at').on(table.done_at),
  ],
)

/**
 * Candidate labels waiting for approval.
 */
export const candidates = schema.table(
  'candidates',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().notNull(),
    source_listing_id: text().notNull(),
    label_type: text().notNull(),
    rule_id: text().notNull(),
    rule_version: text().notNull(),
    evidence: jsonb().notNull(), // Evidence structure
    would_show: boolean().notNull().default(false), // Would show if approved
    held_reason: text(), // Reason if held (burst limit, counter-report, etc.)
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    cleared_at: timestamp({ withTimezone: true }), // When candidate was cleared/dismissed
  },
  (table) => [
    index('idx_candidates_source_listing').on(table.source, table.source_listing_id),
    index('idx_candidates_label_type').on(table.label_type),
    index('idx_candidates_would_show').on(table.would_show),
    index('idx_candidates_created_at').on(table.created_at),
  ],
)

/**
 * Approvals of candidate labels by reviewers.
 */
export const approvals = schema.table(
  'approvals',
  {
    id: uuid().primaryKey().defaultRandom(),
    candidate_id: uuid().notNull(),
    decision: text().notNull(), // 'approve' or 'reject'
    evidence_codes: text().array(), // Evidence codes supporting decision
    by: text().notNull(), // Reviewer
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    audit_id: uuid(), // Reference to audit log
  },
  (table) => [
    index('idx_approvals_candidate').on(table.candidate_id),
    index('idx_approvals_by').on(table.by),
  ],
)

/**
 * Published labels for listings.
 */
export const labels = schema.table(
  'labels',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().notNull(),
    source_listing_id: text().notNull(),
    label_type: text().notNull(),
    candidate_id: uuid().notNull(), // Reference to approved candidate
    evidence: jsonb().notNull(),
    shown_at: timestamp({ withTimezone: true }), // When label started showing
    removed_at: timestamp({ withTimezone: true }), // When label was removed
    removed_reason: text(), // Why label was removed
  },
  (table) => [
    index('idx_labels_source_listing').on(table.source, table.source_listing_id),
    index('idx_labels_label_type').on(table.label_type),
    index('idx_labels_shown_at').on(table.shown_at),
  ],
)

/**
 * Correction requests from users or sellers.
 */
export const correction_requests = schema.table(
  'correction_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().notNull(),
    source_listing_id: text().notNull(),
    label_id: uuid().notNull(),
    requester_kind: text().notNull(), // 'user' or 'seller'
    requester_user_id: uuid(), // User ID if requester is a user
    contact_email: text(),
    reason: text().notNull(), // Reason for correction (from enum)
    text: text().notNull(), // Detailed explanation
    status: text().notNull().default('pending'), // 'pending', 'reviewed', 'approved', 'rejected'
    due_at: timestamp({ withTimezone: true }), // Response deadline
    decided_by: text(), // Reviewer who made decision
    decided_at: timestamp({ withTimezone: true }), // When decision was made
    internal_note: text(), // Internal notes
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_correction_requests_source_listing').on(table.source, table.source_listing_id),
    index('idx_correction_requests_status').on(table.status),
    index('idx_correction_requests_created_at').on(table.created_at),
  ],
)

/**
 * Reviews of candidates for calibration and metrics.
 */
export const reviews = schema.table(
  'reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().notNull(),
    source_listing_id: text().notNull(),
    evidence_hash: text().notNull(),
    reviewer: text().notNull(), // Reviewer ID
    label: text(), // Label assigned by reviewer ('correct', 'incorrect', etc.)
    sample: text(), // Sample name/cohort
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_reviews_source_listing').on(table.source, table.source_listing_id),
    index('idx_reviews_reviewer').on(table.reviewer),
    index('idx_reviews_at').on(table.at),
  ],
)
