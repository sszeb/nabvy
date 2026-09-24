import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the details-queue module, all in the Postgres schema 'details_queue'
// (packages/db/README.md). Only services/details-queue writes them. Other modules import only the
// view (v-prefixed export). Migrations are hand-written in migrations/details-queue/ (this module
// has no Drizzle snapshot; use `pnpm db:generate details-queue --custom`). Row type of `v_queue`:
// `DetailsQueueItem` in @nabvy/contracts/modules/details-queue.

export const schema = moduleSchema('details-queue')

/**
 * One item per listing and lane: the queue's deduplication key is the idempotency key's
 * `source + sourceListingId` (CLAUDE.md), per lane, since a photo capture is a different fetch.
 * `attempts` counts failed fetches (2.10: `failed` after 2); `requeues` counts refreshes of a
 * partial or missing description (requeued once). `job_id` is the apify-gateway job of the
 * item's latest batch, a plain value (rule 4: no foreign key into another module's schema).
 */
export const items = schema.table(
  'items',
  {
    id: idColumn(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    lane: text('lane').notNull(),
    priority: text('priority').notNull(),
    status: text('status').notNull().default('queued'),
    reason: text('reason').notNull(),
    requestedBy: text('requested_by').notNull(),
    regionId: text('region_id'),
    attempts: integer('attempts').notNull().default(0),
    requeues: integer('requeues').notNull().default(0),
    lastOutcome: text('last_outcome'),
    jobId: integer('job_id'),
    deferredOn: date('deferred_on'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    ...timestampColumns(),
  },
  (t) => [
    unique('items_source_listing_lane_key').on(t.source, t.sourceListingId, t.lane),
    index('items_waiting_idx').on(t.status, t.lane, t.regionId),
    check('items_source_check', sql`${t.source} in ('facebook')`),
    check('items_lane_check', sql`${t.lane} in ('text', 'photo')`),
    check(
      'items_priority_check',
      sql`${t.priority} in ('new-listing', 'shortlisted', 'photo-capture', 'sweep')`,
    ),
    check(
      'items_status_check',
      sql`${t.status} in ('queued', 'leased', 'done', 'deferred', 'failed')`,
    ),
  ],
)

/**
 * A per-listing lease: while it holds, no other batch may send the ID (`SCALE_PLAN.md:80-82`).
 * One lease per listing whatever the lane, so two runs never fetch the same ID at once.
 */
export const leases = schema.table(
  'leases',
  {
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    jobId: integer('job_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'leases_pkey', columns: [t.source, t.sourceListingId] }),
    index('leases_job_idx').on(t.jobId),
  ],
)

/**
 * One row per details run submitted: the gateway job, its lane, region, route and IDs.
 * `closed_at` is set once, when the run's rows have been read (or its job ended without rows);
 * a second close finds it set and changes nothing. `day` is the London calendar day, for the
 * daily cap.
 */
export const batches = schema.table(
  'batches',
  {
    jobId: integer('job_id').primaryKey(),
    source: text('source').notNull(),
    lane: text('lane').notNull(),
    regionId: text('region_id').notNull(),
    route: text('route').notNull(),
    size: integer('size').notNull(),
    sourceListingIds: text('source_listing_ids').array().notNull(),
    day: date('day').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    outcome: jsonb('outcome').$type<Record<string, number>>(),
  },
  (t) => [
    index('batches_day_idx').on(t.day),
    check('batches_size_check', sql`${t.size} between 1 and 200`),
    check('batches_route_check', sql`${t.route} in ('graphql', 'page')`),
  ],
)

const at = (name: string) => timestamp(name, { withTimezone: true })

/** Internal: every item with its lease. Created by hand-written SQL; empty while the module is off. */
export const vQueue = schema
  .view('v_queue', {
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    lane: text('lane').notNull(),
    priority: text('priority').notNull(),
    status: text('status').notNull(),
    reason: text('reason').notNull(),
    requestedBy: text('requested_by').notNull(),
    regionId: text('region_id'),
    attempts: integer('attempts').notNull(),
    requeues: integer('requeues').notNull(),
    lastOutcome: text('last_outcome'),
    jobId: integer('job_id'),
    leaseExpiresAt: at('lease_expires_at'),
    deferredOn: date('deferred_on'),
    doneAt: at('done_at'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  })
  .existing()
