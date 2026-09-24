import { sql } from 'drizzle-orm'
import { check, index, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the relist-merge module, all in the Postgres schema 'relist_merge' (packages/db/README.md).
// Only services/relist-merge writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate relist-merge

export const schema = moduleSchema('relist-merge')

const at = (name: string) => timestamp(name, { withTimezone: true })

/** One row per relist group: the same item under two or more listing IDs. Internal only. */
export const groups = schema.table('groups', {
  id: idColumn(),
  ...timestampColumns(),
})

/**
 * One row per listing in a group; a listing is in at most one group and is never moved. Listing
 * IDs are listing-ingest's, held as plain values (rule 4). No seller field and no seller key: the
 * key only breaks ties and blocks merges in memory, and is never stored here.
 */
export const members = schema.table(
  'members',
  {
    id: idColumn(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').notNull(),
    basis: text('basis').notNull(),
    matchedListingId: uuid('matched_listing_id'),
    inputFetchedAt: at('input_fetched_at').notNull(),
    mergedAt: at('merged_at').notNull().defaultNow(),
    ...timestampColumns(),
  },
  (t) => [
    unique('members_listing_key').on(t.listingId),
    index('members_group_idx').on(t.groupId),
    check('members_basis_check', sql`${t.basis} in ('origin', 'description', 'photo')`),
    check('members_matched_check', sql`(${t.basis} = 'origin') = (${t.matchedListingId} is null)`),
    check('members_not_self_check', sql`${t.matchedListingId} <> ${t.listingId}`),
  ],
)

// Published view, created by hand-written SQL (migrations/relist-merge/*_access.sql). Empty while
// the module's switch is off. Row type: `RelistMergeGroup` in @nabvy/contracts/modules/relist-merge.

/** Internal: every member of every group, with the group's creation time. */
export const vGroups = schema
  .view('v_groups', {
    groupId: uuid('group_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    basis: text('basis').notNull(),
    matchedListingId: uuid('matched_listing_id'),
    inputFetchedAt: at('input_fetched_at').notNull(),
    mergedAt: at('merged_at').notNull(),
    groupCreatedAt: at('group_created_at').notNull(),
  })
  .existing()
