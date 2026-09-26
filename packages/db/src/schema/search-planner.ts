import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the search-planner module, all in the Postgres schema 'search_planner'
// (packages/db/README.md). Only services/search-planner writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate search-planner
//
// The vocabularies checked below are the module's contracts (packages/contracts/src/modules/
// search-planner.ts). Spelled out here because a check constraint is SQL text; a contracts test
// (services/search-planner/test/contracts.test.ts) asserts each list still matches its enum.
// No table carries a user's ID except `one_off_runs.approved_by`, the approver, which no view
// shows: no user ID ever reaches a plan (card).

export const schema = moduleSchema('search-planner')

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))

export const SEARCH_PLANNER_TERM_CLASSES = ['narrow', 'broad'] as const
export const SEARCH_PLANNER_ORIGINS = ['wants', 'pivot', 'admin-test'] as const
export const SEARCH_PLANNER_ONE_OFF_PURPOSES = [
  'verification',
  'gap-fill',
  'actor-test',
  'fixture',
] as const
export const SEARCH_PLANNER_ONE_OFF_STATUSES = [
  'pending',
  'submitted',
  'completed',
  'failed',
  'cancelled',
] as const
/** Statuses that hold a centre's one verification run (a failed or cancelled one frees it). */
export const SEARCH_PLANNER_LIVE_STATUSES = ['pending', 'submitted', 'completed'] as const

/**
 * One row per centre any pair names (card, "Owns": `plans`). `active`: the centre is verified
 * and active in city-pages and has at least one pair; only active plans reach `v_plan`.
 * `centre_id` is a city-pages ID as a plain value, no foreign key (rule 4).
 */
export const plans = schema.table('plans', {
  centreId: text('centre_id').primaryKey(),
  active: boolean('active').notNull().default(false),
  ...timestampColumns(),
})

/**
 * One row per (centre, term, origin) (card, "Owns": `plan_terms`). A pair wanted by active wants
 * and also entered as the admin test is two rows; `v_plan` shows it once. `in_budget` and `rank`
 * are the budget bound's verdict (README.md); a pair outside it stays here and does not run.
 */
export const planTerms = schema.table(
  'plan_terms',
  {
    centreId: text('centre_id').notNull(),
    term: text('term').notNull(),
    origin: text('origin').notNull(),
    class: text('class').notNull(),
    wantCount: integer('want_count').notNull().default(0),
    paidWantCount: integer('paid_want_count').notNull().default(0),
    inBudget: boolean('in_budget').notNull().default(false),
    rank: integer('rank'),
    ...timestampColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.centreId, t.term, t.origin] }),
    check('plan_terms_class', sql`${t.class} in (${list(SEARCH_PLANNER_TERM_CLASSES)})`),
    check('plan_terms_origin', sql`${t.origin} in (${list(SEARCH_PLANNER_ORIGINS)})`),
    check(
      'plan_terms_term',
      sql`${t.term} ~ '^[a-z0-9][a-z0-9 .+-]*$' and char_length(${t.term}) <= 100`,
    ),
    check(
      'plan_terms_counts',
      sql`${t.wantCount} >= 0 and ${t.paidWantCount} >= 0 and ${t.paidWantCount} <= ${t.wantCount}`,
    ),
    check(
      'plan_terms_rank',
      sql`(${t.inBudget} and ${t.rank} >= 1) or (not ${t.inBudget} and ${t.rank} is null)`,
    ),
  ],
)

/**
 * One row per one-off run (card, "Owns": `one_off_runs`). `centre_id` repeats `input.centreId`
 * so a centre holds at most one live verification run. Anything but a verification carries its
 * approver (check `one_off_runs_approved`); the approval itself is in the audit log.
 */
export const oneOffRuns = schema.table(
  'one_off_runs',
  {
    id: idColumn(),
    purpose: text('purpose').notNull(),
    input: jsonb('input').notNull(),
    centreId: text('centre_id'),
    approvedBy: uuid('approved_by'),
    status: text('status').notNull().default('pending'),
    ...timestampColumns(),
  },
  (t) => [
    check('one_off_runs_purpose', sql`${t.purpose} in (${list(SEARCH_PLANNER_ONE_OFF_PURPOSES)})`),
    check('one_off_runs_status', sql`${t.status} in (${list(SEARCH_PLANNER_ONE_OFF_STATUSES)})`),
    check(
      'one_off_runs_approved',
      sql`${t.purpose} = 'verification' or ${t.approvedBy} is not null`,
    ),
    check(
      'one_off_runs_verification_centre',
      sql`${t.purpose} <> 'verification' or ${t.centreId} is not null`,
    ),
    uniqueIndex('one_off_runs_live_verification_idx')
      .on(t.centreId)
      .where(
        sql`${t.purpose} = 'verification' and ${t.status} in (${list(SEARCH_PLANNER_LIVE_STATUSES)})`,
      ),
    index('one_off_runs_status_idx').on(t.status, t.createdAt),
  ],
)

const at = (name: string) => timestamp(name, { withTimezone: true })

// Published views, created by hand-written SQL (migrations/search-planner/*_access.sql). Empty
// while the module's switch is off. Row types: `SearchPlannerPlan` and `SearchPlannerOneOffRun`
// in @nabvy/contracts/modules/search-planner.

/** Internal: the runnable (centre, term) pairs, for check-scheduler. */
export const vPlan = schema
  .view('v_plan', {
    centreId: text('centre_id').notNull(),
    term: text('term').notNull(),
    class: text('class').notNull(),
    origins: text('origins').array().notNull(),
    wantCount: integer('want_count').notNull(),
    paidWantCount: integer('paid_want_count').notNull(),
    rank: integer('rank').notNull(),
  })
  .existing()

/** Internal: every one-off run, without its approver's ID, for check-scheduler. */
export const vOneOffRuns = schema
  .view('v_one_off_runs', {
    id: uuid('id').notNull(),
    purpose: text('purpose').notNull(),
    input: jsonb('input').notNull(),
    approved: boolean('approved').notNull(),
    status: text('status').notNull(),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  })
  .existing()
