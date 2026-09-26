import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the asking-price-position module, all in the Postgres schema 'asking_price_position'
// (packages/db/README.md). Only services/asking-price-position writes them. Other modules import
// only the views (v-prefixed exports). After changing this file: pnpm db:generate asking-price-position

export const schema = moduleSchema('asking-price-position')

const at = (name: string) => timestamp(name, { withTimezone: true })
const minor = (name: string) => bigint(name, { mode: 'number' })

/**
 * One row per listing and asking-price-index group it is positioned in: its ask against the
 * group's counted asks. Written for every group size, so T4 (`positioned_at`) is stamped whether
 * the position is shown or not; the user-facing view shows it only at n≥10. The group's label,
 * median and p25-p75 range are copied from the index's figures of `stats_as_of`, so the
 * user-facing view reads only this module's table (docs/security.md, "Cross-module reads behind a
 * user-facing view"). Keyed for replays by the listing's card and evidence hashes, the group's
 * `as_of` and the rule version (rule 8). No seller field or seller key.
 */
export const positions = schema.table(
  'positions',
  {
    id: idColumn(),
    listingId: uuid('listing_id').notNull(),
    groupKey: text('group_key').notNull(),
    askMinor: minor('ask_minor').notNull(),
    rank: integer('rank'),
    n: integer('n').notNull(),
    percentile: doublePrecision('percentile'),
    robustZ: doublePrecision('robust_z'),
    label: text('label').notNull(),
    median: minor('median'),
    rangeLow: minor('range_low'),
    rangeHigh: minor('range_high'),
    currency: text('currency').notNull(),
    newMedian: minor('new_median'),
    newN: integer('new_n'),
    cardHash: text('card_hash').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    statsAsOf: at('stats_as_of').notNull(),
    ruleVersion: text('rule_version').notNull(),
    positionedAt: at('positioned_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('positions_listing_group_key').on(t.listingId, t.groupKey),
    index('positions_group_idx').on(t.groupKey),
    check('positions_ask_check', sql`${t.askMinor} >= 0`),
    check('positions_n_check', sql`${t.n} >= 0`),
    check('positions_rank_check', sql`${t.rank} is null or ${t.rank} between 1 and ${t.n} + 1`),
    check(
      'positions_percentile_check',
      sql`${t.percentile} is null or ${t.percentile} between 0 and 100`,
    ),
    check('positions_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
  ],
)

// Published views, created by hand-written SQL (migrations/asking-price-position/*_access.sql).
// Empty while the module's switch is off. Row types: @nabvy/contracts/modules/asking-price-position.

/** Internal: every position, shown or not, with its T4. */
export const vPositions = schema
  .view('v_positions', {
    listingId: uuid('listing_id').notNull(),
    groupKey: text('group_key').notNull(),
    askMinor: minor('ask_minor').notNull(),
    rank: integer('rank'),
    n: integer('n').notNull(),
    percentile: doublePrecision('percentile'),
    robustZ: doublePrecision('robust_z'),
    label: text('label').notNull(),
    median: minor('median'),
    rangeLow: minor('range_low'),
    rangeHigh: minor('range_high'),
    currency: text('currency').notNull(),
    newMedian: minor('new_median'),
    newN: integer('new_n'),
    statsAsOf: at('stats_as_of').notNull(),
    positionedAt: at('positioned_at').notNull(),
  })
  .existing()
