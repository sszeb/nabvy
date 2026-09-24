import { z } from 'zod'
import { defineEvents, IsoTimestamp, ModuleName } from '../index'

// Contracts of the spend-governor module (services/spend-governor): the owner's budgets, what each
// has committed this period, and the throttle level paying modules read before they spend.
// Import from '@nabvy/contracts/modules/spend-governor'. Samples in
// fixtures/contracts/spend-governor/.

export const module = 'spend-governor'

/**
 * Throttle levels, lowest first. `check-scheduler` applies them in this order as the level rises
 * (actor-integration.md 2.12): slow pairs only free users need, then pairs paying users need, then
 * sweeps, then no new pairs. Queued work is never dropped.
 */
export const SPEND_GOVERNOR_LEVELS = [
  'none',
  'slow-free',
  'slow-paid',
  'slow-sweeps',
  'hold-new',
] as const
export const SpendGovernorLevel = z.enum(SPEND_GOVERNOR_LEVELS)
export type SpendGovernorLevel = z.infer<typeof SpendGovernorLevel>

/** A budget's name, kebab case: `apify-monthly`, `apify-residential-proxy`. */
export const SpendGovernorBudgetName = ModuleName

/**
 * What a budget counts. `USD` and `GBP` are money in integer micros (as in cost-meter), `GB` is
 * residential proxy traffic in micro-gigabytes (10 GB is 10 000 000).
 */
export const SpendGovernorUnit = z.enum(['USD', 'GBP', 'GB'])
export type SpendGovernorUnit = z.infer<typeof SpendGovernorUnit>

/** A budget's period: the calendar month in Europe/London, as the gateway's cap. */
export const SpendGovernorPeriod = z.enum(['month'])
export type SpendGovernorPeriod = z.infer<typeof SpendGovernorPeriod>

/** Providers a budget may be scoped to (cost-meter's providers); null means every provider. */
export const SpendGovernorProvider = z.enum(['apify', 'anthropic', 'ebay', 'cex'])
export type SpendGovernorProvider = z.infer<typeof SpendGovernorProvider>

export const SpendGovernorMicros = z.int().nonnegative()

/**
 * One row of `spend_governor.v_budgets`: a budget and where it stands this period. `committed` is
 * settled cost plus every unsettled run at the larger of its reservation and its provisional cost;
 * null means the budget cannot be measured yet (see the module README). `remaining` may be
 * negative once a budget is overspent.
 */
export const SpendGovernorBudget = z.strictObject({
  name: SpendGovernorBudgetName,
  provider: SpendGovernorProvider.nullable(),
  unit: SpendGovernorUnit,
  period: SpendGovernorPeriod,
  limitMicros: SpendGovernorMicros,
  committedMicros: SpendGovernorMicros.nullable(),
  remainingMicros: z.int().nullable(),
  forecastMicros: SpendGovernorMicros.nullable(),
  level: SpendGovernorLevel.nullable(),
  periodStart: IsoTimestamp.nullable(),
  computedAt: IsoTimestamp.nullable(),
  setBy: z.string().min(1),
})
export type SpendGovernorBudget = z.infer<typeof SpendGovernorBudget>

/**
 * Why a budget reads the level it does. `computed`: from its committed spend. `unmeasured`: the
 * spend cannot be read yet, so the budget does not throttle (the money budgets still do).
 * The rest fail closed at `hold-new`: `off` (spend-governor or cost-meter switched off), `stale`
 * (no recompute within the validity window), `never-computed`.
 */
export const SpendGovernorReason = z.enum([
  'computed',
  'unmeasured',
  'off',
  'stale',
  'never-computed',
])
export type SpendGovernorReason = z.infer<typeof SpendGovernorReason>

/** One row of `spend_governor.v_throttle`: the level a paying module obeys for one budget. */
export const SpendGovernorThrottle = z.strictObject({
  budget: SpendGovernorBudgetName,
  level: SpendGovernorLevel,
  reason: SpendGovernorReason,
  since: IsoTimestamp.nullable(),
  computedAt: IsoTimestamp.nullable(),
})
export type SpendGovernorThrottle = z.infer<typeof SpendGovernorThrottle>

/** A recompute: `now` is the time it is computed for; the rate converts USD to GBP budgets. */
export const SpendGovernorRecomputeInput = z.strictObject({
  now: IsoTimestamp,
  usdGbpRate: z.number().positive(),
})
export type SpendGovernorRecomputeInput = z.infer<typeof SpendGovernorRecomputeInput>

/** Advice for the owner; the governor never acts on it (the card: "the owner decides"). */
export const SpendGovernorAdvice = z.strictObject({
  budget: SpendGovernorBudgetName,
  advice: z.enum(['forecast-over-limit', 'scale-plan-may-pay']),
  forecastMicros: SpendGovernorMicros,
  limitMicros: SpendGovernorMicros,
})
export type SpendGovernorAdvice = z.infer<typeof SpendGovernorAdvice>

/**
 * A budget's throttle level rose this period. Identifiers and times only (rule 7): the receiver
 * reads `v_budgets` and `v_throttle`. Keyed `spend-governor.budget-alerted:<budget>@<periodStart>@<level>`,
 * so each level is announced once per budget and period.
 */
export const SpendGovernorBudgetAlertedEvent = z.strictObject({
  budget: SpendGovernorBudgetName,
  level: SpendGovernorLevel,
  periodStart: IsoTimestamp,
})
export type SpendGovernorBudgetAlertedEvent = z.infer<typeof SpendGovernorBudgetAlertedEvent>

/** Error codes the module returns as values (docs/engineering.md, "Errors"). */
export const SpendGovernorErrorCode = z.enum([
  'spend-governor.off', // the switch is off: nothing is recomputed and paid work holds (fail closed)
])
export type SpendGovernorErrorCode = z.infer<typeof SpendGovernorErrorCode>

export const SpendGovernorError = z.strictObject({
  code: SpendGovernorErrorCode,
  message: z.string().min(1),
})
export type SpendGovernorError = z.infer<typeof SpendGovernorError>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'spend-governor.budget-alerted': { 1: SpendGovernorBudgetAlertedEvent },
})
