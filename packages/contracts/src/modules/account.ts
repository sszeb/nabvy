import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { RestrictionPolicy } from './auth'

// Contracts of the account module (services/account): profile, channel links, standing and the
// export/deletion shapes. Import from '@nabvy/contracts/modules/account'.
// Samples in fixtures/contracts/account/.
//
// Naming note (README.md, "Decisions"): the module catalogue card names the channel events
// `channel.linked`/`channel.unlinked`, but rule 7 of docs/design/modules/_rules.md fixes the
// format as `<module>.<what happened>` and says only the emitting module's own name is used.
// Kept here as `account.channel-linked`/`account.channel-unlinked` to follow the rule.

export const module = 'account'

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

export const AccountProfile = z.strictObject({
  userId: Uuid,
  displayName: z.string().trim().min(1).max(80).nullable(),
  analyticsConsent: z.boolean(),
  designPartner: z.boolean(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type AccountProfile = z.infer<typeof AccountProfile>

export const AccountUpdateProfileInput = z
  .strictObject({
    userId: Uuid,
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    analyticsConsent: z.boolean().optional(),
  })
  .refine((input) => input.displayName !== undefined || input.analyticsConsent !== undefined, {
    message: 'nothing to update',
  })
export type AccountUpdateProfileInput = z.infer<typeof AccountUpdateProfileInput>

// ---------------------------------------------------------------------------------------------
// Channels: Telegram links and push subscriptions
// ---------------------------------------------------------------------------------------------

/** An 8-character single-use code, uppercase letters and digits only (no 0/O/1/I ambiguity). */
export const AccountLinkCode = z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/)
export type AccountLinkCode = z.infer<typeof AccountLinkCode>

export const AccountCreateTelegramLinkCodeInput = z.strictObject({
  userId: Uuid,
  /** The session the request came from; used to check the device is established (README.md). */
  sessionId: z.string().min(1).max(200),
})
export type AccountCreateTelegramLinkCodeInput = z.infer<typeof AccountCreateTelegramLinkCodeInput>

export const AccountTelegramLinkCodeIssued = z.strictObject({
  code: AccountLinkCode,
  expiresAt: IsoTimestamp,
})
export type AccountTelegramLinkCodeIssued = z.infer<typeof AccountTelegramLinkCodeIssued>

/** From the Telegram bot's link callback: the code the user typed, and the chat it came from. */
export const AccountConfirmTelegramLinkInput = z.strictObject({
  code: AccountLinkCode,
  chatId: z.string().min(1).max(64),
})
export type AccountConfirmTelegramLinkInput = z.infer<typeof AccountConfirmTelegramLinkInput>

export const AccountUnlinkTelegramInput = z.strictObject({ userId: Uuid })
export type AccountUnlinkTelegramInput = z.infer<typeof AccountUnlinkTelegramInput>

export const AccountPushKeys = z.strictObject({
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
})
export type AccountPushKeys = z.infer<typeof AccountPushKeys>

export const AccountPushSubscribeInput = z.strictObject({
  userId: Uuid,
  deviceId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  endpoint: z.url().max(2000),
  keys: AccountPushKeys,
})
export type AccountPushSubscribeInput = z.infer<typeof AccountPushSubscribeInput>

export const AccountPushUnsubscribeInput = z.strictObject({
  userId: Uuid,
  deviceId: z.string().min(1).max(200),
})
export type AccountPushUnsubscribeInput = z.infer<typeof AccountPushUnsubscribeInput>

/** One row of `account.v_channels`: a linked Telegram chat or a push subscription. */
export const AccountChannel = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('telegram'),
    userId: Uuid,
    linkedAt: IsoTimestamp,
    revokedAt: IsoTimestamp.nullable(),
  }),
  z.strictObject({
    kind: z.literal('push'),
    userId: Uuid,
    deviceId: z.string(),
    sessionId: z.string(),
    pausedAt: IsoTimestamp.nullable(),
    revokedAt: IsoTimestamp.nullable(),
    createdAt: IsoTimestamp,
  }),
])
export type AccountChannel = z.infer<typeof AccountChannel>

// ---------------------------------------------------------------------------------------------
// Standing (docs/decisions.md:110-129; services/account/README.md, "Standing")
// ---------------------------------------------------------------------------------------------

export const AccountStandingStatus = z.enum(['active', 'suspended', 'banned'])
export type AccountStandingStatus = z.infer<typeof AccountStandingStatus>

/**
 * Fair-use limits `want-manager` and `alert-router` read from `v_standing`. A starting shape
 * (packages/config/src/modules/account.ts carries the default values); add a field here when a
 * module needs a new limit, never a free-form object.
 */
export const AccountFairUseLimits = z
  .strictObject({
    maxActiveHunts: z.number().int().min(0).optional(),
    maxAlertsPerDay: z.number().int().min(0).optional(),
  })
  .partial()
export type AccountFairUseLimits = z.infer<typeof AccountFairUseLimits>

/**
 * One row of `account.v_standing`. `actionId` points at the `audit_log` entry `setStanding()`
 * wrote for this change (services/account/README.md, "Standing"); null only for a row a migration
 * seeded. This is an internal shape: no reason, rule, signal or score travels with it
 * (docs/decisions.md:117-121), and it is never sent to `app.*` views.
 */
export const AccountStanding = z.strictObject({
  userId: Uuid,
  status: AccountStandingStatus,
  until: IsoTimestamp.nullable(),
  limits: AccountFairUseLimits.nullable(),
  actionId: Uuid.nullable(),
  at: IsoTimestamp,
})
export type AccountStanding = z.infer<typeof AccountStanding>

/**
 * What `account-integrity` (or an audited admin override) passes to `setStanding()`. `policy` and
 * `reason` are required for `suspended` and `banned`; `until` is required for `suspended` and
 * refused for `banned` (permanent) and `active` (lifts). `reason` is internal only: it is written
 * to `audit_log` and passed to `auth.restrictAccount`/`liftRestriction`, and never reaches a user
 * (docs/decisions.md:117-121).
 */
export const AccountSetStandingInput = z
  .strictObject({
    actorUserId: Uuid,
    userId: Uuid,
    status: AccountStandingStatus,
    policy: RestrictionPolicy.optional(),
    until: IsoTimestamp.nullable().optional(),
    limits: AccountFairUseLimits.optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine((input) => input.status === 'active' || input.policy !== undefined, {
    message: 'policy is required for a suspension or a ban',
    path: ['policy'],
  })
  .refine((input) => input.status !== 'suspended' || !!input.until, {
    message: 'until is required for a suspension',
    path: ['until'],
  })
  .refine((input) => input.status === 'suspended' || !input.until, {
    message: 'until only applies to a suspension',
    path: ['until'],
  })
export type AccountSetStandingInput = z.infer<typeof AccountSetStandingInput>

// ---------------------------------------------------------------------------------------------
// Export and deletion
// ---------------------------------------------------------------------------------------------

export const AccountExportRequestInput = z.strictObject({ userId: Uuid })
export type AccountExportRequestInput = z.infer<typeof AccountExportRequestInput>

/** The JSON archive a user downloads. Carries no enforcement reason, evidence, rule, signal or
 * score, even though the module holds them (docs/decisions.md:119). */
export const AccountExport = z.strictObject({
  userId: Uuid,
  profile: AccountProfile.nullable(),
  channels: z.array(AccountChannel),
  exportedAt: IsoTimestamp,
})
export type AccountExport = z.infer<typeof AccountExport>

export const AccountDeleteRequestInput = z.strictObject({ userId: Uuid })
export type AccountDeleteRequestInput = z.infer<typeof AccountDeleteRequestInput>

export const AccountDeletionRequest = z.strictObject({
  userId: Uuid,
  requestedAt: IsoTimestamp,
  purgeBy: IsoTimestamp,
  purgedAt: IsoTimestamp.nullable(),
})
export type AccountDeletionRequest = z.infer<typeof AccountDeletionRequest>

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export const events = defineEvents(module, {
  'account.deleted': { 1: z.object({ userId: Uuid }) },
  'account.standing-changed': { 1: z.object({ userId: Uuid }) },
  'account.channel-linked': { 1: z.object({ userId: Uuid }) },
  'account.channel-unlinked': { 1: z.object({ userId: Uuid }) },
})

// ---------------------------------------------------------------------------------------------
// Errors: `account.<code>`
// ---------------------------------------------------------------------------------------------

export const AccountErrorCode = z.enum([
  'account.module_off',
  'account.link_code_expired',
  'account.link_code_invalid',
  'account.already_linked',
  'account.chat_already_linked',
  'account.relink_cap_exceeded',
  'account.device_not_established',
  'account.unknown_account',
  'account.deletion_already_requested',
])
export type AccountErrorCode = z.infer<typeof AccountErrorCode>
