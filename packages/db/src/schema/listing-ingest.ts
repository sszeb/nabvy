import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the listing-ingest module, all in the Postgres schema 'listing_ingest' (packages/db/README.md).
// Only services/listing-ingest writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate listing-ingest

export const schema = moduleSchema('listing-ingest')

const at = (name: string) => timestamp(name, { withTimezone: true })
const minor = (name: string) => bigint(name, { mode: 'number' })

/**
 * One listing identity per `(source, source_listing_id)`, with the card's current values (fresh
 * card fields win). The raw row stays in apify-gateway and is referenced by `item_job_id` and
 * `item_seq` (a `raw_…` column would fail the foundation's view check).
 */
export const listings = schema.table(
  'listings',
  {
    id: idColumn(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    cardHash: text('card_hash').notNull(),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    moneyKind: text('money_kind'),
    title: text('title').notNull(),
    listedAt: at('listed_at'),
    firstFetchedAt: at('first_fetched_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    cityPageId: text('city_page_id'),
    townLabel: text('town_label'),
    availability: text('availability').notNull(),
    categoryId: text('category_id'),
    deliveryTypes: text('delivery_types').array().notNull().default(sql`'{}'::text[]`),
    primaryPhotoId: text('primary_photo_id'),
    displayedPreviousMinor: minor('displayed_previous_minor'),
    binding: text('binding'),
    foundByTerms: text('found_by_terms').array().notNull().default(sql`'{}'::text[]`),
    itemJobId: integer('item_job_id').notNull(),
    itemSeq: integer('item_seq').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('listings_source_listing_key').on(t.source, t.sourceListingId),
    index('listings_city_page_idx').on(t.cityPageId),
    check(
      'listings_source_check',
      sql`${t.source} in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')`,
    ),
    check('listings_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
    check('listings_price_check', sql`${t.priceMinor} >= 0 and ${t.displayedPreviousMinor} >= 0`),
    check(
      'listings_availability_check',
      sql`${t.availability} in ('live', 'pending', 'sold', 'hidden', 'unknown')`,
    ),
    check('listings_card_hash_check', sql`${t.cardHash} ~ '^[0-9a-f]{64}$'`),
  ],
)

/**
 * One light row per card per run: kind `search` for a feed appearance, `detail` for a paid
 * details refresh (never a feed sighting). Price and availability are kept on the row so
 * `v_price_changes` can compare observations within one listing.
 */
export const sightings = schema.table(
  'sightings',
  {
    id: idColumn(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    term: text('term'),
    centreId: text('centre_id'),
    rank: integer('rank'),
    cardHash: text('card_hash').notNull(),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    availability: text('availability').notNull(),
    seenAt: at('seen_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('sightings_listing_job_kind_key').on(t.listingId, t.jobId, t.kind),
    index('sightings_listing_seen_idx').on(t.listingId, t.seenAt),
    index('sightings_job_idx').on(t.jobId),
    check('sightings_kind_check', sql`${t.kind} in ('search', 'detail')`),
    check('sightings_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
    check('sightings_price_check', sql`${t.priceMinor} >= 0`),
    check('sightings_rank_check', sql`${t.rank} >= 1`),
    check(
      'sightings_availability_check',
      sql`${t.availability} in ('live', 'pending', 'sold', 'hidden', 'unknown')`,
    ),
  ],
)

// Published views, created by hand-written SQL (migrations/listing-ingest/*_access.sql). Empty
// while the module's switch is off. Row types: `ListingIngestListing`, `ListingIngestSighting`
// and `ListingIngestPriceChange` in @nabvy/contracts/modules/listing-ingest.

/** Internal: every listing identity with its current card values. */
export const vListings = schema
  .view('v_listings', {
    id: uuid('id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    cardHash: text('card_hash').notNull(),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    moneyKind: text('money_kind'),
    title: text('title').notNull(),
    listedAt: at('listed_at'),
    firstFetchedAt: at('first_fetched_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    cityPageId: text('city_page_id'),
    townLabel: text('town_label'),
    availability: text('availability').notNull(),
    categoryId: text('category_id'),
    deliveryTypes: text('delivery_types').array().notNull(),
    primaryPhotoId: text('primary_photo_id'),
    displayedPreviousMinor: minor('displayed_previous_minor'),
    binding: text('binding'),
    foundByTerms: text('found_by_terms').array().notNull(),
    itemJobId: integer('item_job_id').notNull(),
    itemSeq: integer('item_seq').notNull(),
  })
  .existing()

/** Internal: every observation. Coverage and page-1 overlap read kind `search` only. */
export const vSightings = schema
  .view('v_sightings', {
    id: uuid('id').notNull(),
    listingId: uuid('listing_id').notNull(),
    jobId: integer('job_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    term: text('term'),
    centreId: text('centre_id'),
    rank: integer('rank'),
    cardHash: text('card_hash').notNull(),
    priceMinor: minor('price_minor'),
    currency: text('currency'),
    availability: text('availability').notNull(),
    seenAt: at('seen_at').notNull(),
  })
  .existing()

/** Internal: consecutive observations of one listing ID at different prices, same currency. */
export const vPriceChanges = schema
  .view('v_price_changes', {
    listingId: uuid('listing_id').notNull(),
    sightingId: uuid('sighting_id').notNull(),
    kind: text('kind').notNull(),
    previousMinor: minor('previous_minor').notNull(),
    priceMinor: minor('price_minor').notNull(),
    currency: text('currency').notNull(),
    previousSeenAt: at('previous_seen_at').notNull(),
    seenAt: at('seen_at').notNull(),
  })
  .existing()

/** Internal: each Facebook city page listings were placed in, with a town label and counts. */
export const vCityPagesSeen = schema
  .view('v_city_pages_seen', {
    cityPageId: text('city_page_id').notNull(),
    townLabel: text('town_label'),
    listings: integer('listings').notNull(),
    firstSeenAt: at('first_seen_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
  })
  .existing()

/** Internal: hash of normalised title, price and city page, for listing-suppression only. */
export const vFingerprints = schema
  .view('v_fingerprints', {
    listingId: uuid('listing_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
  })
  .existing()
