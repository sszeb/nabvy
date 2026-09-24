import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the usage-ledger module (services/usage-ledger): each user's credit balance,
// grants, charges, reversals and expiries. Import from '@nabvy/contracts/modules/usage-ledger'.
//
// Units (services/usage-ledger/README.md, "Decisions"): balances and charges are whole credits;
// the cash a grant was bought with is integer pence (`cashMinor`); the provider and model cost a
// charge caused is integer GBP micros (`costGbpMicros`, the cost-meter's unit). Never a float.
// This module holds no prices: the caller passes the credits (pricing-console owns prices).

export const module = 'usage-ledger'

/** Whole credits. Postgres `integer`, so at most 2^31 − 1. */
export const UsageLedgerCredits = z.int().min(0).max(2_147_483_647)
export type UsageLedgerCredits = z.infer<typeof UsageLedgerCredits>

/**
 * What a grant is, which fixes its bucket and so the order it is spent in
 * (`docs/design/pricing-model.md`, "Order: allowance (expires at renewal), taste and referral
 * credit, top-ups oldest first"):
 * - `allowance`: the plan's included credit, granted each renewal, expiring at the next one.
 * - `taste`: the free trial credit; never bought, never funds speed.
 * - `referral`: credit for a paying referral; never bought, never funds speed.
 * - `topup`: bought credit; does not expire unless the caller sets `expiresAt`.
 */
export const UsageLedgerGrantKind = z.enum(['allowance', 'taste', 'referral', 'topup'])
export type UsageLedgerGrantKind = z.infer<typeof UsageLedgerGrantKind>

/** Every kind of ledger entry: a grant, or a charge, its reversal, or a bucket's expiry. */
export const UsageLedgerEntryKind = z.enum([
  ...UsageLedgerGrantKind.options,
  'charge',
  'reversal',
  'expiry',
])
export type UsageLedgerEntryKind = z.infer<typeof UsageLedgerEntryKind>

/** Spend order: rank 1 is spent first. Inside a rank, earliest expiry first, then oldest first. */
export const USAGE_LEDGER_BUCKET_RANK: Record<UsageLedgerGrantKind, 1 | 2 | 3> = {
  allowance: 1,
  taste: 2,
  referral: 2,
  topup: 3,
}

/** Grants bought with cash; only these may carry `cashMinor` (pricing-model, "Funding"). */
export const USAGE_LEDGER_CASH_KINDS: readonly UsageLedgerGrantKind[] = ['allowance', 'topup']

/** A caller-supplied idempotency key: a Stripe payment intent, a scan ID, `want:<id>@<day>`. */
export const UsageLedgerRefId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/, 'printable ASCII, no spaces')
export type UsageLedgerRefId = z.infer<typeof UsageLedgerRefId>

/** A metered action's code, chosen by the caller (`scan_live`, `watch_day`, `boost_24h`). */
export const UsageLedgerAction = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
export type UsageLedgerAction = z.infer<typeof UsageLedgerAction>

/** Integer GBP micros (10⁻⁶ £), as `cost-meter` records costs. */
export const UsageLedgerGbpMicros = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER)

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export const UsageLedgerGrant = z
  .strictObject({
    userId: Uuid,
    kind: UsageLedgerGrantKind,
    credits: UsageLedgerCredits.min(1),
    refId: UsageLedgerRefId,
    /** Net cash this grant was bought with, in pence (after VAT and fees; pricing-model "Net"). */
    cashMinor: z.int().min(0).max(2_147_483_647).default(0),
    expiresAt: IsoTimestamp.nullable().default(null),
  })
  .refine((g) => g.cashMinor === 0 || USAGE_LEDGER_CASH_KINDS.includes(g.kind), {
    message: 'only allowance and topup grants are bought with cash',
    path: ['cashMinor'],
  })
  .refine((g) => !['allowance', 'taste'].includes(g.kind) || g.expiresAt !== null, {
    message: 'allowance and taste credit expire',
    path: ['expiresAt'],
  })
export type UsageLedgerGrant = z.infer<typeof UsageLedgerGrant>
export type UsageLedgerGrantInput = z.input<typeof UsageLedgerGrant>

// ---------------------------------------------------------------------------------------------
// Policy-priced grants (docs/decisions.md, "Paid ladder"): the plan's bundle and the top-up rate
// are versioned policy rows in `pricing-console`, read through `UsageLedgerPolicy`, never
// constants here.
// ---------------------------------------------------------------------------------------------

/** A plan's name as `pricing-console` keys it (`starter`, `pro`, `max`, `business`). */
export const UsageLedgerPlan = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
export type UsageLedgerPlan = z.infer<typeof UsageLedgerPlan>

/** What a policy row says a grant is worth, and which version of the row said it. */
export const UsageLedgerPolicyQuote = z.strictObject({
  credits: UsageLedgerCredits.min(1),
  policyVersion: z.string().min(1).max(100),
})
export type UsageLedgerPolicyQuote = z.infer<typeof UsageLedgerPolicyQuote>

/** The monthly bundle: use it or lose it, expiring at the next renewal. */
export const UsageLedgerAllowanceGrant = z.strictObject({
  userId: Uuid,
  plan: UsageLedgerPlan,
  refId: UsageLedgerRefId,
  cashMinor: z.int().min(0).max(2_147_483_647),
  expiresAt: IsoTimestamp,
})
export type UsageLedgerAllowanceGrant = z.infer<typeof UsageLedgerAllowanceGrant>

/** A bought top-up: the policy turns the net cash into credits at the plan's top-up rate. */
export const UsageLedgerTopupGrant = z.strictObject({
  userId: Uuid,
  plan: UsageLedgerPlan,
  refId: UsageLedgerRefId,
  cashMinor: z.int().min(1).max(2_147_483_647),
  expiresAt: IsoTimestamp.nullable().default(null),
})
export type UsageLedgerTopupGrant = z.infer<typeof UsageLedgerTopupGrant>
export type UsageLedgerTopupGrantInput = z.input<typeof UsageLedgerTopupGrant>

export const UsageLedgerCharge = z.strictObject({
  userId: Uuid,
  action: UsageLedgerAction,
  /** 0 records only the cost the action caused (a free-tier check), and never refuses. */
  credits: UsageLedgerCredits,
  refId: UsageLedgerRefId,
  /** The provider and model cost this action caused for this account (task 4.9a's lifetime cap). */
  costGbpMicros: UsageLedgerGbpMicros.default(0),
})
export type UsageLedgerCharge = z.infer<typeof UsageLedgerCharge>
export type UsageLedgerChargeInput = z.input<typeof UsageLedgerCharge>

export const UsageLedgerReverse = z.strictObject({
  userId: Uuid,
  /** The `refId` of the charge to reverse. */
  refId: UsageLedgerRefId,
})
export type UsageLedgerReverse = z.infer<typeof UsageLedgerReverse>

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

/** One ledger row. `credits` is signed: grants and reversals add, charges and expiries take. */
export const UsageLedgerEntry = z.strictObject({
  id: Uuid,
  userId: Uuid,
  kind: UsageLedgerEntryKind,
  credits: z.int(),
  action: UsageLedgerAction.nullable(),
  refId: UsageLedgerRefId,
  reversesId: Uuid.nullable(),
  cashMinor: z.int().min(0),
  costGbpMicros: UsageLedgerGbpMicros,
  expiresAt: IsoTimestamp.nullable(),
  /** The pricing-console policy version a policy-priced grant was valued at. */
  policyVersion: z.string().nullable(),
  at: IsoTimestamp,
})
export type UsageLedgerEntry = z.infer<typeof UsageLedgerEntry>

/** A user's spendable balance now, by bucket rank. Expired buckets count nothing. */
export const UsageLedgerBalance = z.strictObject({
  userId: Uuid,
  credits: z.int().min(0),
  allowanceCredits: z.int().min(0),
  tasteReferralCredits: z.int().min(0),
  topupCredits: z.int().min(0),
  /** Earliest expiry among buckets that still hold credit, if any. */
  nextExpiryAt: IsoTimestamp.nullable(),
})
export type UsageLedgerBalance = z.infer<typeof UsageLedgerBalance>

// ---------------------------------------------------------------------------------------------
// Events: identifiers only (rule 7)
// ---------------------------------------------------------------------------------------------

/** A charge took the balance below the low-balance line: suggest a top-up. */
export const UsageLedgerBalanceLowEvent = z.strictObject({ userId: Uuid, entryId: Uuid })
export type UsageLedgerBalanceLowEvent = z.infer<typeof UsageLedgerBalanceLowEvent>

export const events = defineEvents(module, {
  'usage-ledger.balance-low': { 1: UsageLedgerBalanceLowEvent },
})

// ---------------------------------------------------------------------------------------------
// Errors: `usage-ledger.<code>`
// ---------------------------------------------------------------------------------------------

export const UsageLedgerErrorCode = z.enum([
  /** The module is not on: metered actions are refused. */
  'usage-ledger.off',
  /** The balance does not cover the charge (refusal at zero). */
  'usage-ledger.insufficient',
  /** The account is suspended, banned or unknown. */
  'usage-ledger.account_inactive',
  /** A `refId` already used with different details. */
  'usage-ledger.mismatch',
  /** No charge with that `refId` for that user. */
  'usage-ledger.not_found',
  /** The charge with this `refId` was reversed: the action is not paid for. */
  'usage-ledger.reversed',
  /** No pricing policy answers for this plan (pricing-console not built, or no row). */
  'usage-ledger.no_policy',
])
export type UsageLedgerErrorCode = z.infer<typeof UsageLedgerErrorCode>

export const UsageLedgerError = z.strictObject({
  code: UsageLedgerErrorCode,
  message: z.string(),
  /** On `insufficient`: what the user has and what the action needs, for the top-up prompt. */
  balance: z.int().min(0).optional(),
  required: z.int().min(0).optional(),
})
export type UsageLedgerError = z.infer<typeof UsageLedgerError>

/** The clear message a refused metered action shows (card: "When off"). */
export const USAGE_LEDGER_MESSAGES: Record<UsageLedgerErrorCode, string> = {
  'usage-ledger.off':
    'Paid actions are paused for a moment. Nothing was charged; please try again later.',
  'usage-ledger.insufficient': 'Not enough credit for this. Top up or change plan to continue.',
  'usage-ledger.account_inactive': 'This account cannot use paid actions right now.',
  'usage-ledger.mismatch': 'This request was already recorded with different details.',
  'usage-ledger.not_found': 'No such charge.',
  'usage-ledger.reversed':
    'This action was not completed and its credits were returned. Start it again.',
  'usage-ledger.no_policy': 'Credit for this plan cannot be granted yet. Nothing was changed.',
}
