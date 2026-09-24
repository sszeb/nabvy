import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema } from '../module-schema'

// Tables of the audit-log module, all in the Postgres schema 'audit_log' (packages/db/README.md).
// Only services/audit-log writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate audit-log

export const schema = moduleSchema('audit-log')

/**
 * One row per human or admin action: who, what, on what, before and after, why, when.
 * Append-only: no role is granted update or delete, and a trigger refuses both (and truncate)
 * even for the owner. No `updated_at`, because a row never changes; `at` is its creation time.
 */
export const entries = schema.table(
  'entries',
  {
    id: idColumn(),
    actorUserId: uuid('actor_user_id').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entries_at_idx').on(t.at),
    index('entries_actor_user_id_at_idx').on(t.actorUserId, t.at),
    index('entries_target_at_idx').on(t.target, t.at),
    check(
      'entries_action_format',
      sql`${t.action} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(${t.action}) <= 100`,
    ),
    check(
      'entries_target_format',
      sql`${t.target} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*:\\S+$' and length(${t.target}) <= 300`,
    ),
    check(
      'entries_reason_length',
      sql`${t.reason} is null or (length(btrim(${t.reason})) between 1 and 1000)`,
    ),
    check(
      'entries_restricted_read_reason',
      sql`${t.action} <> 'audit-log.restricted-read' or ${t.reason} is not null`,
    ),
  ],
)

/** Every entry, for admins only (no application role is granted it yet; README.md). */
export const vEntries = schema
  .view('v_entries', {
    id: uuid('id').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull(),
  })
  .existing()
