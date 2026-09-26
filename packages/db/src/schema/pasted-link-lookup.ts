import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the pasted-link-lookup module, all in the Postgres schema 'pasted_link_lookup'
// (packages/db/README.md). Only services/pasted-link-lookup writes them. Other modules import
// only the views (v-prefixed exports). After changing this file: pnpm db:generate pasted-link-lookup

export const schema = moduleSchema('pasted-link-lookup')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * One row per (user, source, listing) request (docs/design/modules/pasted-link-lookup.md,
 * "Owns"). The web app inserts it inside withUser (`queued`, or `ready` at once when the card is
 * already visible with details); the settle tick, as the pipeline, moves it to `ready` or
 * `failed`. `requestedAt` defaults to server time and the access migration's restrictive policy
 * refuses any other value from the app. `listingId` is listing-ingest's ID once the listing is
 * visible on `app.v_listing_card`, held as a plain value (rule 4: no cross-schema foreign key).
 * `outcome` is why a request failed (`expired`, `fetch-failed`); never shown to users.
 */
export const requests = schema.table(
  'requests',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    listingId: uuid('listing_id'),
    status: text('status').notNull(),
    outcome: text('outcome'),
    requestedAt: at('requested_at').notNull().defaultNow(),
    readyAt: at('ready_at'),
    ...timestampColumns(),
  },
  (t) => [
    index('requests_user_id_idx').on(t.userId),
    index('requests_status_requested_at_idx').on(t.status, t.requestedAt),
    index('requests_source_listing_idx').on(t.source, t.sourceListingId),
    uniqueIndex('requests_identity_idx').on(t.userId, t.source, t.sourceListingId),
    check('requests_source', sql`${t.source} in ('facebook')`),
    check('requests_source_listing_id', sql`${t.sourceListingId} ~ '^[0-9]{1,30}$'`),
    check('requests_status', sql`${t.status} in ('queued', 'ready', 'failed')`),
    check('requests_ready_at', sql`(${t.status} = 'ready') = (${t.readyAt} is not null)`),
    check('requests_outcome', sql`(${t.status} = 'failed') = (${t.outcome} is not null)`),
  ],
)

/** Internal view (row type PastedLinkLookupRequestCount in @nabvy/contracts/modules/pasted-link-lookup). */
export const vRequestCounts = schema
  .view('v_request_counts', {
    userId: uuid('user_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    n: bigint('n', { mode: 'number' }).notNull(),
  })
  .existing()

// The shared web-app schema listing-card creates (packages/db/src/schema/listing-card.ts).
// Declared `.existing()` here so this module's TypeScript can reference its own user-facing view;
// the view itself comes from this module's access migration.
const app = pgSchema('app')

/** User-facing view: the caller's own requests (row type PastedLinkLookupRequest). */
export const vPastedLinkLookupRequests = app
  .view('v_pasted_link_lookup_requests', {
    requestId: uuid('request_id').notNull(),
    source: text('source').notNull(),
    sourceListingId: text('source_listing_id').notNull(),
    listingId: uuid('listing_id'),
    status: text('status').notNull(),
    requestedAt: at('requested_at').notNull(),
    readyAt: at('ready_at'),
  })
  .existing()
