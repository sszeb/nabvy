import { sql } from 'drizzle-orm'
import { check, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { moduleSchema } from '../module-schema'

// Tables of the lifecycle-messaging module, all in the Postgres schema 'lifecycle_messaging'
// (packages/db/README.md). Only services/lifecycle-messaging writes them. Other modules read
// through v_runs. After changing this file: pnpm db:generate lifecycle-messaging

export const schema = moduleSchema('lifecycle-messaging')

/**
 * One row per message actually sent (module card, "Owns": user_id, programme, step, at). `at` is
 * when the send happened; `triggered_at` is the qualifying trigger event's own timestamp, or, for
 * an inactivity-triggered programme (`re-engagement`), the computed last-activity time
 * (services/lifecycle-messaging/README.md, "Decisions"). This is the row a repeat run checks
 * before sending again, so a step for one trigger occurrence is sent at most once.
 */
export const programmeRuns = schema.table(
  'programme_runs',
  {
    userId: uuid('user_id').notNull(),
    programme: text('programme').notNull(),
    step: text('step').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true, precision: 3 }).notNull(),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.programme, t.step, t.triggeredAt] }),
    check(
      'programme_runs_programme',
      sql`${t.programme} in ('abandoned-onboarding', 'channel-not-linked', 'activation', 'cap-reached', 'trial', 'win-back', 're-engagement')`,
    ),
  ],
)

/** Internal: every run, for modules that declare lifecycle-messaging as a dependency. */
export const vRuns = schema
  .view('v_runs', {
    userId: uuid('user_id').notNull(),
    programme: text('programme').notNull(),
    step: text('step').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true, precision: 3 }).notNull(),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull(),
  })
  .existing()
