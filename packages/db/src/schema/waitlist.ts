import { sql } from 'drizzle-orm'
import { check, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the waitlist module, all in the Postgres schema 'waitlist' (packages/db/README.md).
// Only services/waitlist writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate waitlist

export const schema = moduleSchema('waitlist')

/**
 * One row per pre-launch sign-up (module card, `docs/marketing.md` "Waitlist before launch").
 * `email` is stored already normalised (trimmed, lower case) by services/waitlist's domain layer;
 * the check constraint is a backstop against a write that skips it. A repeat sign-up with the same
 * address writes no new row (task 0.5a, "Done"): `services/waitlist` upserts on `email` and never
 * overwrites an existing entry's postcode, wanted products or UTM (docs/questions.md, "waitlist:
 * repeat sign-ups").
 */
export const entries = schema.table(
  'entries',
  {
    id: idColumn(),
    email: text('email').notNull().unique(),
    postcode: text('postcode'),
    wantedProducts: text('wanted_products').array(),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),
    utmContent: text('utm_content'),
    ...timestampColumns(),
  },
  (t) => [
    check('waitlist_entries_email_lower', sql`${t.email} = lower(${t.email})`),
    check(
      'waitlist_entries_postcode_format',
      sql`${t.postcode} is null or ${t.postcode} ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-BD-HJLNP-UW-Z]{2}$'`,
    ),
  ],
)

/**
 * A Postgres-backed rate-limit counter for `submit()`, one row per hashed IP, the same window
 * pattern Better Auth's own `rate_limit` table uses (`services/auth/src/auth.ts`,
 * `consumeMagicLinkQuota`). `key` is the hex SHA-256 of the caller's IP address, never the address
 * itself. `window_start` is reset once it is older than the configured window.
 */
export const submissionAttempts = schema.table('submission_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(1),
  windowStart: timestamp('window_start', { withTimezone: true, precision: 3 }).notNull(),
})

/**
 * Internal view: every entry, for the modules the module card lists as depending on waitlist (none
 * yet) and for internal readers. Declared here, created by hand-written SQL. Returns no rows while
 * the `waitlist` switch is off (rule 11 of `_rules.md`).
 */
export const vWaitlist = schema
  .view('v_waitlist', {
    id: uuid('id').notNull(),
    email: text('email').notNull(),
    postcode: text('postcode'),
    wantedProducts: text('wanted_products').array(),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),
    utmContent: text('utm_content'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  })
  .existing()
