// Public API of the account module: the functions other modules, procedures and tasks may call.
// Other modules import from '@nabvy/account' only, never from its internals.
//
// Standing (README.md, "Standing"): `isActive()` and `setStanding()` add no logic of their own on
// top of `@nabvy/auth`'s. `isActive()` is a direct call to `isAccountActive`, which itself is a
// direct call to the `better_auth.account_active` SQL function on the caller's own connection —
// there is no separate lookup here to keep in step. `setStanding()` calls `restrictAccount` or
// `liftRestriction` for the actual enforcement (Better Auth's ban fields, session revocation, its
// own audit row) and adds only what auth does not carry: fair-use limits and this module's own
// audit trail, in `account.standing`.
import { randomInt } from 'node:crypto'
import {
  type AccountRestrictedError,
  assertAccountActive,
  isAccountActive,
  liftRestriction,
  restrictAccount,
} from '@nabvy/auth'
import {
  DELETION_PURGE_DELAY_MS,
  TELEGRAM_LINK_CODE_ISSUANCE_CAP,
  TELEGRAM_LINK_CODE_ISSUANCE_WINDOW_MS,
  TELEGRAM_LINK_CODE_TTL_MS,
  TELEGRAM_RELINK_CAP_BY_PLAN,
  TELEGRAM_RELINK_WINDOW_MS,
} from '@nabvy/config/modules/account'
import { createEvent, type EventEnvelope, Uuid } from '@nabvy/contracts'
import {
  type AccountChannel,
  AccountConfirmTelegramLinkInput,
  type AccountCreateTelegramLinkCodeInput,
  type AccountDeleteRequestInput,
  type AccountDeletionRequest,
  type AccountExport,
  type AccountExportRequestInput,
  type AccountProfile,
  AccountPushSubscribeInput,
  type AccountPushUnsubscribeInput,
  AccountSetStandingInput,
  type AccountStanding,
  type AccountTelegramLinkCodeIssued,
  type AccountUnlinkTelegramInput,
  type AccountUpdateProfileInput,
  events,
} from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { isOn } from '@nabvy/switches'
import {
  AccountRefused,
  channelKey,
  checkIssuanceCap,
  checkLinkCode,
  checkRelinkCap,
  deletedKey,
  generateLinkCode,
  hashLinkCode,
  relinkCapFor,
} from './domain'
import * as repo from './repo'
import { setStandingWith } from './standing'

export { events, module } from '@nabvy/contracts/modules/account'
export { AccountRefused } from './domain'

async function assertModuleOn(q: Queryable): Promise<void> {
  if (!(await isOn(q, 'account'))) {
    throw new AccountRefused('account.module_off', 'the account module is off')
  }
}

/**
 * Whether an account may be acted for (docs/decisions.md, "Fair use, suspension and bans"; rule
 * 12: every signed-in procedure and every job acting for a user checks this). Not gated by the
 * account module's own switch: "if account is off, suspensions and bans already recorded still
 * apply" (rule 11), because this reads `better_auth.user` directly, not this module's tables.
 */
export function isActive(q: Queryable, userId: string): Promise<boolean> {
  return isAccountActive(q, userId)
}

/**
 * Throws with the notice a restricted user may see (step and policy only) or resolves when
 * active. Delegates entirely to `@nabvy/auth`'s `assertAccountActive`; this module builds no
 * wording of its own (docs/decisions.md:117-121; services/auth/README.md).
 */
export function assertActive(q: Queryable, userId: string): Promise<void> {
  return assertAccountActive(q, userId)
}

export type { AccountRestrictedError }

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

export async function getProfile(q: Queryable, userId: string): Promise<AccountProfile | null> {
  const row = await repo.selectProfile(q, Uuid.parse(userId))
  if (!row) return null
  return {
    userId: row.userId,
    displayName: row.displayName,
    analyticsConsent: row.analyticsConsent,
    designPartner: row.designPartner,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function updateProfile(
  q: Queryable,
  input: AccountUpdateProfileInput,
): Promise<AccountProfile> {
  await assertModuleOn(q)
  const row = await repo.upsertProfile(q, input.userId, {
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.analyticsConsent !== undefined ? { analyticsConsent: input.analyticsConsent } : {}),
  })
  return {
    userId: row.userId,
    displayName: row.displayName,
    analyticsConsent: row.analyticsConsent,
    designPartner: row.designPartner,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------------------------
// Telegram and push channel binding
//
// "Established device" (README.md, "Telegram and push binding"): gated by
// account-integrity.checkChannelBinding(), a soft dependency (card: "allows when off"). That
// module is not built yet, so `switches.state('account-integrity')` has no row and reads 'off'
// (switches fails closed to 'off' for an unknown name), which this resolves as "allowed" per the
// soft-dependency default. docs/questions.md records replacing this with a real call once
// account-integrity ships.
// ---------------------------------------------------------------------------------------------

// TODO(account-integrity): once that module ships, call its checkChannelBinding() here instead of
// this placeholder resolver (docs/questions/account.md, "checkChannelBinding() has no
// account-integrity to call yet").
async function channelBindingAllowed(q: Queryable): Promise<boolean> {
  return !(await isOn(q, 'account-integrity'))
}

function channelLinkedEvent(userId: string, kind: 'telegram' | 'push', at: Date): EventEnvelope {
  return createEvent(
    events,
    'account.channel-linked',
    1,
    { userId },
    { key: channelKey(userId, kind, at) },
  ) as EventEnvelope
}

function channelUnlinkedEvent(userId: string, kind: 'telegram' | 'push', at: Date): EventEnvelope {
  return createEvent(
    events,
    'account.channel-unlinked',
    1,
    { userId },
    { key: channelKey(userId, kind, at) },
  ) as EventEnvelope
}

/** [0, 1) from a CSPRNG, for `generateLinkCode` (never `Math.random`, which is predictable). */
const RANDOM_UNIT_RANGE = 2 ** 32
function secureLinkCodeRandom(): number {
  return randomInt(0, RANDOM_UNIT_RANGE) / RANDOM_UNIT_RANGE
}

export async function createTelegramLinkCode(
  q: Queryable,
  input: AccountCreateTelegramLinkCodeInput,
): Promise<AccountTelegramLinkCodeIssued> {
  await assertModuleOn(q)
  if (!(await channelBindingAllowed(q))) {
    throw new AccountRefused('account.device_not_established', 'this device is not established')
  }
  const now = new Date()

  // The short-window issuance limit (any outcome; stops a script hammering the endpoint) is
  // separate from the plan's re-link cap below (which counts only completed links).
  const issuanceWindowStart = new Date(now.getTime() - TELEGRAM_LINK_CODE_ISSUANCE_WINDOW_MS)
  const issuedRecently = await repo.countRecentLinkCodes(q, input.userId, issuanceWindowStart)
  const issuanceError = checkIssuanceCap(issuedRecently, TELEGRAM_LINK_CODE_ISSUANCE_CAP)
  if (issuanceError) throw new AccountRefused(issuanceError, 'too many codes requested recently')

  const relinkWindowStart = new Date(now.getTime() - TELEGRAM_RELINK_WINDOW_MS)
  const completedRelinks = await repo.countCompletedLinksInWindow(
    q,
    input.userId,
    relinkWindowStart,
  )
  const cap = relinkCapFor('default', TELEGRAM_RELINK_CAP_BY_PLAN)
  const capError = checkRelinkCap(completedRelinks, cap)
  if (capError) throw new AccountRefused(capError, 'the re-link cap for this plan is reached')

  const code = generateLinkCode(secureLinkCodeRandom)
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_CODE_TTL_MS)
  await repo.insertLinkCode(q, {
    codeHash: hashLinkCode(code),
    userId: input.userId,
    sessionId: input.sessionId,
    expiresAt,
  })
  return { code, expiresAt: expiresAt.toISOString() }
}

/** Called from the Telegram bot's link callback (services/account/README.md); runs as the
 * pipeline, with no user session. */
export async function confirmTelegramLink(
  q: Queryable,
  rawInput: AccountConfirmTelegramLinkInput,
): Promise<{ event: EventEnvelope }> {
  await assertModuleOn(q)
  const input = AccountConfirmTelegramLinkInput.parse(rawInput)
  const now = new Date()
  const codeHash = hashLinkCode(input.code)
  const row = await repo.selectLinkCodeForUpdate(q, codeHash)
  const error = checkLinkCode(row, now)
  if (error) throw new AccountRefused(error, 'the link code is not usable')
  const userId = (row as NonNullable<typeof row>).userId

  await repo.consumeLinkCode(q, codeHash, now)
  await repo.upsertTelegramLink(q, userId, input.chatId, now)
  return { event: channelLinkedEvent(userId, 'telegram', now) }
}

export async function unlinkTelegram(
  q: Queryable,
  input: AccountUnlinkTelegramInput,
): Promise<{ event: EventEnvelope }> {
  await assertModuleOn(q)
  await repo.revokeTelegramLink(q, input.userId)
  return { event: channelUnlinkedEvent(input.userId, 'telegram', new Date()) }
}

export async function subscribePush(
  q: Queryable,
  rawInput: AccountPushSubscribeInput,
): Promise<{ event: EventEnvelope }> {
  await assertModuleOn(q)
  if (!(await channelBindingAllowed(q))) {
    throw new AccountRefused('account.device_not_established', 'this device is not established')
  }
  const input = AccountPushSubscribeInput.parse(rawInput)
  await repo.insertPushSubscription(q, input)
  return { event: channelLinkedEvent(input.userId, 'push', new Date()) }
}

export async function unsubscribePush(
  q: Queryable,
  input: AccountPushUnsubscribeInput,
): Promise<{ event: EventEnvelope }> {
  await assertModuleOn(q)
  await repo.revokePushSubscription(q, input.userId, input.deviceId)
  return { event: channelUnlinkedEvent(input.userId, 'push', new Date()) }
}

async function channelsOf(q: Queryable, userId: string): Promise<AccountChannel[]> {
  const channels: AccountChannel[] = []
  const telegram = await repo.selectTelegramLink(q, userId)
  if (telegram) {
    channels.push({
      kind: 'telegram',
      userId,
      linkedAt: telegram.linkedAt.toISOString(),
      revokedAt: telegram.revokedAt?.toISOString() ?? null,
    })
  }
  for (const push of await repo.selectActivePushSubscriptions(q, userId)) {
    channels.push({
      kind: 'push',
      userId,
      deviceId: push.deviceId,
      sessionId: push.sessionId,
      pausedAt: push.pausedAt?.toISOString() ?? null,
      revokedAt: push.revokedAt?.toISOString() ?? null,
      createdAt: push.createdAt.toISOString(),
    })
  }
  return channels
}

// ---------------------------------------------------------------------------------------------
// Export and deletion
// ---------------------------------------------------------------------------------------------

/** A JSON archive of the account's own data. No enforcement reason, evidence, rule, signal or
 * score travels with it, even though this module holds them (docs/decisions.md:119). */
export async function exportAccount(
  q: Queryable,
  input: AccountExportRequestInput,
): Promise<AccountExport> {
  const profile = await getProfile(q, input.userId)
  const channels = await channelsOf(q, input.userId)
  return { userId: input.userId, profile, channels, exportedAt: new Date().toISOString() }
}

export async function requestDeletion(
  q: Queryable,
  input: AccountDeleteRequestInput,
): Promise<{ request: AccountDeletionRequest; event: EventEnvelope | null }> {
  await assertModuleOn(q)
  const existing = await repo.selectDeletionRequest(q, input.userId)
  if (existing) {
    throw new AccountRefused(
      'account.deletion_already_requested',
      'a deletion request is already pending',
    )
  }
  const requestedAt = new Date()
  const purgeBy = new Date(requestedAt.getTime() + DELETION_PURGE_DELAY_MS)
  await repo.insertDeletionRequest(q, input.userId, requestedAt, purgeBy)
  // The purge itself (erasing this module's rows and publishing `account.deleted`) is
  // `purgeDueDeletions`'s job, called by the 24-hour sweep task, not this call's; it returns null
  // here until that sweep runs.
  return {
    request: {
      userId: input.userId,
      requestedAt: requestedAt.toISOString(),
      purgeBy: purgeBy.toISOString(),
      purgedAt: null,
    },
    event: null,
  }
}

/** The `account.deleted` envelope for one user; `purgeDueDeletions` publishes one per user purged. */
export function accountDeletedEvent(userId: string): EventEnvelope {
  return createEvent(
    events,
    'account.deleted',
    1,
    { userId },
    { key: deletedKey(userId) },
  ) as EventEnvelope
}

/**
 * The 24-hour sweep (docs/security.md:11): erases this module's rows for every deletion request
 * whose `purgeBy` is due, in one batch (rule: "batches, not items"), and returns the
 * `account.deleted` envelope for each user purged, for the sweep task to publish. Idempotent: once
 * a user's rows are gone, a repeat call finds nothing left for them (repo.purgeAccountRows). Not
 * gated by the module switch: the 24-hour purge deadline is a data-retention obligation, not a
 * feature this module's switch turns off (unlike the exemptions rule 11 names for reads, this is
 * the same reasoning applied to a write no switch should be able to defer).
 */
export async function purgeDueDeletions(
  q: Queryable,
  now: Date = new Date(),
): Promise<{
  events: EventEnvelope[]
}> {
  const userIds = await repo.selectDueDeletionUserIds(q, now)
  if (userIds.length === 0) return { events: [] }
  await repo.purgeAccountRows(q, userIds)
  return { events: userIds.map(accountDeletedEvent) }
}

// ---------------------------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------------------------

export async function getStanding(q: Queryable, userId: string): Promise<AccountStanding | null> {
  const row = await repo.selectStanding(q, userId)
  if (!row) return null
  return {
    userId: row.userId,
    status: row.status as AccountStanding['status'],
    until: row.until?.toISOString() ?? null,
    limits: (row.limits as AccountStanding['limits']) ?? null,
    actionId: row.actionId,
    at: row.at.toISOString(),
  }
}

/**
 * Called only by `account-integrity` (automated) or an audited admin override, both inside
 * `withPipeline` (the same convention `switches.set()` uses; docs/questions.md, "w1 switches: who
 * may write a switch"). Parses `rawInput` first, so a malformed transition (e.g. a `banned` status
 * carrying an `until`) is refused before anything is called, and always delegates to the real
 * `@nabvy/auth` functions (services/account/src/standing.ts): there is no way for a caller to
 * inject a replacement and skip auth's admin check. Enforcement (Better Auth's ban fields, session
 * revocation, the admin-role check) runs through `@nabvy/auth`; this call adds only the fair-use
 * limits and this module's own audit row.
 */
export async function setStanding(
  q: Queryable,
  rawInput: AccountSetStandingInput,
): Promise<{ standing: AccountStanding; event: EventEnvelope }> {
  await assertModuleOn(q)
  const input = AccountSetStandingInput.parse(rawInput)
  return setStandingWith(q, input, { restrictAccount, liftRestriction })
}
