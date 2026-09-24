// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import type {
  AccountErrorCode,
  AccountFairUseLimits,
  AccountStandingStatus,
} from '@nabvy/contracts/modules/account'

/** Thrown by an exported function for bad input or a refused transition; never a database error. */
export class AccountRefused extends Error {
  readonly code: AccountErrorCode
  constructor(code: AccountErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'AccountRefused'
  }
}

const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

/** An 8-character single-use code. `random` is `() => number in [0, 1)`, e.g. `Math.random`. */
export function generateLinkCode(random: () => number): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += LINK_CODE_ALPHABET[Math.floor(random() * LINK_CODE_ALPHABET.length)]
  }
  return code
}

export interface LinkCodeRow {
  code: string
  userId: string
  expiresAt: Date
  usedAt: Date | null
}

/** A code is usable once, before it expires, and only by the user it was issued to. */
export function checkLinkCode(row: LinkCodeRow | undefined, now: Date): AccountErrorCode | null {
  if (!row) return 'account.link_code_invalid'
  if (row.usedAt) return 'account.link_code_invalid'
  if (row.expiresAt.getTime() <= now.getTime()) return 'account.link_code_expired'
  return null
}

/** The re-link cap for a plan (packages/config/src/modules/account.ts), `default` if unlisted. */
export function relinkCapFor(plan: string, capByPlan: Readonly<Record<string, number>>): number {
  return capByPlan[plan] ?? capByPlan.default ?? 0
}

/** Refuses a new link code once the plan's cap of codes issued in the window is reached. */
export function checkRelinkCap(codesIssuedInWindow: number, cap: number): AccountErrorCode | null {
  return codesIssuedInWindow >= cap ? 'account.relink_cap_exceeded' : null
}

/**
 * What `setStanding()` does for one call: which `@nabvy/auth` function to invoke (lifting is a
 * different call from restricting) and the `account.standing` row to write. Kept pure so the
 * transition rules are tested without a database or a Better Auth instance.
 */
export interface StandingPlan {
  auth: { kind: 'lift' } | { kind: 'restrict'; until: Date | null }
  row: {
    status: AccountStandingStatus
    until: Date | null
    limits: AccountFairUseLimits | null
  }
}

export function planStandingChange(input: {
  status: AccountStandingStatus
  until?: string | null
  limits?: AccountFairUseLimits
}): StandingPlan {
  const until = input.until ? new Date(input.until) : null
  return {
    auth: input.status === 'active' ? { kind: 'lift' } : { kind: 'restrict', until },
    row: { status: input.status, until, limits: input.limits ?? null },
  }
}

// ---------------------------------------------------------------------------------------------
// Idempotency keys (rule 8 of docs/design/modules/_rules.md): identifiers and times, never a
// hash of content this module has none of.
// ---------------------------------------------------------------------------------------------

export const deletedKey = (userId: string): string => `user:${userId}`
export const standingChangedKey = (userId: string, at: Date): string =>
  `user:${userId}@${at.toISOString()}`
export const channelKey = (userId: string, kind: 'telegram' | 'push', at: Date): string =>
  `user:${userId}:${kind}@${at.toISOString()}`
