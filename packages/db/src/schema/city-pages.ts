import { sql } from 'drizzle-orm'
import { boolean, check, doublePrecision, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { moduleSchema, timestampColumns } from '../module-schema'

// Tables of the city-pages module, all in the Postgres schema 'city_pages' (packages/db/README.md).
// Only services/city-pages writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate city-pages

export const schema = moduleSchema('city-pages')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Every Facebook city page known: from the seed (`city-pages.seed.json`, 771 rows) or added when
 * first seen on a card. Keyed on the numeric city-page ID, kept as text
 * (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-38). Never parses names or town slugs: `name` and
 * `towns` are exactly the labels the source gave.
 */
export const cityPages = schema.table(
  'city_pages',
  {
    cityPageId: text('city_page_id').primaryKey(),
    name: text('name').notNull(),
    towns: text('towns').array().notNull().default(sql`'{}'::text[]`),
    /** Town-level approximation; null for a card-added page and for the seed's verified centres. */
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    coordSource: text('coord_source').notNull(),
    firstSeenAt: at('first_seen_at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    check('city_pages_coord_source_check', sql`${t.coordSource} in ('seed', 'card')`),
    check(
      'city_pages_coords_check',
      sql`(${t.lat} is null) = (${t.lng} is null)
        and (${t.lat} is null or ${t.lat} between -90 and 90)
        and (${t.lng} is null or ${t.lng} between -180 and 180)`,
    ),
  ],
)

/**
 * A city page that is, or could be, a search centre: chosen for the national grid at seed time, or
 * added on demand the first time a hunt needs one (docs/decisions.md:137). `verified` is set only
 * once a qualifying newest-first page-1 run has bound it; until then `reportedLat`/`reportedLng`
 * are null and area membership falls back to the city page's own seed coordinate, if it has one.
 */
export const centres = schema.table(
  'centres',
  {
    cityPageId: text('city_page_id')
      .primaryKey()
      .references(() => cityPages.cityPageId),
    active: boolean('active').notNull().default(false),
    verified: boolean('verified').notNull().default(false),
    verifiedByJob: integer('verified_by_job'),
    country: text('country').notNull(),
    currency: text('currency').notNull(),
    /** Facebook's own reported centre from `run_coverage.v_search_controls`, set on verification. */
    reportedLat: doublePrecision('reported_lat'),
    reportedLng: doublePrecision('reported_lng'),
    areaKm: doublePrecision('area_km').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    check('centres_country_check', sql`${t.country} in ('GB', 'IE')`),
    check('centres_currency_check', sql`${t.currency} in ('GBP', 'EUR')`),
    check('centres_area_km_check', sql`${t.areaKm} > 0`),
    check('centres_verified_job_check', sql`${t.verified} or ${t.verifiedByJob} is null`),
    check(
      'centres_reported_coords_check',
      sql`(${t.reportedLat} is null) = (${t.reportedLng} is null)
        and (${t.reportedLat} is null or ${t.reportedLat} between -90 and 90)
        and (${t.reportedLng} is null or ${t.reportedLng} between -180 and 180)`,
    ),
  ],
)

// Published views, created by hand-written SQL (migrations/city-pages/*_access.sql). Empty while
// the module's switch is off. Row types: `CityPagesCityPage`, `CityPagesCentre` and
// `CityPagesAreaMembership` in @nabvy/contracts/modules/city-pages.

/** Internal: every Facebook city page known, seed or card-added. */
export const vCityPages = schema
  .view('v_city_pages', {
    cityPageId: text('city_page_id').notNull(),
    name: text('name').notNull(),
    towns: text('towns').array().notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    coordSource: text('coord_source').notNull(),
    firstSeenAt: at('first_seen_at').notNull(),
  })
  .existing()

/** Internal: every candidate or verified search centre. */
export const vCentres = schema
  .view('v_centres', {
    cityPageId: text('city_page_id').notNull(),
    active: boolean('active').notNull(),
    verified: boolean('verified').notNull(),
    verifiedByJob: integer('verified_by_job'),
    country: text('country').notNull(),
    currency: text('currency').notNull(),
    reportedLat: doublePrecision('reported_lat'),
    reportedLng: doublePrecision('reported_lng'),
    areaKm: doublePrecision('area_km').notNull(),
  })
  .existing()

/** Internal: each city page's nearest active centre with a known coordinate, and its distance. */
export const vAreaMembership = schema
  .view('v_area_membership', {
    cityPageId: text('city_page_id').notNull(),
    centreId: text('centre_id'),
    distanceKm: doublePrecision('distance_km'),
    inArea: boolean('in_area').notNull(),
  })
  .existing()
