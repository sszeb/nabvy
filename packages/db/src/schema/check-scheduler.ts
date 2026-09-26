import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the check-scheduler module, all in the Postgres schema 'check_scheduler'
// (packages/db/README.md). Only services/check-scheduler writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate check-scheduler
//
// The vocabularies checked below are the module's contracts (packages/contracts/src/modules/
// check-scheduler.ts). Spelled out here because a check constraint is SQL text; a contracts test
// (services/check-scheduler/test/contracts.test.ts) asserts each list still matches its enum.
// Pipeline data only: regions, terms and job IDs, never a user ID.

export const schema = moduleSchema('check-scheduler')

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))
const at = (name: string) => timestamp(name, { withTimezone: true })

export const CHECK_SCHEDULER_KINDS = ['newest', 'catch-up', 'sweep'] as const
export const CHECK_SCHEDULER_TERM_CLASSES = ['narrow', 'broad'] as const
export const CHECK_SCHEDULER_REASONS = ['scheduled', 'rerun', 'one-off', 'verification'] as const
export const CHECK_SCHEDULER_RUN_STATUSES = ['pending', 'submitted', 'refused', 'shadow'] as const
export const CHECK_SCHEDULER_SHAPES = [
  'verification',
  'newest-check',
  'sweep-narrow',
  'sweep-broad',
] as const

/**
 * When each region's check of one kind and term class is next due (card, "Owns": `schedule`).
 * `centre_id` is a city-pages ID as a plain value, no foreign key (rule 4). `cadence_s` is the
 * cadence the last run was scheduled at (throttle included), kept for the record.
 */
export const schedule = schema.table(
  'schedule',
  {
    centreId: text('centre_id').notNull(),
    termClass: text('term_class').notNull(),
    kind: text('kind').notNull(),
    cadenceS: integer('cadence_s').notNull(),
    nextDueAt: at('next_due_at').notNull(),
    lastRunAt: at('last_run_at'),
    ...timestampColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.centreId, t.termClass, t.kind] }),
    check('schedule_kind', sql`${t.kind} in (${list(CHECK_SCHEDULER_KINDS)})`),
    check('schedule_term_class', sql`${t.termClass} in (${list(CHECK_SCHEDULER_TERM_CLASSES)})`),
    check('schedule_cadence', sql`${t.cadenceS} > 0`),
    index('schedule_due_idx').on(t.nextDueAt),
  ],
)

/**
 * One row per run this module decided (card, "Owns": `check_runs`). A tick claims its slot per
 * region: one row per (tick_at, centre_id), so a retried tick submits nothing twice. A rerun
 * repeats one degraded search at most once (unique `rerun_of`); a one-off run is carried out once
 * while live (partial unique `one_off_id`; a refused attempt frees it for the next tick).
 */
export const checkRuns = schema.table(
  'check_runs',
  {
    id: idColumn(),
    jobId: integer('job_id'),
    centreId: text('centre_id').notNull(),
    kind: text('kind').notNull(),
    shape: text('shape').notNull(),
    terms: text('terms').array().notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    tickAt: at('tick_at'),
    rerunOf: uuid('rerun_of'),
    oneOffId: uuid('one_off_id'),
    errorCode: text('error_code'),
    ...timestampColumns(),
  },
  (t) => [
    check('check_runs_kind', sql`${t.kind} in (${list(CHECK_SCHEDULER_KINDS)})`),
    check('check_runs_shape', sql`${t.shape} in (${list(CHECK_SCHEDULER_SHAPES)})`),
    check('check_runs_reason', sql`${t.reason} in (${list(CHECK_SCHEDULER_REASONS)})`),
    check('check_runs_status', sql`${t.status} in (${list(CHECK_SCHEDULER_RUN_STATUSES)})`),
    check(
      'check_runs_terms',
      sql`cardinality(${t.terms}) between 1 and 20 and array_position(${t.terms}, null) is null`,
    ),
    check('check_runs_job', sql`(${t.status} = 'submitted') = (${t.jobId} is not null)`),
    check('check_runs_tick', sql`(${t.status} = 'pending') = (${t.tickAt} is null)`),
    check('check_runs_rerun', sql`(${t.reason} = 'rerun') = (${t.rerunOf} is not null)`),
    check(
      'check_runs_one_off',
      sql`(${t.reason} in ('one-off', 'verification')) = (${t.oneOffId} is not null)`,
    ),
    uniqueIndex('check_runs_tick_centre_idx').on(t.tickAt, t.centreId),
    uniqueIndex('check_runs_rerun_of_idx').on(t.rerunOf),
    uniqueIndex('check_runs_live_one_off_idx').on(t.oneOffId).where(sql`${t.status} <> 'refused'`),
    index('check_runs_job_idx').on(t.jobId),
    index('check_runs_centre_idx').on(t.centreId, t.tickAt),
  ],
)

// Published views, created by hand-written SQL (migrations/check-scheduler/*_access.sql). Empty
// while the module's switch is off. Row type: `CheckSchedulerRun` in
// @nabvy/contracts/modules/check-scheduler.

/** Internal: every run this module decided, for its own yield reads and for ops. */
export const vCheckRuns = schema
  .view('v_check_runs', {
    id: uuid('id').notNull(),
    jobId: integer('job_id'),
    centreId: text('centre_id').notNull(),
    kind: text('kind').notNull(),
    shape: text('shape').notNull(),
    terms: text('terms').array().notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    tickAt: at('tick_at'),
    rerunOf: uuid('rerun_of'),
    oneOffId: uuid('one_off_id'),
    errorCode: text('error_code'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  })
  .existing()
