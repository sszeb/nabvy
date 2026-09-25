import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the copy-advert module, all in the Postgres schema 'copy_advert' (packages/db/README.md).
// Only services/copy-advert writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate copy-advert

export const schema = moduleSchema('copy-advert')

const at = (name: string) => timestamp(name, { withTimezone: true })
const minor = (name: string) => bigint(name, { mode: 'number' })

/**
 * One row per listing version fingerprinted (docs/design/drafts/copy-advert.md 5.1). `advert_fp`
 * is set only for a fixed price above zero; `desc_fp`/`desc_norm` only for a `full_verified`
 * description. `current` marks the latest print of a listing, so lookups by fingerprint stay to
 * live cards only.
 */
export const prints = schema.table(
  'prints',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    cardHash: text('card_hash').notNull(),
    evidenceHash: text('evidence_hash').notNull().default(''),
    ruleVersion: text('rule_version').notNull(),
    titleNorm: text('title_norm').notNull(),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    advertFp: text('advert_fp'),
    descStatus: text('desc_status'),
    descNorm: text('desc_norm'),
    descFp: text('desc_fp'),
    photoId: text('photo_id'),
    cityPageId: text('city_page_id'),
    listedAt: at('listed_at'),
    lastSeenAt: at('last_seen_at').notNull(),
    inputT1: at('input_t1'),
    doneAt: at('done_at').notNull(),
    current: boolean('current').notNull().default(true),
    ...timestampColumns(),
  },
  (t) => [
    unique('prints_version_key').on(
      t.source,
      t.sourceListingId,
      t.cardHash,
      t.evidenceHash,
      t.ruleVersion,
    ),
    index('prints_advert_idx').on(t.advertFp, t.lastSeenAt).where(sql`${t.current}`),
    index('prints_desc_idx').on(t.descFp).where(sql`${t.current}`),
    index('prints_photo_idx').on(t.photoId).where(sql`${t.current}`),
    index('prints_listing_idx').on(t.listingId),
    check(
      'prints_source_check',
      sql`${t.source} in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')`,
    ),
    check('prints_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
    check(
      'prints_desc_status_check',
      sql`${t.descStatus} in ('full_verified', 'partial', 'missing')`,
    ),
  ],
)

/** A confirmed or provisional link between two listings; `listing_a < listing_b`. */
export const links = schema.table(
  'links',
  {
    listingA: uuid('listing_a').notNull(),
    listingB: uuid('listing_b').notNull(),
    basis: text('basis').notNull(),
    similarity: real('similarity'),
    photoIdMatch: boolean('photo_id_match').notNull().default(false),
    ruleVersion: text('rule_version').notNull(),
    decidedAt: at('decided_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.listingA, t.listingB, t.ruleVersion] }),
    index('links_b_idx').on(t.listingB),
    check('links_order_check', sql`${t.listingA} < ${t.listingB}`),
    check(
      'links_basis_check',
      sql`${t.basis} in ('exact_text', 'near_text', 'candidate', 'lookalike', 'text_copy')`,
    ),
  ],
)

/** Photo-ID evidence, internal only: the same primary photo ID on two different listings. */
export const photoMatches = schema.table(
  'photo_matches',
  {
    listingA: uuid('listing_a').notNull(),
    listingB: uuid('listing_b').notNull(),
    photoId: text('photo_id').notNull(),
    ruleVersion: text('rule_version').notNull(),
    foundAt: at('found_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.listingA, t.listingB, t.ruleVersion] }),
    check('photo_matches_order_check', sql`${t.listingA} < ${t.listingB}`),
  ],
)

/** A connected component of confirmed links, active within the window (docs 4.8). */
export const clusters = schema.table(
  'clusters',
  {
    clusterKey: text('cluster_key').primaryKey(),
    ruleVersion: text('rule_version').notNull(),
    memberSetHash: text('member_set_hash').notNull(),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    listingCount: integer('listing_count').notNull(),
    townCount: integer('town_count').notNull(),
    spanDays: integer('span_days').notNull(),
    spreadKm: real('spread_km'),
    massPosted: boolean('mass_posted').notNull(),
    status: text('status').notNull(),
    asOf: at('as_of').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    check('clusters_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
    check('clusters_status_check', sql`${t.status} in ('active', 'expired')`),
  ],
)

/** One listing's membership in one cluster over time; `left_at` null while still a member. */
export const members = schema.table(
  'members',
  {
    clusterKey: text('cluster_key').notNull(),
    listingId: uuid('listing_id').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    cityPageId: text('city_page_id'),
    basis: text('basis').notNull(),
    joinedAt: at('joined_at').notNull(),
    leftAt: at('left_at'),
    ...timestampColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.clusterKey, t.listingId] }),
    uniqueIndex('members_one_active_idx').on(t.listingId).where(sql`${t.leftAt} is null`),
  ],
)

/** One row per listing in a mass-posted cluster: the fact of 4.8 plus whether it would show. */
export const flags = schema.table(
  'flags',
  {
    listingId: uuid('listing_id').primaryKey(),
    clusterKey: text('cluster_key').notNull(),
    towns: integer('towns').notNull(),
    spanDays: integer('span_days').notNull(),
    wouldShow: boolean('would_show').notNull(),
    corrected: text('corrected'),
    ruleVersion: text('rule_version').notNull(),
    memberSetHash: text('member_set_hash').notNull(),
    ...timestampColumns(),
  },
  (t) => [check('flags_corrected_check', sql`${t.corrected} in ('unflagged')`)],
)

/** One row per listing sent to `details-queue` as a collision candidate. */
export const candidateRequests = schema.table('candidate_requests', {
  listingId: uuid('listing_id').primaryKey(),
  advertFp: text('advert_fp').notNull(),
  requestedAt: at('requested_at').notNull(),
  resolvedAt: at('resolved_at'),
  outcome: text('outcome'),
  ...timestampColumns(),
})

/** A hand-made correction the clustering must respect on the next recompute. */
export const overrides = schema.table(
  'overrides',
  {
    id: idColumn(),
    kind: text('kind').notNull(),
    listingA: uuid('listing_a'),
    listingB: uuid('listing_b'),
    reason: text('reason').notNull(),
    auditId: uuid('audit_id').notNull(),
    at: at('at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    check(
      'overrides_kind_check',
      sql`${t.kind} in ('not_copy_pair', 'exclude_listing', 'confirm_pair')`,
    ),
  ],
)

/** A user's report that a listing's flag is a mistake. User rows: RLS applies. */
export const reports = schema.table(
  'reports',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    at: at('at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('reports_user_listing_key').on(t.userId, t.listingId),
    check('reports_reason_check', sql`${t.reason} in ('not_a_copy', 'other')`),
    check('reports_status_check', sql`${t.status} in ('open', 'accepted', 'rejected')`),
  ],
)

/**
 * Restricted (5.1): whether a cluster spans several accounts, from `seller-key`, compared within
 * one run only. Empty until `seller-key` exists and is on (1.7d; soft dependency).
 */
export const accountChecks = schema.table(
  'account_checks',
  {
    clusterKey: text('cluster_key').notNull(),
    runId: text('run_id').notNull(),
    spansAccounts: boolean('spans_accounts').notNull(),
    checkedAt: at('checked_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [primaryKey({ columns: [t.clusterKey, t.runId] })],
)

// Published views, created by hand-written SQL (migrations/copy-advert/*_access.sql). Empty while
// the module's switch is off. Row types: `vMembersRow`, `vClusterFactsRow`, `vListingCopyFactsRow`
// and `vLinksRow` in @nabvy/contracts/modules/copy-advert (written by hand, not derived: see that
// file's header).

/** Internal: active, confirmed members of every cluster. */
export const vMembers = schema
  .view('v_members', {
    clusterKey: text('cluster_key').notNull(),
    listingId: uuid('listing_id').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    cityPageId: text('city_page_id'),
    basis: text('basis').notNull(),
    joinedAt: at('joined_at').notNull(),
    memberSetHash: text('member_set_hash').notNull(),
  })
  .existing()

/** Internal: per-cluster facts, computed over active, unsuppressed, confirmed members. */
export const vClusterFacts = schema
  .view('v_cluster_facts', {
    clusterKey: text('cluster_key').notNull(),
    listingCount: integer('listing_count').notNull(),
    townCount: integer('town_count').notNull(),
    spanDays: integer('span_days').notNull(),
    spreadKm: real('spread_km'),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    massPosted: boolean('mass_posted').notNull(),
    ruleVersion: text('rule_version').notNull(),
    asOf: at('as_of').notNull(),
  })
  .existing()

/** Internal: per-listing facts (docs 4.8), the listing's own town left out. */
export const vListingCopyFacts = schema
  .view('v_listing_copy_facts', {
    listingId: uuid('listing_id').notNull(),
    clusterKey: text('cluster_key'),
    otherListings: integer('other_listings').notNull(),
    towns: integer('towns').notNull(),
    spanDays: integer('span_days').notNull(),
    spreadKm: real('spread_km'),
    massPosted: boolean('mass_posted').notNull(),
    wouldShow: boolean('would_show').notNull(),
    ruleVersion: text('rule_version'),
    textCopyCount: integer('text_copy_count').notNull(),
  })
  .existing()

/** Internal (developers, review): every link with its basis and similarity. */
export const vLinks = schema
  .view('v_links', {
    listingA: uuid('listing_a').notNull(),
    listingB: uuid('listing_b').notNull(),
    basis: text('basis').notNull(),
    similarity: real('similarity'),
    photoIdMatch: boolean('photo_id_match').notNull(),
    decidedAt: at('decided_at').notNull(),
  })
  .existing()

/** Internal: clusters formed or changed since their last hand check, for review-console. */
export const vReviewQueue = schema
  .view('v_review_queue', {
    clusterKey: text('cluster_key').notNull(),
    listingCount: integer('listing_count').notNull(),
    townCount: integer('town_count').notNull(),
    massPosted: boolean('mass_posted').notNull(),
    asOf: at('as_of').notNull(),
    lastCheckedAt: at('last_checked_at'),
  })
  .existing()

/** Internal: daily shadow metrics for ops-metrics. No account data. */
export const vShadowMetrics = schema
  .view('v_shadow_metrics', {
    day: text('day').notNull(),
    clustersFormed: integer('clusters_formed').notNull(),
    activeClusters: integer('active_clusters').notNull(),
    activeMembers: integer('active_members').notNull(),
    candidatesRequested: integer('candidates_requested').notNull(),
    candidatesResolved: integer('candidates_resolved').notNull(),
    flagsWouldShow: integer('flags_would_show').notNull(),
    lookalikeSplits: integer('lookalike_splits').notNull(),
    photoIdMatches: integer('photo_id_matches').notNull(),
    reports: integer('reports').notNull(),
  })
  .existing()
