import { sql } from 'drizzle-orm'
import { check, index, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the listing-suppression module, all in the Postgres schema 'listing_suppression' (packages/db/README.md).
// Only services/listing-suppression writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate listing-suppression

export const schema = moduleSchema('listing-suppression')

const at = (name: string) => timestamp(name, { withTimezone: true })

/**
 * The suppression list. Every value is a hash: of a named listing ID, a seller key from
 * `seller-key`, or a look-alike fingerprint. Never a raw listing or seller ID, a seller name or a
 * profile link. Rows are never updated or deleted (the card: "It deletes nothing"); a look-alike
 * entry stops matching at `expires_at`.
 */
export const entries = schema.table(
  'entries',
  {
    id: idColumn(),
    kind: text('kind').notNull(),
    basis: text('basis'),
    value: text('value').notNull(),
    expiresAt: at('expires_at'),
    requestId: uuid('request_id').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    unique('entries_request_value_key').on(t.requestId, t.kind, t.value),
    index('entries_kind_value_idx').on(t.kind, t.value),
    check('entries_kind_check', sql`${t.kind} in ('listing_hash', 'seller_key', 'lookalike')`),
    check('entries_value_check', sql`${t.value} ~ '^[0-9a-f]{64}$'`),
    check(
      'entries_lookalike_check',
      sql`(${t.kind} = 'lookalike') = (${t.basis} is not null and ${t.expiresAt} is not null)`,
    ),
    check('entries_basis_check', sql`${t.basis} in ('description', 'card')`),
  ],
)

/** Internal: the listings the list hides now, with the reason and the end (null: no end). */
export const vSuppressed = schema
  .view('v_suppressed', {
    listingId: uuid('listing_id').notNull(),
    reason: text('reason').notNull(),
    until: at('until'),
  })
  .existing()
