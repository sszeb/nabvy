import { bigint, boolean, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { moduleSchema } from '../module-schema'

// listing-card owns no tables (module card, "Owns: none"): its only output is the user-facing
// view app.v_listing_card, created by hand-written SQL
// (migrations/listing-card/20260925121238_listing_card_access.sql). `schema` is exported for
// convention (docs/design/modules/_rules.md rule 2) but declares nothing.
export const schema = moduleSchema('listing-card')

const at = (name: string) => timestamp(name, { withTimezone: true })
const minor = (name: string) => bigint(name, { mode: 'number' })

// The shared web-app schema listing-card creates. Declared `.existing()` here purely so this
// module's own TypeScript can reference the view's shape; the schema and view themselves come
// from the migration above, not from this file (`pnpm db:generate` never touches it: there is no
// table to diff).
const app = pgSchema('app')

/** User-facing: one row per visible listing, exactly the columns the module card allows. */
export const vListingCard = app
  .view('v_listing_card', {
    listingId: uuid('listing_id').notNull(),
    link: text('link'),
    title: text('title'),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    listedAt: at('listed_at'),
    townLabel: text('town_label'),
    condition: text('condition'),
    availability: text('availability').notNull(),
    descriptionStatus: text('description_status'),
    possiblyOutdated: boolean('possibly_outdated').notNull(),
  })
  .existing()
