import { sql } from 'drizzle-orm'
import { check, doublePrecision, text, timestamp } from 'drizzle-orm/pg-core'
import { moduleSchema, timestampColumns } from '../module-schema'

// Tables of the location module, all in the Postgres schema 'location' (packages/db/README.md).
// Only services/location writes them. This module publishes no views (README.md, "Outputs"):
// pointForPostcode(), distanceKm() and townLabel() from '@nabvy/location' are the only way
// anything reads or derives this data. After changing this file: pnpm db:generate location

export const schema = moduleSchema('location')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * One row per postcode ever resolved, kept forever: a postcode's coordinate does not move
 * (services/location/README.md, "Owned tables"). `postcode` is normalised (upper case, one space
 * before the inward code; src/domain's `normalizePostcode`) so the same postcode always hits the
 * same row, from the web app (a user's own postcode) or the pipeline (notifier) alike.
 */
export const postcodeCache = schema.table(
  'postcode_cache',
  {
    postcode: text('postcode').primaryKey(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    fetchedAt: at('fetched_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    check('postcode_cache_lat_check', sql`${t.lat} between -90 and 90`),
    check('postcode_cache_lng_check', sql`${t.lng} between -180 and 180`),
  ],
)
