import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema } from '../module-schema'

// Tables of the usage-ledger module, all in the Postgres schema 'usage_ledger'
// (packages/db/README.md). Only services/usage-ledger writes them. Other modules read v_balances.
// After changing this file: pnpm db:generate usage-ledger
//
// Integers only: credits are `integer`, cash is integer pence, cost is integer GBP micros.
// `entries` is the append-only ledger (the card's `usage_ledger`); `buckets` is the materialised
// balance per grant (the card's `usage_balances`); `allocations` records which buckets each
// charge, reversal or expiry moved, so a reversal returns credit to exactly the buckets its
// charge drew from. Nobody updates `buckets` directly: a trigger on `allocations` applies each
// row (usage_ledger_access migration), and a deferred trigger checks at commit that an entry's
// allocations add up to its credits.

export const schema = moduleSchema('usage-ledger')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })
const gbpMicros = (name: string) => bigint(name, { mode: 'number' })

/** One row per grant, charge, reversal or expiry. Unique on (user, kind, refId): idempotency. */
export const entries = schema.table(
  'entries',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    /** Signed: grants and reversals add, charges and expiries take. */
    credits: integer('credits').notNull(),
    action: text('action'),
    refId: text('ref_id').notNull(),
    /** A reversal's charge. */
    reversesId: uuid('reverses_id'),
    cashMinor: integer('cash_minor').notNull().default(0),
    costGbpMicros: gbpMicros('cost_gbp_micros').notNull().default(0),
    expiresAt: at('expires_at'),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('entries_user_id_kind_ref_id_key').on(t.userId, t.kind, t.refId),
    uniqueIndex('entries_reverses_id_key').on(t.reversesId),
    index('entries_user_id_at_idx').on(t.userId, t.at),
    check(
      'entries_kind',
      sql`${t.kind} in ('allowance', 'taste', 'referral', 'topup', 'charge', 'reversal', 'expiry')`,
    ),
    check(
      'entries_credits_sign',
      sql`case when ${t.kind} in ('allowance', 'taste', 'referral', 'topup') then ${t.credits} > 0
               when ${t.kind} = 'charge' then ${t.credits} <= 0
               when ${t.kind} = 'reversal' then ${t.credits} >= 0
               else ${t.credits} < 0 end`,
    ),
    check('entries_action', sql`(${t.kind} = 'charge') = (${t.action} is not null)`),
    check('entries_reverses', sql`(${t.kind} = 'reversal') = (${t.reversesId} is not null)`),
    check(
      'entries_cash',
      sql`${t.cashMinor} >= 0 and (${t.cashMinor} = 0 or ${t.kind} in ('allowance', 'topup'))`,
    ),
    check(
      'entries_cost',
      sql`${t.costGbpMicros} >= 0 and (${t.costGbpMicros} = 0 or ${t.kind} = 'charge')`,
    ),
    check(
      'entries_expires',
      sql`${t.expiresAt} is null or ${t.kind} in ('allowance', 'taste', 'referral', 'topup')`,
    ),
    check(
      'entries_expiring_kinds',
      sql`${t.kind} not in ('allowance', 'taste') or ${t.expiresAt} is not null`,
    ),
  ],
)

/** One bucket per grant: what is left of it. Created and updated only by triggers. */
export const buckets = schema.table(
  'buckets',
  {
    /** The grant entry's id. */
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    /** Spend order: 1 allowance, 2 taste and referral, 3 top-ups. */
    rank: smallint('rank').notNull(),
    credits: integer('credits').notNull(),
    remaining: integer('remaining').notNull(),
    cashMinor: integer('cash_minor').notNull(),
    expiresAt: at('expires_at'),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('buckets_user_id_spend_order_idx').on(t.userId, t.rank, t.expiresAt, t.createdAt, t.id),
    check('buckets_remaining', sql`${t.remaining} between 0 and ${t.credits}`),
    check(
      'buckets_rank',
      sql`${t.rank} = case ${t.kind} when 'allowance' then 1 when 'topup' then 3 else 2 end`,
    ),
  ],
)

/** Which buckets an entry moved, and by how much (signed like the entry). */
export const allocations = schema.table(
  'allocations',
  {
    entryId: uuid('entry_id').notNull(),
    bucketId: uuid('bucket_id').notNull(),
    userId: uuid('user_id').notNull(),
    credits: integer('credits').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.bucketId] }),
    index('allocations_bucket_id_idx').on(t.bucketId),
    index('allocations_user_id_idx').on(t.userId),
    check('allocations_credits', sql`${t.credits} <> 0`),
  ],
)

/**
 * Internal: each user's balance now (expired buckets count nothing) and the provider and model
 * cost their charges caused, for `subscriptions`, `lifecycle-messaging` and the free-tier
 * lifetime cap (backlog 4.9a). Rows only while the module is not off (rule 11).
 */
export const vBalances = schema
  .view('v_balances', {
    userId: uuid('user_id').notNull(),
    credits: integer('credits').notNull(),
    allowanceCredits: integer('allowance_credits').notNull(),
    tasteReferralCredits: integer('taste_referral_credits').notNull(),
    topupCredits: integer('topup_credits').notNull(),
    fundingCredits: integer('funding_credits').notNull(),
    nextExpiryAt: at('next_expiry_at'),
    attributedCostGbpMicros: gbpMicros('attributed_cost_gbp_micros').notNull(),
  })
  .existing()
