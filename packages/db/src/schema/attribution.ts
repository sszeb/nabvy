import { sql } from 'drizzle-orm'
import { check, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the attribution module, all in the Postgres schema 'attribution' (packages/db/README.md).
// Only services/attribution writes them. Other modules read v_attributions.
// After changing this file: pnpm db:generate attribution
//
// Two kinds of "referred" (services/attribution/README.md, "Decisions"), never mixed: a peer's own
// code (referral_codes / referrals: give-£5-get-£5, usage-ledger only) and a Dub partner link or
// creator code (the affiliate_* columns on utm_attributions: a Dub-tracked cash commission,
// recorded in partner_events).

export const schema = moduleSchema('attribution')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/** One row per user, written once at sign-up. UTM tags and Dub's click/creator code and partner. */
export const utmAttributions = schema.table('utm_attributions', {
  userId: uuid('user_id').primaryKey(),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmContent: text('utm_content'),
  utmTerm: text('utm_term'),
  /** Dub's first-party click cookie, read at sign-up. */
  affiliateClickId: text('affiliate_click_id'),
  /** A creator's code typed with no click. */
  affiliateCode: text('affiliate_code'),
  /** From Dub's track-lead response, once known. */
  affiliatePartnerId: text('affiliate_partner_id'),
  ...timestampColumns(),
})

/** Each user's own shareable code, issued once at sign-up capture. */
export const referralCodes = schema.table(
  'referral_codes',
  {
    userId: uuid('user_id').primaryKey(),
    code: text('code').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('referral_codes_code_key').on(t.code)],
)

/**
 * A peer referral pair, one row per referred user (one referrer each). `creditedAt` is set once,
 * when the referred user's first paid subscription invoice credits both sides.
 */
export const referrals = schema.table(
  'referrals',
  {
    id: idColumn(),
    referrerUserId: uuid('referrer_user_id').notNull(),
    referredUserId: uuid('referred_user_id').notNull(),
    /** The code used, kept even if the referrer later changes it. */
    code: text('code').notNull(),
    referredAt: at('referred_at').notNull().defaultNow(),
    creditedAt: at('credited_at'),
  },
  (t) => [
    uniqueIndex('referrals_referred_user_id_key').on(t.referredUserId),
    index('referrals_referrer_user_id_idx').on(t.referrerUserId),
    check('referrals_not_self', sql`${t.referrerUserId} <> ${t.referredUserId}`),
  ],
)

/**
 * Every call to the partner platform (lead, sale, reversal), with its response, for idempotency
 * and audit (affiliates.md, "Tables and fields": billing_events rows for every track-sale and
 * refund call with Dub's response — this module's own table for that). Append-only.
 */
export const partnerEvents = schema.table(
  'partner_events',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    /** The Stripe invoice ID (sale), the Stripe dispute/refund event ID (reversal), or `signup`. */
    refId: text('ref_id').notNull(),
    partnerId: text('partner_id'),
    amountMinor: integer('amount_minor'),
    currency: text('currency'),
    reason: text('reason'),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('partner_events_user_id_kind_ref_id_key').on(t.userId, t.kind, t.refId),
    index('partner_events_user_id_at_idx').on(t.userId, t.at),
    check('partner_events_kind', sql`${t.kind} in ('lead', 'sale', 'reversal')`),
    check(
      'partner_events_reason',
      sql`${t.reason} is null or (${t.kind} = 'reversal' and ${t.reason} in ('chargeback', 'refund'))`,
    ),
    check('partner_events_currency', sql`${t.currency} is null or ${t.currency} = 'GBP'`),
    check('partner_events_amount', sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
  ],
)

/**
 * Internal: one row per user who has been captured, for modules that declare `attribution` as a
 * dependency (`lifecycle-messaging`, `search-planner`: docs/design/pricing-model.md, "Fill areas").
 * Rows only while the module is not off (rule 11).
 */
export const vAttributions = schema
  .view('v_attributions', {
    userId: uuid('user_id').notNull(),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),
    affiliateClickId: text('affiliate_click_id'),
    affiliateCode: text('affiliate_code'),
    affiliatePartnerId: text('affiliate_partner_id'),
    referralCode: text('referral_code').notNull(),
    referredBy: uuid('referred_by'),
    referredAt: at('referred_at'),
    creditedAt: at('credited_at'),
    capturedAt: at('captured_at').notNull(),
  })
  .existing()
