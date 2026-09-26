import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the seller-reply-reports module, all in the Postgres schema 'seller_reply_reports'
// (packages/db/README.md; docs/design/modules/seller-reply-reports.md, "Owns"). Only services/
// seller-reply-reports writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate seller-reply-reports

export const schema = moduleSchema('seller-reply-reports')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })
const weight = (name: string) => numeric(name, { precision: 3, scale: 2, mode: 'number' })

const REASONS = `'collection_elsewhere', 'postage_only', 'payment_first', 'link_or_fb_delivery', 'not_as_described', 'other', 'as_listed'`
const FAMILIES = `'location', 'handover', 'payment', 'link', 'item'`
const BANDS = `'lt_10', '10_25', '25_50', '50_100', '100_plus', 'unknown'`

/**
 * One report per user per listing (design §3.2). The web app inserts it inside withUser and may
 * later withdraw it; the pipeline's aggregator sets `eligibility`, both weights, `status` and the
 * outcome. `listing_id` is listing-ingest's ID (README.md, "Decisions"). No link, no seller field
 * and no free text: `note_text` is reserved for owner decision 14 and a check keeps it null.
 */
export const reports = schema.table(
  'reports',
  {
    id: idColumn(),
    source: text('source').notNull(),
    listingId: uuid('listing_id').notNull(),
    reporterUserId: uuid('reporter_user_id').notNull(),
    cardHash: text('card_hash'),
    evidenceHash: text('evidence_hash'),
    openVia: text('open_via'),
    firstOpenedAt: at('first_opened_at'),
    eligibility: text('eligibility').notNull().default('pending'),
    weightAtSubmit: weight('weight_at_submit'),
    weight: weight('weight').notNull().default(0),
    status: text('status').notNull().default('saved'),
    outcome: text('outcome'),
    outcomeBy: text('outcome_by'),
    listingShippingOffered: boolean('listing_shipping_offered'),
    listingCheckoutEnabled: boolean('listing_checkout_enabled'),
    listingMessagingEnabled: boolean('listing_messaging_enabled'),
    noteText: text('note_text'),
    tester: boolean('tester').notNull().default(false),
    ruleVersion: text('rule_version').notNull(),
    ...timestampColumns(),
    withdrawnAt: at('withdrawn_at'),
  },
  (t) => [
    uniqueIndex('reports_identity_idx').on(t.listingId, t.reporterUserId),
    index('reports_reporter_idx').on(t.reporterUserId, t.createdAt),
    index('reports_listing_idx').on(t.listingId),
    check(
      'reports_eligibility',
      sql`${t.eligibility} in ('pending', 'eligible', 'no_open', 'too_soon', 'too_late', 'email_unverified', 'not_active', 'too_new', 'rate_limited', 'burst_hold', 'tester', 'messaging_off', 'noise', 'suppressed')`,
    ),
    check(
      'reports_status',
      sql`${t.status} in ('saved', 'helping_warn', 'not_shown', 'removed_after_check', 'withdrawn')`,
    ),
    check(
      'reports_outcome',
      sql`${t.outcome} is null or ${t.outcome} in ('upheld', 'not_upheld', 'void', 'unknown')`,
    ),
    check(
      'reports_outcome_by',
      sql`${t.outcomeBy} is null or ${t.outcomeBy} in ('review', 'corroboration', 'correction', 'report_then_buy', 'ban')`,
    ),
    check(
      'reports_weights',
      sql`${t.weight} between 0 and 1 and coalesce(${t.weightAtSubmit}, 0) between 0 and 1`,
    ),
    check('reports_no_note', sql`${t.noteText} is null`),
  ],
)

/**
 * The chips of one report, one row per reason (unique on report and reason). The app writes the
 * codes the user tapped; the aggregator writes `distance_band` and `counts`. `reported_place_id`
 * is a city-page ID (a town or area), never a postcode or a street.
 */
export const reportReasons = schema.table(
  'report_reasons',
  {
    id: idColumn(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    detail: text('detail'),
    secondAnswer: text('second_answer'),
    reportedPlaceId: text('reported_place_id'),
    distanceBand: text('distance_band'),
    counts: text('counts'),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex('report_reasons_identity_idx').on(t.reportId, t.reason),
    check('report_reasons_reason', sql.raw(`reason in (${REASONS})`)),
    check('report_reasons_band', sql.raw(`distance_band is null or distance_band in (${BANDS})`)),
    check(
      'report_reasons_counts',
      sql`${t.counts} is null or ${t.counts} in ('any_path', 'path_b_only', 'none')`,
    ),
    check(
      'report_reasons_place',
      sql`${t.reportedPlaceId} is null or ${t.reason} = 'collection_elsewhere'`,
    ),
  ],
)

/** A reporter's track record (the Beta-reputation accuracy factor, design §3.2). Pipeline only. */
export const reporterStats = schema.table(
  'reporter_stats',
  {
    userId: uuid('user_id').primaryKey(),
    upheld: integer('upheld').notNull().default(0),
    notUpheld: integer('not_upheld').notNull().default(0),
    voided: integer('voided').notNull().default(0),
    lastReportAt: at('last_report_at'),
    ...timestampColumns(),
  },
  (t) => [
    check(
      'reporter_stats_nonnegative',
      sql`${t.upheld} >= 0 and ${t.notUpheld} >= 0 and ${t.voided} >= 0`,
    ),
  ],
)

/**
 * The evidence per listing, family and scope (`own`: reports on this listing; `copy`: reports
 * spread from its confirmed copy-advert cluster). Written by the aggregator with an upsert on
 * (source, listing, family, scope, rule version); `inputs_hash` is the idempotency key (design
 * §6.6), so a replay writes nothing. Carries no user ID.
 */
export const listingEvidence = schema.table(
  'listing_evidence',
  {
    id: idColumn(),
    source: text('source').notNull(),
    listingId: uuid('listing_id').notNull(),
    family: text('family').notNull(),
    scope: text('scope').notNull(),
    persons: integer('persons').notNull(),
    weightSum: numeric('weight_sum', { precision: 8, scale: 2, mode: 'number' }).notNull(),
    counterWeight: numeric('counter_weight', { precision: 8, scale: 2, mode: 'number' }).notNull(),
    level: text('level').notNull(),
    placeId: text('place_id'),
    distanceBand: text('distance_band'),
    held: boolean('held').notNull().default(false),
    holdReason: text('hold_reason'),
    carriedFromRelist: boolean('carried_from_relist').notNull().default(false),
    inputsHash: text('inputs_hash').notNull(),
    ruleVersion: text('rule_version').notNull(),
    asOf: at('as_of').notNull(),
    t1FetchedAt: at('t1_fetched_at'),
    doneAt: at('done_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex('listing_evidence_identity_idx').on(
      t.source,
      t.listingId,
      t.family,
      t.scope,
      t.ruleVersion,
    ),
    index('listing_evidence_listing_idx').on(t.listingId),
    check('listing_evidence_family', sql.raw(`family in (${FAMILIES})`)),
    check('listing_evidence_scope', sql`${t.scope} in ('own', 'copy')`),
    check('listing_evidence_level', sql`${t.level} in ('none', 'single', 'multiple')`),
    check('listing_evidence_band', sql.raw(`distance_band is null or distance_band in (${BANDS})`)),
    check(
      'listing_evidence_hold',
      sql`(${t.held} and ${t.holdReason} in ('burst', 'gem_burst', 'counter_report')) or (not ${t.held} and ${t.holdReason} is null)`,
    ),
  ],
)

/** Held evidence waiting for a reviewer (design §3.3). `scope_key` is a listing ID or a cluster key. */
export const holds = schema.table(
  'holds',
  {
    id: idColumn(),
    source: text('source').notNull(),
    scopeKey: text('scope_key').notNull(),
    reason: text('reason').notNull(),
    openedAt: at('opened_at').notNull(),
    releasedAt: at('released_at'),
    releasedBy: uuid('released_by'),
    auditId: uuid('audit_id'),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex('holds_identity_idx').on(t.scopeKey, t.openedAt),
    uniqueIndex('holds_open_idx').on(t.scopeKey, t.reason).where(sql`released_at is null`),
    check('holds_reason', sql`${t.reason} in ('burst', 'gem_burst', 'counter_report')`),
  ],
)

/** The team's accounts: their reports are calibration only, and in shadow only they see "Your reports". */
export const testers = schema.table('testers', {
  userId: uuid('user_id').primaryKey(),
  addedBy: uuid('added_by').notNull(),
  auditId: uuid('audit_id').notNull(),
  addedAt: at('added_at').notNull(),
  ...timestampColumns(),
})

/** Internal view (row type SellerReplyReportsListingEvidence). No user ID, no free text. */
export const vListingEvidence = schema
  .view('v_listing_evidence', {
    listingId: uuid('listing_id').notNull(),
    source: text('source').notNull(),
    family: text('family').notNull(),
    scope: text('scope').notNull(),
    personsBand: text('persons_band').notNull(),
    personsExact: integer('persons_exact'),
    level: text('level').notNull(),
    placeId: text('place_id'),
    distanceBand: text('distance_band'),
    held: boolean('held').notNull(),
    holdReason: text('hold_reason'),
    carriedFromRelist: boolean('carried_from_relist').notNull(),
    ruleVersion: text('rule_version').notNull(),
    asOf: at('as_of').notNull(),
  })
  .existing()

/** Internal view for review-console: one row per report, no user ID. */
export const vReviewItems = schema
  .view('v_review_items', {
    reportId: uuid('report_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    reasons: text('reasons').array().notNull(),
    details: text('details').array().notNull(),
    secondAnswers: text('second_answers').array().notNull(),
    noteText: text('note_text'),
    eligibility: text('eligibility').notNull(),
    weight: weight('weight').notNull(),
    status: text('status').notNull(),
  })
  .existing()

/** Internal view for ops-metrics: daily shadow rates (design §5.2), no user ID. */
export const vShadowMetrics = schema
  .view('v_shadow_metrics', {
    day: text('day').notNull(),
    reports: integer('reports').notNull(),
    eligible: integer('eligible').notNull(),
    counterReports: integer('counter_reports').notNull(),
    withdrawn: integer('withdrawn').notNull(),
    rateLimited: integer('rate_limited').notNull(),
    heldListings: integer('held_listings').notNull(),
  })
  .existing()

/** Internal view for account-integrity and the admin path (row type SellerReplyReportsReporterSignal). */
export const vReporterSignals = schema
  .view('v_reporter_signals', {
    userId: uuid('user_id').notNull(),
    reports24h: integer('reports_24h').notNull(),
    reports30d: integer('reports_30d').notNull(),
    notUpheld: integer('not_upheld').notNull(),
    voided: integer('voided').notNull(),
    overLimit: integer('over_limit').notNull(),
    burstInvolvement: integer('burst_involvement').notNull(),
  })
  .existing()

/** User-facing: the caller's own reports (row type SellerReplyReportsMine). */
export const vSellerReplyReportsMine = pgSchema('app')
  .view('v_seller_reply_reports_mine', {
    reportId: uuid('report_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    reasons: text('reasons').array().notNull(),
    status: text('status').notNull(),
    createdAt: at('created_at').notNull(),
    withdrawable: boolean('withdrawable').notNull(),
  })
  .existing()
