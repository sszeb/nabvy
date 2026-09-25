import { sql } from 'drizzle-orm'
import { bigint, check, date, index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the inventory module, all in the Postgres schema 'inventory' (packages/db/README.md).
// Only services/inventory writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate inventory

export const schema = moduleSchema('inventory')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })
const minor = (name: string) => bigint(name, { mode: 'number' })
const day = (name: string) => date(name, { mode: 'string' })

/** The bounds of @nabvy/contracts/modules/inventory, repeated as check constraints. */
const MAX_AMOUNT_MINOR = 100_000_000
const EARLIEST_DATE = '2000-01-01'

/**
 * One row per item the user bought (docs/design/modules/inventory.md, "Owns"). Every amount and
 * date is what the user entered; the module never estimates one (CLAUDE.md, "No invented
 * numbers"). `id` is the client's item ID (a resubmitted form is the same item). `sourceListingId`
 * and `scanId` are other modules' IDs held as plain values (rule 4: no cross-schema foreign key).
 * The sale columns are set together, or all null; `soldRecordedAt` is server time.
 */
export const items = schema.table(
  'items',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    productKey: text('product_key'),
    sourceListingId: uuid('source_listing_id'),
    scanId: uuid('scan_id'),
    currency: text('currency').notNull(),
    costMinor: minor('cost_minor').notNull(),
    boughtAt: day('bought_at').notNull(),
    soldMinor: minor('sold_minor'),
    soldAt: day('sold_at'),
    soldOn: text('sold_on'),
    soldRecordedAt: at('sold_recorded_at'),
    ...timestampColumns(),
  },
  (t) => [
    index('items_user_id_idx').on(t.userId),
    index('items_source_listing_id_idx').on(t.sourceListingId),
    index('items_scan_id_idx').on(t.scanId),
    check(
      'items_names_something',
      sql`${t.productKey} is not null or ${t.sourceListingId} is not null or ${t.scanId} is not null`,
    ),
    check(
      'items_product_key',
      sql`${t.productKey} is null or (length(${t.productKey}) <= 200 and ${t.productKey} ~ '^[a-z0-9-]+(:[a-z0-9-]+)+$')`,
    ),
    check('items_currency', sql`${t.currency} in ('GBP', 'EUR')`),
    check(
      'items_cost_minor',
      sql`${t.costMinor} between 0 and ${sql.raw(String(MAX_AMOUNT_MINOR))}`,
    ),
    check(
      'items_sold_minor',
      sql`${t.soldMinor} is null or ${t.soldMinor} between 0 and ${sql.raw(String(MAX_AMOUNT_MINOR))}`,
    ),
    check('items_bought_at', sql`${t.boughtAt} >= '${sql.raw(EARLIEST_DATE)}'::date`),
    check(
      'items_sale_together',
      sql`(${t.soldMinor} is null) = (${t.soldAt} is null) and (${t.soldMinor} is null) = (${t.soldRecordedAt} is null)`,
    ),
    check('items_sold_after_bought', sql`${t.soldAt} is null or ${t.soldAt} >= ${t.boughtAt}`),
    check(
      'items_sold_on',
      sql`${t.soldOn} is null or (${t.soldMinor} is not null and ${t.soldOn} in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex'))`,
    ),
  ],
)

/** Internal view (row type InventoryItemInternal in @nabvy/contracts/modules/inventory). */
export const vItems = schema
  .view('v_items', {
    id: uuid('id').notNull(),
    userId: uuid('user_id').notNull(),
    productKey: text('product_key'),
    currency: text('currency').notNull(),
    costMinor: minor('cost_minor').notNull(),
    boughtAt: day('bought_at').notNull(),
    soldMinor: minor('sold_minor'),
    soldAt: day('sold_at'),
    soldOn: text('sold_on'),
    soldRecordedAt: at('sold_recorded_at'),
  })
  .existing()

// The shared web-app schema, created by listing-card's migration. Declared `.existing()` so this
// module's TypeScript can read the view; the view itself comes from migrations/inventory/*_access.sql.
const app = pgSchema('app')

/** User-facing view: the caller's own items (row type InventoryItem). */
export const vInventoryItems = app
  .view('v_inventory_items', {
    id: uuid('id').notNull(),
    productKey: text('product_key'),
    sourceListingId: uuid('source_listing_id'),
    scanId: uuid('scan_id'),
    currency: text('currency').notNull(),
    costMinor: minor('cost_minor').notNull(),
    boughtAt: day('bought_at').notNull(),
    soldMinor: minor('sold_minor'),
    soldAt: day('sold_at'),
    soldOn: text('sold_on'),
    profitMinor: minor('profit_minor'),
  })
  .existing()
