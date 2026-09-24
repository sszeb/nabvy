import { integer, jsonb, numeric, text, timestamp } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema } from '../module-schema'

// Tables of the source-health module, all in the Postgres schema 'source_health'
// (packages/db/README.md). Only services/source-health writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate source-health

export const schema = moduleSchema('source-health')

/**
 * One row per Europe/London calendar day (docs/design/modules/source-health.md, "Does / does
 * not": "tracks per day"). `processedJobIds` is bookkeeping, not a card-named metric: it lets the
 * handler recognise a replayed `apify-gateway.run-collected` for a job already folded into the
 * day's tally, so a retried delivery adds nothing twice (CLAUDE.md, "Idempotent handlers").
 * `alerted` lists the alert reasons already fired for the day, so a reason's event fires once.
 */
export const healthDaily = schema.table('health_daily', {
  day: text('day').primaryKey(),
  processedJobIds: jsonb('processed_job_ids').$type<number[]>().notNull().default([]),
  totalSearches: integer('total_searches').notNull().default(0),
  degradedSearches: integer('degraded_searches').notNull().default(0),
  breakerTrips: integer('breaker_trips').notNull().default(0),
  newOperationIds: jsonb('new_operation_ids').$type<string[]>().notNull().default([]),
  blockedPages: jsonb('blocked_pages').$type<boolean[]>().notNull().default([]),
  alerted: jsonb('alerted').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * The ramp's history: one row per stage ever entered (card: "Holds the ramp stage"). The current
 * stage is the row with the latest `started_at`; the repo never updates a row in place, so
 * `advanced_by` and `started_at` of a past stage are never rewritten.
 */
export const ramp = schema.table('ramp', {
  id: idColumn(),
  stage: integer('stage').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  maxChecksPerDay: integer('max_checks_per_day').notNull(),
  advancedBy: text('advanced_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Published views, created by hand-written SQL (migrations/source-health/*_access.sql). Empty
// while the module's switch is off (rule 11). Row types: `SourceHealthDay` and
// `SourceHealthRampStage` in @nabvy/contracts/modules/source-health.

/** Internal: each day's tally. */
export const vHealth = schema
  .view('v_health', {
    day: text('day').notNull(),
    totalSearches: integer('total_searches').notNull(),
    degradedSearches: integer('degraded_searches').notNull(),
    pctDegraded: numeric('pct_degraded', { precision: 5, scale: 4 }).notNull(),
    breakerTrips: integer('breaker_trips').notNull(),
    newOperationIds: jsonb('new_operation_ids').$type<string[]>().notNull(),
    blockedPages: jsonb('blocked_pages').$type<boolean[]>().notNull(),
    alerted: jsonb('alerted').$type<string[]>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  })
  .existing()

/** Internal: the current ramp stage. */
export const vRampStage = schema
  .view('v_ramp_stage', {
    stage: integer('stage').notNull(),
    maxChecksPerDay: integer('max_checks_per_day').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    advancedBy: text('advanced_by'),
  })
  .existing()

export type HealthDailyRow = typeof healthDaily.$inferSelect
export type RampRow = typeof ramp.$inferSelect
