import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the asking-price-index module, all in the Postgres schema 'asking_price_index'
// (packages/db/README.md). Only services/asking-price-index writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate asking-price-index

export const schema = moduleSchema('asking-price-index')

const at = (name: string) => timestamp(name, { withTimezone: true })
const minor = (name: string) => bigint(name, { mode: 'number' })

/**
 * One row per comparable group: catalogue item × context × condition × country and currency ×
 * window (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:262-263). `label` is the text the
 * user-facing band shows, built from the catalogue name when the group is opened.
 */
export const groups = schema.table(
  'groups',
  {
    groupKey: text('group_key').primaryKey(),
    catalogueId: text('catalogue_id').notNull(),
    context: text('context').notNull(),
    condition: text('condition').notNull(),
    country: text('country').notNull(),
    currency: text('currency').notNull(),
    windowDays: integer('window_days').notNull(),
    label: text('label').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    index('groups_catalogue_idx').on(t.catalogueId),
    check('groups_context_check', sql`${t.context} in ('standalone', 'in_pc', 'bundle')`),
    check(
      'groups_condition_check',
      sql`${t.condition} in ('new', 'used_like_new', 'used_good', 'used_fair')`,
    ),
    check('groups_country_check', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('groups_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
    check('groups_window_check', sql`${t.windowDays} between 1 and 90`),
  ],
)

/**
 * One row per listing in a group: its current ask and whether it counts. A listing is in one group
 * per offered catalogue item. `collapse_key` is the relist group or copy cluster it collapses into
 * (internal IDs, never shown to users), else the listing itself. No seller field and no seller
 * key: keys are read in memory for one-per-key and the thin mark only.
 */
export const members = schema.table(
  'members',
  {
    id: idColumn(),
    groupKey: text('group_key')
      .notNull()
      .references(() => groups.groupKey, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').notNull(),
    askMinor: minor('ask_minor').notNull(),
    counted: boolean('counted').notNull(),
    excluded: text('excluded'),
    sampleOrigin: text('sample_origin').notNull(),
    collapseKey: text('collapse_key').notNull(),
    cityPageId: text('city_page_id'),
    seenAt: at('seen_at').notNull(),
    cardHash: text('card_hash').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('members_group_listing_key').on(t.groupKey, t.listingId),
    index('members_listing_idx').on(t.listingId),
    index('members_group_idx').on(t.groupKey),
    check('members_ask_check', sql`${t.askMinor} >= 0`),
    check('members_origin_check', sql`${t.sampleOrigin} in ('on_target', 'by_catch')`),
    check('members_counted_check', sql`not (${t.counted} and ${t.excluded} is not null)`),
    check(
      'members_excluded_check',
      sql`${t.excluded} in ('noise', 'zero_price', 'money_kind', 'sold', 'unverified_binding', 'promoted', 'suppressed', 'stale', 'relist', 'copy', 'seller', 'outlier')`,
    ),
  ],
)

/**
 * One row per group: its figures over the counted asks, in minor units. Rewritten only when a
 * figure changes, so `as_of` is the version readers key on (rule 8: group key@as_of).
 */
export const stats = schema.table(
  'stats',
  {
    groupKey: text('group_key')
      .primaryKey()
      .references(() => groups.groupKey, { onDelete: 'cascade' }),
    n: integer('n').notNull(),
    median: minor('median'),
    mad: minor('mad'),
    p25: minor('p25'),
    p75: minor('p75'),
    min: minor('min'),
    max: minor('max'),
    thin: boolean('thin').notNull(),
    copyCollapse: boolean('copy_collapse').notNull(),
    asOf: at('as_of').notNull(),
    ...timestampColumns(),
  },
  (t) => [check('stats_n_check', sql`${t.n} >= 0`)],
)

// Published views, created by hand-written SQL (migrations/asking-price-index/*_access.sql). Empty
// while the module's switch is off. Row types: @nabvy/contracts/modules/asking-price-index.

/** Internal: each group with its figures. */
export const vGroups = schema
  .view('v_groups', {
    groupKey: text('group_key').notNull(),
    catalogueId: text('catalogue_id').notNull(),
    context: text('context').notNull(),
    condition: text('condition').notNull(),
    country: text('country').notNull(),
    currency: text('currency').notNull(),
    windowDays: integer('window_days').notNull(),
    label: text('label').notNull(),
    n: integer('n'),
    median: minor('median'),
    mad: minor('mad'),
    p25: minor('p25'),
    p75: minor('p75'),
    min: minor('min'),
    max: minor('max'),
    thin: boolean('thin'),
    copyCollapse: boolean('copy_collapse'),
    asOf: at('as_of'),
  })
  .existing()

/** Internal: every member with its ask and whether it counts. */
export const vMembers = schema
  .view('v_members', {
    groupKey: text('group_key').notNull(),
    listingId: uuid('listing_id').notNull(),
    askMinor: minor('ask_minor').notNull(),
    counted: boolean('counted').notNull(),
    excluded: text('excluded'),
    sampleOrigin: text('sample_origin').notNull(),
    seenAt: at('seen_at').notNull(),
  })
  .existing()
