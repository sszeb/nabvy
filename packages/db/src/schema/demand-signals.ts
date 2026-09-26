import { sql } from 'drizzle-orm'
import { boolean, check, date, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the demand-signals module, all in the Postgres schema 'demand_signals' (packages/db/
// README.md). Only services/demand-signals writes them. Other modules import only the views
// (v-prefixed exports). After changing this file: pnpm db:generate demand-signals

export const schema = moduleSchema('demand-signals')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * One row per week, centre and catalogue family (the card's `cells`). `wants` is the count of
 * active wants naming the family at the centre when the week was published; `adverts` the wanted
 * or swap adverts first listed that week, a copy-advert cluster counted once. A count under 10 is
 * never stored: it is null, and a row whose counts are both null is `suppressed` (checks below,
 * the database's own guard of the threshold). No user ID, no seller field, no listing ID.
 * `centre_id` is city-pages' ID held as a plain value (rule 4). Written once per week and rule
 * version: a replay inserts nothing.
 */
export const cells = schema.table(
  'cells',
  {
    id: idColumn(),
    weekStart: date('week_start').notNull(),
    centreId: text('centre_id').notNull(),
    family: text('family').notNull(),
    wants: integer('wants'),
    adverts: integer('adverts'),
    suppressed: boolean('suppressed').notNull(),
    ruleVersion: text('rule_version').notNull(),
    publishedAt: at('published_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex('cells_week_centre_family_version_key').on(
      t.weekStart,
      t.centreId,
      t.family,
      t.ruleVersion,
    ),
    check('cells_week_start_monday_check', sql`extract(isodow from ${t.weekStart}) = 1`),
    check('cells_wants_check', sql`${t.wants} is null or ${t.wants} >= 10`),
    check('cells_adverts_check', sql`${t.adverts} is null or ${t.adverts} >= 10`),
    check(
      'cells_suppressed_check',
      sql`${t.suppressed} = (${t.wants} is null and ${t.adverts} is null)`,
    ),
    check('cells_centre_id_check', sql`length(${t.centreId}) between 1 and 64`),
    check('cells_family_check', sql`length(${t.family}) between 1 and 200`),
    check('cells_rule_version_check', sql`${t.ruleVersion} ~ '^ds-[0-9]+$'`),
  ],
)

/** Internal (row type DemandSignalsCell): every cell, suppressed ones with null counts. */
export const vCells = schema
  .view('v_cells', {
    weekStart: date('week_start').notNull(),
    centreId: text('centre_id').notNull(),
    family: text('family').notNull(),
    wants: integer('wants'),
    adverts: integer('adverts'),
    suppressed: boolean('suppressed').notNull(),
    ruleVersion: text('rule_version').notNull(),
    publishedAt: at('published_at').notNull(),
  })
  .existing()
