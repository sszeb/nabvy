import { sql } from 'drizzle-orm'
import { check, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { moduleSchema } from '../module-schema'

// Tables of the switches module, all in the Postgres schema 'switches' (packages/db/README.md).
// Only services/switches writes them. Other modules read state through the SQL functions
// switches.state(name), switches.is_on(name) and switches.gate_allows(gate, user_id), or through
// '@nabvy/switches'. After changing this file: pnpm db:generate switches

export const schema = moduleSchema('switches')

/**
 * One row per module, provider, gate, feature flag and the global pipeline pause. A name with no
 * row reads `off`. `changed_by` is null for rows seeded by a migration.
 */
export const switches = schema.table(
  'switches',
  {
    name: text('name').primaryKey(),
    kind: text('kind').notNull(),
    state: text('state').notNull().default('off'),
    allowList: uuid('allow_list').array(),
    changedAt: timestamp('changed_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    changedBy: uuid('changed_by'),
  },
  (t) => [
    check(
      'switches_name_format',
      sql`${t.name} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(${t.name}) <= 100`,
    ),
    check('switches_kind', sql`${t.kind} in ('module', 'provider', 'gate', 'flag', 'global')`),
    check('switches_state', sql`${t.state} in ('off', 'shadow', 'on')`),
    check('switches_shadow_modules_only', sql`${t.kind} = 'module' or ${t.state} <> 'shadow'`),
    check('switches_allow_list_gates_only', sql`${t.kind} = 'gate' or ${t.allowList} is null`),
    check(
      'switches_allow_list_size',
      sql`${t.allowList} is null or cardinality(${t.allowList}) <= 1000`,
    ),
    check(
      'switches_always_on',
      sql`${t.name} not in ('audit-log', 'incidents', 'switches') or ${t.state} = 'on'`,
    ),
  ],
)

/** Every switch, for the admin screen and internal readers (README.md). */
export const vState = schema
  .view('v_state', {
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    allowList: uuid('allow_list').array(),
    changedAt: timestamp('changed_at', { withTimezone: true, precision: 3 }).notNull(),
    changedBy: uuid('changed_by'),
  })
  .existing()
