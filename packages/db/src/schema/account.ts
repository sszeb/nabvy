import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the account module, all in the Postgres schema 'account' (packages/db/README.md).
// Only services/account writes them. Other modules read through v_profiles, v_channels and
// v_standing. After changing this file: pnpm db:generate account

export const schema = moduleSchema('account')

/** One row per user. Referral and affiliate fields belong to `attribution`, not here (card). */
export const userProfiles = schema.table('user_profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  analyticsConsent: boolean('analytics_consent').notNull().default(false),
  designPartner: boolean('design_partner').notNull().default(false),
  ...timestampColumns(),
})

/** A confirmed Telegram link: one chat per user, one user per chat. */
export const telegramLinks = schema.table(
  'telegram_links',
  {
    userId: uuid('user_id').primaryKey(),
    chatId: text('chat_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 3 }),
  },
  (t) => [
    // Partial unique index: a revoked link frees the chat id for a future link.
    index('telegram_links_chat_id_active_idx').on(t.chatId).where(sql`${t.revokedAt} is null`),
  ],
)

/**
 * A pending single-use link code (10-minute TTL, packages/config/src/modules/account.ts), created
 * only from an established device (README.md, "Telegram and push binding"). One row per issued
 * code; `usedAt` is set once, and `linkCode` inserts a fresh row per attempt rather than reusing
 * one, so the re-link cap (per plan) is a count of rows in a window, not a single counter.
 */
export const telegramLinkCodes = schema.table(
  'telegram_link_codes',
  {
    code: text('code').primaryKey(),
    userId: uuid('user_id').notNull(),
    sessionId: text('session_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, precision: 3 }),
  },
  (t) => [
    index('telegram_link_codes_user_id_created_at_idx').on(t.userId, t.createdAt),
    check('telegram_link_codes_code_format', sql`${t.code} ~ '^[A-HJ-NP-Z2-9]{8}$'`),
  ],
)

/** A push subscription, one per device per user (card: "each carrying device_id/session_id"). */
export const pushSubscriptions = schema.table(
  'push_subscriptions',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    sessionId: text('session_id').notNull(),
    endpoint: text('endpoint').notNull(),
    keys: jsonb('keys').notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true, precision: 3 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 3 }),
    ...timestampColumns(),
  },
  (t) => [uniqueIndex('push_subscriptions_user_id_device_id_key').on(t.userId, t.deviceId)],
)

/** A user's own request to delete their account; purged within 24 hours (docs/security.md:11). */
export const deletionRequests = schema.table('deletion_requests', {
  userId: uuid('user_id').primaryKey(),
  requestedAt: timestamp('requested_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  purgeBy: timestamp('purge_by', { withTimezone: true, precision: 3 }).notNull(),
  purgedAt: timestamp('purged_at', { withTimezone: true, precision: 3 }),
})

/** A hashed API key (5.4a, after the MVP); scaffolded now so the table shape is settled. */
export const apiKeys = schema.table(
  'api_keys',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    hashedKey: text('hashed_key').notNull(),
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, precision: 3 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 3 }),
  },
  (t) => [index('api_keys_user_id_idx').on(t.userId)],
)

/**
 * Fair-use limits and the status record `setStanding()` writes alongside `auth`'s own restriction
 * fields (services/account/README.md, "Standing"). `auth.better_auth.user` (`banned`,
 * `ban_expires`, `restriction_policy`) stays the one gate every signed-in request checks; this
 * table is never read for that gate (`isActive()` calls `@nabvy/auth`'s `isAccountActive`
 * directly), only for the richer record `v_standing` publishes.
 */
export const standing = schema.table(
  'standing',
  {
    userId: uuid('user_id').primaryKey(),
    status: text('status').notNull().default('active'),
    until: timestamp('until', { withTimezone: true, precision: 3 }),
    limits: jsonb('limits'),
    actionId: uuid('action_id'),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check('standing_status', sql`${t.status} in ('active', 'suspended', 'banned')`),
    check(
      'standing_suspended_has_until',
      sql`${t.status} <> 'suspended' or ${t.until} is not null`,
    ),
    check(
      'standing_only_suspended_has_until',
      sql`${t.status} = 'suspended' or ${t.until} is null`,
    ),
  ],
)

/** Internal: profiles, for modules that declare `account` as a dependency. */
export const vProfiles = schema
  .view('v_profiles', {
    userId: uuid('user_id').notNull(),
    displayName: text('display_name'),
    analyticsConsent: boolean('analytics_consent').notNull(),
    designPartner: boolean('design_partner').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  })
  .existing()

/**
 * Internal: one row per active channel binding (Telegram or push), for `account-integrity`'s
 * `checkChannelBinding()`. Exempt from the switch filter (rule 11): always returns its rows.
 */
export const vChannels = schema
  .view('v_channels', {
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    deviceId: text('device_id'),
    sessionId: text('session_id'),
    boundAt: timestamp('bound_at', { withTimezone: true, precision: 3 }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 3 }),
  })
  .existing()

/**
 * Internal: status, until and fair-use limits, for `want-manager` and `alert-router`. Exempt from
 * the switch filter (rule 11): always returns its rows, so a limit already recorded still applies
 * with `account` off.
 */
export const vStanding = schema
  .view('v_standing', {
    userId: uuid('user_id').notNull(),
    status: text('status').notNull(),
    until: timestamp('until', { withTimezone: true, precision: 3 }),
    limits: jsonb('limits'),
  })
  .existing()
