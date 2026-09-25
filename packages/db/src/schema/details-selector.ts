import { sql } from 'drizzle-orm'
import { check, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the details-selector module, all in the Postgres schema 'details_selector'
// (packages/db/README.md). Only services/details-selector writes them. Other modules import only
// the views (v-prefixed exports). After changing this file: pnpm db:generate details-selector

export const schema = moduleSchema('details-selector')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * One row per selected card version (rule 8's card-stage idempotency key: source, source listing
 * ID, card hash). A replay of the same card version writes nothing new; a changed card hash (a new
 * price, title or availability) is a new row, re-selected. Keyed by source and source listing ID,
 * not the listing-ingest UUID, because that is what `detailsQueue.enqueue()` takes.
 */
export const selections = schema.table(
  'selections',
  {
    id: idColumn(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    cardHash: text('card_hash').notNull(),
    reason: text('reason').notNull(),
    selectedAt: at('selected_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('selections_source_listing_hash_key').on(t.source, t.sourceListingId, t.cardHash),
    check(
      'selections_source_check',
      sql`${t.source} in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')`,
    ),
    check('selections_reason_check', sql`${t.reason} in ('in_area', 'shipped')`),
    check('selections_card_hash_check', sql`${t.cardHash} ~ '^[0-9a-f]{64}$'`),
  ],
)

// Published view, created by hand-written SQL (migrations/details-selector/*_access.sql). Empty
// while the module's switch is off. Row type: `DetailsSelectorSelection` in
// @nabvy/contracts/modules/details-selector.

/** Internal: every selected card version. */
export const vSelections = schema
  .view('v_selections', {
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    cardHash: text('card_hash').notNull(),
    reason: text('reason').notNull(),
    selectedAt: at('selected_at').notNull(),
  })
  .existing()
