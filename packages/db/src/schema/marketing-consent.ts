import { sql } from 'drizzle-orm'
import { boolean, check, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { moduleSchema } from '../module-schema'

// Tables of the marketing-consent module, all in the Postgres schema 'marketing_consent'
// (packages/db/README.md). Only services/marketing-consent writes them. Other modules read
// through v_consents. After changing this file: pnpm db:generate marketing-consent

export const schema = moduleSchema('marketing-consent')

/**
 * One row per (user, category): the preference-centre categories (docs/marketing.md) plus the
 * pseudo-category `all`, this module's own record of a "pause all marketing for 30 days" action
 * (README.md, "Decisions"). `until` is set only on an `all` row, the pause's end time; a real
 * category's row never carries one. No row for a category means "not granted" (docs/marketing.md:
 * "Sign-up shows an unticked box"), so a preference is written only when it changes, never seeded.
 */
export const marketingConsents = schema.table(
  'marketing_consents',
  {
    userId: uuid('user_id').notNull(),
    category: text('category').notNull(),
    granted: boolean('granted').notNull().default(false),
    until: timestamp('until', { withTimezone: true, precision: 3 }),
    source: text('source').notNull(),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'marketing_consents_category',
      sql`${t.category} in ('tips', 'offers', 'product_updates', 'weekly_digest', 'all')`,
    ),
    check(
      'marketing_consents_source',
      sql`${t.source} in ('signup', 'preference-centre', 'admin')`,
    ),
    check(
      'marketing_consents_until_only_on_pause',
      sql`${t.category} = 'all' or ${t.until} is null`,
    ),
    primaryKey({ columns: [t.userId, t.category] }),
  ],
)

/**
 * One row per email address ever reported as bouncing or complaining (or unsubscribed, or
 * manually suppressed): `email_hash` only, never the plain address (docs/marketing.md's own table
 * shape). A repeat report for the same address overwrites the reason, source and time rather than
 * appending a row, so `isSuppressed()` is a single-row lookup.
 */
export const emailSuppressions = schema.table(
  'email_suppressions',
  {
    emailHash: text('email_hash').primaryKey(),
    reason: text('reason').notNull(),
    source: text('source').notNull(),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check('email_suppressions_email_hash_format', sql`${t.emailHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'email_suppressions_reason',
      sql`${t.reason} in ('bounce', 'complaint', 'unsubscribe', 'manual')`,
    ),
    check('email_suppressions_source', sql`${t.source} in ('resend', 'posthog', 'user', 'admin')`),
  ],
)

/**
 * One row per newsletter sign-up (the public daily brief, waitlist and price-page prompts),
 * `email_hash` only (docs/marketing.md's own table shape): the actual send list is the provider's
 * own audience (README.md, "Decisions"), so this table is Nabvy's consent record, not a mailing
 * list to read addresses back out of.
 */
export const newsletterSubscribers = schema.table(
  'newsletter_subscribers',
  {
    emailHash: text('email_hash').primaryKey(),
    consentSource: text('consent_source').notNull(),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true, precision: 3 }),
  },
  (t) => [
    check('newsletter_subscribers_email_hash_format', sql`${t.emailHash} ~ '^[0-9a-f]{64}$'`),
  ],
)

/** Internal: every consent and pause row, for modules that declare marketing-consent as a dependency. */
export const vConsents = schema
  .view('v_consents', {
    userId: uuid('user_id').notNull(),
    category: text('category').notNull(),
    granted: boolean('granted').notNull(),
    until: timestamp('until', { withTimezone: true, precision: 3 }),
    source: text('source').notNull(),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull(),
  })
  .existing()
