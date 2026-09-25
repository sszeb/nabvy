import { sql } from 'drizzle-orm'
import { bigint, check, date, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the listing-feedback module, all in the Postgres schema 'listing_feedback' (packages/
// db/README.md). Only services/listing-feedback writes them. Other modules import only the views
// (v-prefixed exports). After changing this file: pnpm db:generate listing-feedback

export const schema = moduleSchema('listing-feedback')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

// The nil UUID the (user, listing, alert) identity index folds a null alert_id into, so an
// upsert has one conflict target whether or not the feedback came from an alert (services/
// listing-feedback/src/repo/index.ts). Never stored as a real alert_id: the check below refuses
// it.
const NO_ALERT = '00000000-0000-0000-0000-000000000000'

/**
 * One row per (user, listing, alert) verdict (docs/design/modules/listing-feedback.md, "Owns").
 * `alertId` is null when the feedback was not given from an alert. Upserted: the same verdict, or
 * a changed one, for the same identity replaces the row rather than adding another (test/
 * idempotency.test.ts). No price column: a verdict is never a sale price (CLAUDE.md).
 */
export const verdicts = schema.table(
  'verdicts',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    alertId: uuid('alert_id'),
    verdict: text('verdict').notNull(),
    at: at('at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    index('verdicts_user_id_idx').on(t.userId),
    index('verdicts_listing_id_idx').on(t.listingId),
    index('verdicts_alert_id_idx').on(t.alertId),
    uniqueIndex('verdicts_identity_idx').on(
      t.userId,
      t.listingId,
      sql`coalesce(${t.alertId}, '${sql.raw(NO_ALERT)}'::uuid)`,
    ),
    check('verdicts_verdict', sql`${t.verdict} in ('real_deal', 'not_a_deal', 'bought')`),
    check('verdicts_alert_id_not_sentinel', sql`${t.alertId} <> '${sql.raw(NO_ALERT)}'::uuid`),
  ],
)

/**
 * One row per (user, listing) state (docs/design/modules/listing-feedback.md, "Owns"): saved or
 * dismissed. Upserted: setting a new state for the same listing replaces it.
 */
export const listingState = schema.table(
  'listing_state',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    state: text('state').notNull(),
    at: at('at').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    index('listing_state_user_id_idx').on(t.userId),
    index('listing_state_listing_id_idx').on(t.listingId),
    uniqueIndex('listing_state_identity_idx').on(t.userId, t.listingId),
    check('listing_state_state', sql`${t.state} in ('saved', 'dismissed')`),
  ],
)

/** Internal view (row type ListingFeedbackVerdictCount in @nabvy/contracts/modules/listing-feedback). */
export const vVerdictCounts = schema
  .view('v_verdict_counts', {
    alertId: uuid('alert_id'),
    day: date('day', { mode: 'string' }).notNull(),
    verdict: text('verdict').notNull(),
    n: bigint('n', { mode: 'number' }).notNull(),
  })
  .existing()

/** Internal view, granted only to seller-reply-reports (row type ListingFeedbackBoughtForReport). */
export const vBoughtForReports = schema
  .view('v_bought_for_reports', {
    userId: uuid('user_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    at: at('at').notNull(),
  })
  .existing()

/** User-facing view: the caller's own feedback (row type ListingFeedbackMine). */
export const vListingFeedbackMine = schema
  .view('v_listing_feedback_mine', {
    listingId: uuid('listing_id').notNull(),
    alertId: uuid('alert_id'),
    verdict: text('verdict'),
    state: text('state'),
    at: at('at').notNull(),
  })
  .existing()
