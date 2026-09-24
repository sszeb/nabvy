import { sql } from 'drizzle-orm'
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { moduleSchema } from '../module-schema'

// Tables of the product-events module, all in the Postgres schema 'product_events'
// (packages/db/README.md). Only services/product-events writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate product-events.
//
// The table is monthly range-partitioned on `at` (docs/contracts.md:185). Drizzle Kit cannot
// generate `PARTITION BY` itself, so the very first migration it generated for this table (a
// plain, unpartitioned `CREATE TABLE`) was immediately replaced by a hand-written one that drops
// it and creates the real partitioned table, its initial partitions and a default partition
// (docs/engineering.md:30, "partitions ... are hand-written SQL migrations in the same folder,
// numbered in sequence"; packages/db/migrations/product-events/..._product_events_access.sql).
// This declaration still matches the live table shape column for column, so a later plain column
// change here and a plain `pnpm db:generate product-events` produce an ordinary `ALTER TABLE`,
// which Postgres applies to a partitioned table the same as any other.

export const schema = moduleSchema('product-events')

/**
 * One row per tracked product event (`docs/analytics.md`, "First-party product events").
 * Append-only, like `audit_log.entries`: no `updated_at`, and no role is granted update or
 * delete. The primary key is `(id, at)` because Postgres requires the partition key in every
 * unique index of a partitioned table.
 */
export const events = schema.table('events', {
  id: uuid('id').notNull().default(sql`nabvy_core.uuidv7()`),
  userId: uuid('user_id').notNull(),
  event: text('event').notNull(),
  properties: jsonb('properties').notNull().default({}),
  sessionId: text('session_id'),
  at: timestamp('at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
})

/**
 * Internal view: every event, for the modules the module card lists as depending on
 * product-events (none yet) and for internal readers. Declared here, created by hand-written SQL.
 * Returns no rows while the `product-events` switch is off (rule 11 of `_rules.md`).
 */
export const vEvents = schema
  .view('v_events', {
    id: uuid('id').notNull(),
    userId: uuid('user_id').notNull(),
    event: text('event').notNull(),
    properties: jsonb('properties').notNull(),
    sessionId: text('session_id'),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull(),
  })
  .existing()
