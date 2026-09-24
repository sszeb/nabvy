import { boolean, integer, jsonb, numeric, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { moduleSchema } from '../module-schema'

// Tables and views of the apify-gateway module, in the Postgres schema 'apify_gateway'
// (packages/db/README.md). The tables were created by supabase/migrations before the module
// layout existed; packages/db/migrations/apify-gateway adds what the module needed since. These
// definitions mirror the live shapes for typed queries; the migrations are hand-written, never
// generated from this file (services/apify-gateway/README.md, "Decisions").
// Only services/apify-gateway reads the tables. Other modules import only the views (v-prefixed
// exports); `restrictedRows` holds seller fields and is for the seller-data allowlist only.

export const schema = moduleSchema('apify-gateway')

const at = (name: string) => timestamp(name, { withTimezone: true })

/** One unit of gateway work: a paid run, a free collect, an env check or an actor-info read. */
export const jobs = schema.table('jobs', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  kind: text('kind').notNull(),
  input: jsonb('input').notNull(),
  runOptions: jsonb('run_options').notNull(),
  reserveUsd: numeric('reserve_usd', { precision: 10, scale: 4 }).notNull(),
  status: text('status').notNull(),
  apifyRunId: text('apify_run_id'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
  result: jsonb('result'),
  error: text('error'),
  note: text('note'),
  settledAt: at('settled_at'),
  tags: jsonb('tags').notNull(),
  meteredAt: at('metered_at'),
  announcedAt: at('announced_at'),
  settleAnnouncedAt: at('settle_announced_at'),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
})

/** Every dataset row of a job, whole and unredacted: the one durable copy. */
export const items = schema.table(
  'items',
  {
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    item: jsonb('item').notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.seq] })],
)

/** Internal: jobs with their run kind, tags, costs and times; no run object. */
export const vJobs = schema
  .view('v_jobs', {
    id: integer('id').notNull(),
    kind: text('kind').notNull(),
    runKind: text('run_kind'),
    status: text('status').notNull(),
    tags: jsonb('tags').notNull(),
    input: jsonb('input').notNull(),
    memoryMb: integer('memory_mb'),
    timeoutSecs: integer('timeout_secs'),
    reserveUsd: numeric('reserve_usd', { precision: 10, scale: 4 }).notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
    apifyRunId: text('apify_run_id'),
    itemCount: integer('item_count'),
    error: text('error'),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
    settledAt: at('settled_at'),
    announcedAt: at('announced_at'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  })
  .existing()

/** Internal: each collected job's RUN_SUMMARY, with its detail route and searches. */
export const vRunSummaries = schema
  .view('v_run_summaries', {
    jobId: integer('job_id').notNull(),
    apifyRunId: text('apify_run_id'),
    runKind: text('run_kind'),
    summary: jsonb('summary').notNull(),
    detailRoute: jsonb('detail_route'),
    searches: jsonb('searches'),
  })
  .existing()

/** Internal: every row with each `seller` and `marketplace_listing_seller` removed. */
export const vRows = schema
  .view('v_rows', {
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    recordType: text('record_type'),
    listingId: text('listing_id'),
    item: jsonb('item').notNull(),
  })
  .existing()

/** Internal: whether each row has a seller object, and nothing about the seller. */
export const vSellerPresence = schema
  .view('v_seller_presence', {
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    present: boolean('present'),
  })
  .existing()

/** Restricted: whole rows, seller fields included. Seller-data allowlist only (rule 6). */
export const restrictedRows = schema
  .view('restricted_rows', {
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    item: jsonb('item').notNull(),
  })
  .existing()
