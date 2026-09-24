import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the listing-lifecycle module, all in the Postgres schema 'listing_lifecycle' (packages/db/README.md).
// Only services/listing-lifecycle writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate listing-lifecycle

export const schema = moduleSchema('listing-lifecycle')

const at = (name: string) => timestamp(name, { withTimezone: true })

const SOURCES = sql`('ebay', 'facebook', 'gumtree', 'vinted', 'cex')`

/**
 * One row per listing: its availability and what it rests on. The listing ID is listing-ingest's,
 * held as a plain value (rule 4). `input_hash` is the content hash of the evidence read (latest
 * observation, latest detail fetch, missed sweeps), so a replay writes nothing; `changed_by` is the
 * key of the event or tick that last changed the status, from which the `status-changed` event is
 * derived again on a replay. `evaluated_at` is the tick's round-robin cursor.
 */
export const status = schema.table(
  'status',
  {
    listingId: uuid('listing_id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    status: text('status').notNull(),
    basis: text('basis').notNull(),
    lastSeenAt: at('last_seen_at'),
    observedAt: at('observed_at'),
    missedSweeps: integer('missed_sweeps').notNull().default(0),
    inputHash: text('input_hash').notNull(),
    changedBy: text('changed_by').notNull(),
    changedAt: at('changed_at').notNull().defaultNow(),
    /** When the tick last evaluated the listing: its round-robin cursor, not published. */
    evaluatedAt: at('evaluated_at'),
    ...timestampColumns(),
  },
  (t) => [
    primaryKey({ name: 'status_pkey', columns: [t.listingId] }),
    uniqueIndex('status_source_listing_key').on(t.source, t.sourceListingId),
    index('status_status_idx').on(t.status, t.lastSeenAt),
    check('status_source_check', sql`${t.source} in ${SOURCES}`),
    check(
      'status_status_check',
      sql`${t.status} in ('live', 'pending', 'marked-sold', 'unresolved', 'not-seen-recently', 'unknown')`,
    ),
    check(
      'status_basis_check',
      sql`${t.basis} in ('search-card', 'detail', 'unresolved-fetch', 'missed-sweeps', 'no-data')`,
    ),
    check('status_missed_sweeps_check', sql`${t.missedSweeps} >= 0`),
    check('status_input_hash_check', sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
    check('status_changed_by_check', sql`char_length(${t.changedBy}) between 1 and 512`),
  ],
)

/**
 * One row per scheduled recheck step. A reason's schedule is written once per listing while any
 * step of it is pending (partial unique index), so a repeated request writes nothing. `due_at` is
 * server time; `sent_at` and `outcome` are set once when the tick hands the step to details-queue
 * or skips it.
 */
export const rechecks = schema.table(
  'rechecks',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    reason: text('reason').notNull(),
    step: smallint('step').notNull(),
    requestedBy: text('requested_by').notNull(),
    dueAt: at('due_at').notNull(),
    sentAt: at('sent_at'),
    outcome: text('outcome'),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex('rechecks_pending_key')
      .on(t.listingId, t.reason, t.step)
      .where(sql`${t.sentAt} is null`),
    index('rechecks_due_idx').on(t.dueAt).where(sql`${t.sentAt} is null`),
    index('rechecks_listing_idx').on(t.listingId),
    check('rechecks_source_check', sql`${t.source} in ${SOURCES}`),
    check(
      'rechecks_reason_check',
      sql`${t.reason} in ('alerted', 'candidate', 'watched', 'not-seen')`,
    ),
    check('rechecks_step_check', sql`${t.step} between 0 and 4`),
    check('rechecks_requested_by_check', sql`${t.requestedBy} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'`),
    check('rechecks_outcome_check', sql`${t.outcome} in ('queued', 'skipped-unresolved')`),
    check('rechecks_sent_check', sql`(${t.sentAt} is null) = (${t.outcome} is null)`),
  ],
)

// Published view, created by hand-written SQL (migrations/listing-lifecycle/*_access.sql). Empty
// while the module's switch is off. Row type: `ListingLifecycleStatus` in
// @nabvy/contracts/modules/listing-lifecycle.

/** Internal: each listing's availability and what it rests on. */
export const vStatus = schema
  .view('v_status', {
    listingId: uuid('listing_id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    status: text('status').notNull(),
    basis: text('basis').notNull(),
    lastSeenAt: at('last_seen_at'),
    observedAt: at('observed_at'),
    missedSweeps: integer('missed_sweeps').notNull(),
    changedAt: at('changed_at').notNull(),
  })
  .existing()
