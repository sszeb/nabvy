import { sql } from 'drizzle-orm'
import { bigint, boolean, check, index, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the price-drop-watch module, all in the Postgres schema 'price_drop_watch'
// (packages/db/README.md). Only services/price-drop-watch writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate price-drop-watch

export const schema = moduleSchema('price-drop-watch')

const at = (name: string) => timestamp(name, { withTimezone: true })
const minor = (name: string) => bigint(name, { mode: 'number' })

/**
 * One row per user watching one listing. The listing ID is listing-ingest's, held as a plain
 * value (rule 4). A watch never moves to another listing ID, even across a relist (README.md,
 * "Decisions"; catalogue question 21): unwatching sets `active` false rather than deleting the
 * row, so the user's own drop history stays.
 */
export const watches = schema.table(
  'watches',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestampColumns(),
  },
  (t) => [
    unique('watches_user_listing_key').on(t.userId, t.listingId),
    index('watches_listing_active_idx').on(t.listingId).where(sql`${t.active}`),
  ],
)

/**
 * One row per detected price drop on a watch, from listing-ingest's own observed prices only
 * (never the seller's displayed "previous price", and never a number this module invents).
 * `cardHash` is the triggering sighting's own card hash (listing-ingest's rule 8 hash), copied
 * verbatim, so a replayed event writes nothing new (the unique key below). `relistGroupId` is
 * relist-merge's group ID for the listing at write time, a plain value, null when ungrouped or
 * relist-merge is off; it only dedupes an announcement within one batch (README.md, "Decisions"),
 * never a card column.
 */
export const drops = schema.table(
  'drops',
  {
    id: idColumn(),
    watchId: uuid('watch_id')
      .notNull()
      .references(() => watches.id, { onDelete: 'cascade' }),
    fromMinor: minor('from_minor').notNull(),
    toMinor: minor('to_minor').notNull(),
    currency: text('currency').notNull(),
    observedAt: at('observed_at').notNull(),
    cardHash: text('card_hash').notNull(),
    relistGroupId: uuid('relist_group_id'),
    ...timestampColumns(),
  },
  (t) => [
    unique('drops_watch_card_key').on(t.watchId, t.cardHash),
    index('drops_watch_idx').on(t.watchId),
    check('drops_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
    check('drops_from_check', sql`${t.fromMinor} >= 0`),
    check('drops_to_check', sql`${t.toMinor} >= 0`),
    check('drops_is_drop_check', sql`${t.toMinor} < ${t.fromMinor}`),
    check('drops_card_hash_check', sql`${t.cardHash} ~ '^[0-9a-f]{64}$'`),
  ],
)
