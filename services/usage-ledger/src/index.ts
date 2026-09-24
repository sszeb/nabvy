// Public API of the usage-ledger module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/usage-ledger' only, never from its internals.
//
// Every function runs on the caller's transaction (`q`), so a charge commits or rolls back with
// the action it pays for (docs/billing.md, "Usage balance"). Credits in, credits out: this module
// holds no prices (pricing-console owns them) and reads no entitlements (the caller passes the
// amount, keeping subscriptions → usage-ledger one-way).
import { isActive } from '@nabvy/account'
import {
  USAGE_LEDGER_EXPIRY_SWEEP_BATCH,
  USAGE_LEDGER_LOW_BALANCE_CREDITS,
} from '@nabvy/config/modules/usage-ledger'
import { createEvent, type EventEnvelope, err, ok, type Result, Uuid } from '@nabvy/contracts'
import {
  events,
  USAGE_LEDGER_MESSAGES,
  UsageLedgerAllowanceGrant,
  type UsageLedgerBalance,
  UsageLedgerCharge,
  type UsageLedgerChargeInput,
  type UsageLedgerEntry,
  type UsageLedgerError,
  type UsageLedgerErrorCode,
  UsageLedgerGrant,
  type UsageLedgerGrantInput,
  type UsageLedgerPlan,
  type UsageLedgerPolicyQuote,
  UsageLedgerReverse,
  UsageLedgerTopupGrant,
  type UsageLedgerTopupGrantInput,
} from '@nabvy/contracts/modules/usage-ledger'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { balanceLowKey, crossesLowBalance, expiryRef, planCharge } from './domain'
import * as repo from './repo'

export { events, module } from '@nabvy/contracts/modules/usage-ledger'
export { accountDeletedHandler } from './handlers'

const refuse = (
  code: UsageLedgerErrorCode,
  extra: Pick<UsageLedgerError, 'balance' | 'required'> = {},
): Result<never, UsageLedgerError> => err({ code, message: USAGE_LEDGER_MESSAGES[code], ...extra })

function toEntry(row: repo.EntryRow): UsageLedgerEntry {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as UsageLedgerEntry['kind'],
    credits: row.credits,
    action: row.action,
    refId: row.refId,
    reversesId: row.reversesId,
    cashMinor: row.cashMinor,
    costGbpMicros: row.costGbpMicros,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    policyVersion: row.policyVersion,
    at: row.at.toISOString(),
  }
}

export interface Written {
  entry: UsageLedgerEntry
  /** False when the refId was already recorded with the same details: nothing was written. */
  changed: boolean
}

/**
 * Writes a grant (a plan's allowance, a taste, referral credit or a top-up) and opens its bucket.
 * Idempotent on (user, kind, refId): a repeat with the same details writes nothing; with other
 * details it is refused (`usage-ledger.mismatch`). Records while the module is off too, so a
 * paid top-up is never dropped (README.md, "Decisions"). Called by `subscriptions` (top-up
 * Checkout webhook, monthly allowance, taste) and `attribution` (referral credit), in the
 * pipeline.
 */
export async function grant(
  q: Queryable,
  input: UsageLedgerGrantInput,
): Promise<Result<Written, UsageLedgerError>> {
  const g = UsageLedgerGrant.parse(input)
  await repo.lockUser(q, g.userId)
  const row = {
    userId: g.userId,
    kind: g.kind,
    credits: g.credits,
    refId: g.refId,
    cashMinor: g.cashMinor,
    expiresAt: g.expiresAt === null ? null : new Date(g.expiresAt),
  }
  const inserted = await repo.insertEntry(q, row)
  if (inserted) return ok({ entry: toEntry(inserted), changed: true })
  const existing = await repo.selectEntry(q, g.userId, g.kind, g.refId)
  if (
    !existing ||
    existing.credits !== g.credits ||
    existing.cashMinor !== g.cashMinor ||
    (existing.expiresAt?.getTime() ?? null) !== (row.expiresAt?.getTime() ?? null)
  ) {
    return refuse('usage-ledger.mismatch')
  }
  return ok({ entry: toEntry(existing), changed: false })
}

/**
 * How policy-priced grants are valued (docs/decisions.md, "Paid ladder"): the plan's monthly
 * bundle and its top-up rate are versioned policy rows in `pricing-console`, never constants in
 * this module. `pricing-console` provides the real implementation; until it exists, callers get
 * `pendingPricingConsole`, which answers nothing, so no credit is granted from a guessed number.
 * Return `null` when no row answers for the plan.
 */
export interface UsageLedgerPolicy {
  bundleCredits(q: Queryable, plan: UsageLedgerPlan): Promise<UsageLedgerPolicyQuote | null>
  topupCredits(
    q: Queryable,
    plan: UsageLedgerPlan,
    cashMinor: number,
  ): Promise<UsageLedgerPolicyQuote | null>
}

/** The documented stub until `pricing-console` ships (backlog 4.10b): no policy, no grant. */
export const pendingPricingConsole: UsageLedgerPolicy = {
  bundleCredits: async () => null,
  topupCredits: async () => null,
}

type PolicyGrant = {
  userId: string
  kind: 'allowance' | 'topup'
  refId: string
  cashMinor: number
  expiresAt: string | null
}

/**
 * A grant valued by policy. A replay of the same refId returns the first grant unchanged, whatever
 * the policy says now (a webhook retried after a price change must not re-value a payment), and
 * is refused only if its cash or expiry differ. The policy is read only for a new grant.
 */
async function grantByPolicy(
  q: Queryable,
  g: PolicyGrant,
  quote: () => Promise<UsageLedgerPolicyQuote | null>,
): Promise<Result<Written, UsageLedgerError>> {
  await repo.lockUser(q, g.userId)
  const expiresAt = g.expiresAt === null ? null : new Date(g.expiresAt)
  const existing = await repo.selectEntry(q, g.userId, g.kind, g.refId)
  if (existing) {
    const same =
      existing.cashMinor === g.cashMinor &&
      (existing.expiresAt?.getTime() ?? null) === (expiresAt?.getTime() ?? null)
    return same ? ok({ entry: toEntry(existing), changed: false }) : refuse('usage-ledger.mismatch')
  }
  const value = await quote()
  if (!value) return refuse('usage-ledger.no_policy')
  const inserted = await repo.insertEntry(q, {
    userId: g.userId,
    kind: g.kind,
    credits: value.credits,
    refId: g.refId,
    cashMinor: g.cashMinor,
    expiresAt,
    policyVersion: value.policyVersion,
  })
  if (!inserted) throw new Error(`usage-ledger: grant ${g.refId} appeared under the user lock`)
  return ok({ entry: toEntry(inserted), changed: true })
}

/**
 * The plan's monthly bundle (use it or lose it: expires at the next renewal), valued by the
 * policy's bundle size for the plan. Called by `subscriptions` on each renewal; idempotent on
 * refId (for example `allowance:<subscription>@<period start>`). The fee funds the plan's base
 * cadence; the bundle pays only for faster checks and for checking (the caller's concern).
 */
export async function grantAllowance(
  q: Queryable,
  input: UsageLedgerAllowanceGrant,
  policy: UsageLedgerPolicy = pendingPricingConsole,
): Promise<Result<Written, UsageLedgerError>> {
  const g = UsageLedgerAllowanceGrant.parse(input)
  return grantByPolicy(q, { ...g, kind: 'allowance' }, () => policy.bundleCredits(q, g.plan))
}

/**
 * A bought top-up, valued at the plan's top-up rate for its net cash. Called by `subscriptions`
 * from the top-up Checkout webhook; idempotent on refId (the payment intent).
 */
export async function grantTopup(
  q: Queryable,
  input: UsageLedgerTopupGrantInput,
  policy: UsageLedgerPolicy = pendingPricingConsole,
): Promise<Result<Written, UsageLedgerError>> {
  const g = UsageLedgerTopupGrant.parse(input)
  return grantByPolicy(q, { ...g, kind: 'topup' }, () =>
    policy.topupCredits(q, g.plan, g.cashMinor),
  )
}

export interface Charged extends Written {
  /** The spendable balance after this charge (or now, on a repeat). */
  balance: number
  /** `usage-ledger.balance-low` when this charge crossed the line; publish after commit. */
  events: EventEnvelope[]
}

/**
 * Charges a metered action, inside the action's own transaction (withUser or withPipeline).
 * Spends buckets in order: allowance, taste and referral credit, top-ups oldest first. Refuses,
 * never partially charges, when the balance does not cover it (`usage-ledger.insufficient`, with
 * the balance and the amount for the top-up prompt). Idempotent on (user, refId). With zero
 * credits it records only the cost the action caused, for the free-tier lifetime cap (4.9a).
 * Refused unless the module is on (`usage-ledger.off`), for an inactive account, and for a
 * replay of a charge that was reversed (`usage-ledger.reversed`).
 */
export async function chargeUsage(
  q: Queryable,
  input: UsageLedgerChargeInput,
): Promise<Result<Charged, UsageLedgerError>> {
  const c = UsageLedgerCharge.parse(input)
  // Only `on` charges: shadow would spend real credit while users see no balance (review of PR #47).
  if ((await state(q, 'usage-ledger')) !== 'on') return refuse('usage-ledger.off')
  if (c.credits > 0 && !(await isActive(q, c.userId)))
    return refuse('usage-ledger.account_inactive')
  await repo.lockUser(q, c.userId)

  const buckets = await repo.liveBuckets(q, c.userId)
  const existing = await repo.selectEntry(q, c.userId, 'charge', c.refId)
  if (existing) {
    if (
      existing.action !== c.action ||
      existing.credits !== -c.credits ||
      existing.costGbpMicros !== c.costGbpMicros
    ) {
      return refuse('usage-ledger.mismatch')
    }
    // A charge replayed after its reversal is not paid for (review of PR #47): the caller must
    // not run the action on the strength of the original charge.
    if (await repo.selectReversalOf(q, existing.id)) return refuse('usage-ledger.reversed')
    const balance = buckets.reduce((sum, b) => sum + b.remaining, 0)
    return ok({ entry: toEntry(existing), changed: false, balance, events: [] })
  }

  const plan = planCharge(buckets, c.credits)
  if (!plan.ok) {
    return refuse('usage-ledger.insufficient', { balance: plan.available, required: c.credits })
  }
  const inserted = await repo.insertEntry(q, {
    userId: c.userId,
    kind: 'charge',
    credits: -c.credits,
    action: c.action,
    refId: c.refId,
    costGbpMicros: c.costGbpMicros,
  })
  if (!inserted) throw new Error(`usage-ledger: charge ${c.refId} appeared under the user lock`)
  await repo.insertAllocations(q, inserted.id, c.userId, plan.allocations)

  const balance = plan.available - c.credits
  const low = crossesLowBalance(plan.available, balance, USAGE_LEDGER_LOW_BALANCE_CREDITS)
    ? [
        createEvent(
          events,
          'usage-ledger.balance-low',
          1,
          { userId: c.userId, entryId: inserted.id },
          { key: balanceLowKey(c.userId, inserted.id) },
        ) as EventEnvelope,
      ]
    : []
  return ok({ entry: toEntry(inserted), changed: true, balance, events: low })
}

/**
 * Reverses a charge whose action failed: returns its credits to exactly the buckets it drew
 * from. A ledger reversal, never a refund of money (docs/decisions.md, "No refunds"). Idempotent:
 * a second call writes nothing. Records while the module is off, so a charge taken while it was
 * on can always be returned. The cost the action caused stays counted.
 */
export async function reverseCharge(
  q: Queryable,
  input: { userId: string; refId: string },
): Promise<Result<Written, UsageLedgerError>> {
  const r = UsageLedgerReverse.parse(input)
  await repo.lockUser(q, r.userId)
  const charge = await repo.selectEntry(q, r.userId, 'charge', r.refId)
  if (!charge) return refuse('usage-ledger.not_found')
  const already = await repo.selectReversalOf(q, charge.id)
  if (already) return ok({ entry: toEntry(already), changed: false })

  const inserted = await repo.insertEntry(q, {
    userId: r.userId,
    kind: 'reversal',
    credits: -charge.credits,
    refId: r.refId,
    reversesId: charge.id,
  })
  if (!inserted) throw new Error(`usage-ledger: reversal ${r.refId} appeared under the user lock`)
  const taken = await repo.allocationsOf(q, charge.id)
  await repo.insertAllocations(
    q,
    inserted.id,
    r.userId,
    taken.map((a) => ({ bucketId: a.bucketId, credits: -a.credits })),
  )
  return ok({ entry: toEntry(inserted), changed: true })
}

/**
 * The user's spendable balance now, for the account page and the want screen (through an oRPC
 * procedure inside withUser). Refused unless the module is on: shadow shows users nothing
 * (rule 11).
 */
export async function getBalance(
  q: Queryable,
  userId: string,
): Promise<Result<UsageLedgerBalance, UsageLedgerError>> {
  Uuid.parse(userId)
  if ((await state(q, 'usage-ledger')) !== 'on') return refuse('usage-ledger.off')
  const buckets = await repo.liveBuckets(q, userId)
  const sum = (rank: (kind: string) => boolean) =>
    buckets.filter((b) => rank(b.kind)).reduce((s, b) => s + b.remaining, 0)
  const expiries = buckets.flatMap((b) => (b.expiresAt ? [b.expiresAt.getTime()] : []))
  return ok({
    userId,
    credits: sum(() => true),
    allowanceCredits: sum((k) => k === 'allowance'),
    tasteReferralCredits: sum((k) => k === 'taste' || k === 'referral'),
    topupCredits: sum((k) => k === 'topup'),
    nextExpiryAt: expiries.length ? new Date(Math.min(...expiries)).toISOString() : null,
  })
}

/**
 * Closes up to one batch of expired buckets with an `expiry` entry each, so the ledger adds up
 * (use it or lose it). Balances already ignore expired buckets, so a late sweep never lets
 * expired credit be spent. Idempotent; writes nothing while the module is off. Pipeline only.
 */
export async function expireBuckets(q: Queryable): Promise<{ expired: number }> {
  if ((await state(q, 'usage-ledger')) === 'off') return { expired: 0 }
  const due = await repo.dueBuckets(q, USAGE_LEDGER_EXPIRY_SWEEP_BATCH)
  let expired = 0
  for (const bucket of due) {
    // Under the user's lock, re-read what is left: a charge may have committed since `due` was
    // read, and closing the old amount would abort the whole batch (review of PR #47).
    await repo.lockUser(q, bucket.userId)
    const remaining = await repo.bucketRemaining(q, bucket.id)
    if (!remaining) continue
    const entry = await repo.insertEntry(q, {
      userId: bucket.userId,
      kind: 'expiry',
      credits: -remaining,
      refId: expiryRef(bucket.id),
    })
    if (!entry) continue
    await repo.insertAllocations(q, entry.id, bucket.userId, [
      { bucketId: bucket.id, credits: -remaining },
    ])
    expired += 1
  }
  return { expired }
}

/**
 * Erases every row this module holds for these users, on `account.deleted` (rule 12). Runs
 * whatever the switch says: a retention deadline, not a feature. Idempotent.
 */
export async function purge(
  q: Queryable,
  userIds: readonly string[],
): Promise<{ entries: number }> {
  for (const id of userIds) Uuid.parse(id)
  return { entries: await repo.purgeUsers(q, userIds) }
}
