import { err, ok, type Result } from '@nabvy/contracts'
import {
  COST_METER_KIND_OF,
  CostMeterCall,
  type CostMeterError,
  type CostMeterErrorCode,
  type CostMeterModelCallInput,
  type CostMeterRecordInput,
  type CostMeterSettleInput,
  type CostMeterSwitchState,
} from '@nabvy/contracts/modules/cost-meter'
import type { providerCalls } from '@nabvy/db/schema/cost-meter'
import { APIFY_SETTLE_DELAY_MS, MODEL_PRICES_NANO_USD } from '../config'
import { modelCostMicros, storedRate, toGbpMicros } from './amounts'

// The ledger rules, pure: what a record writes, whether a settlement applies, and what a
// row looks like to readers. The repo writes what these decide.

export type LedgerRow = typeof providerCalls.$inferSelect
export type LedgerInsert = Omit<typeof providerCalls.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
export type SettlementPatch = Pick<
  LedgerRow,
  'settledMicros' | 'settledGbpMicros' | 'usdGbpRate' | 'settledAt' | 'status'
> & { latencyMs?: number }

/** What every call needs from its caller: the module switch and today's USD_GBP_RATE. */
export interface CostMeterContext {
  state: CostMeterSwitchState
  usdGbpRate: number
}

export const failure = (code: CostMeterErrorCode, message: string): Result<never, CostMeterError> =>
  err({ code, message })

/** Off means paid work pauses: callers must not spend when this fails (fail closed). */
export function checkSwitch(ctx: CostMeterContext): Result<true, CostMeterError> {
  return ctx.state === 'off'
    ? failure('cost-meter.off', 'The cost meter is off: paid work pauses until it is back on.')
    : ok(true)
}

/**
 * The row a record writes. A free eBay or CeX call is settled at zero straight away; a paid call
 * (an Apify run) holds its reservation until `settle`.
 */
export function planRecord(input: CostMeterRecordInput, ctx: CostMeterContext): LedgerInsert {
  const at = new Date(input.at)
  const reservedGbpMicros = toGbpMicros(input.reservedMicros, input.currency, ctx.usdGbpRate)
  const free = COST_METER_KIND_OF[input.provider] === 'api_call'
  return {
    module: input.module,
    provider: input.provider,
    kind: COST_METER_KIND_OF[input.provider],
    refId: input.refId,
    currency: input.currency,
    reservedMicros: input.reservedMicros,
    reservedGbpMicros,
    usdGbpRate: storedRate(input.currency, ctx.usdGbpRate),
    settledMicros: free ? 0 : null,
    settledGbpMicros: free ? 0 : null,
    settledAt: free ? at : null,
    status: input.status,
    latencyMs: input.latencyMs ?? null,
    at,
  }
}

/** A model call's row: priced from the table and settled at once (reserved = settled). */
export function planModelCall(
  input: CostMeterModelCallInput,
  ctx: CostMeterContext,
): Result<LedgerInsert, CostMeterError> {
  const price = MODEL_PRICES_NANO_USD[input.usage.model]
  if (!price) {
    return failure('cost-meter.unknown_model', `No price for model ${input.usage.model}.`)
  }
  const micros = modelCostMicros(input.usage, price)
  const gbp = toGbpMicros(micros, 'USD', ctx.usdGbpRate)
  const at = new Date(input.at)
  return ok({
    module: input.module,
    provider: 'anthropic',
    kind: 'model_call',
    refId: input.refId,
    currency: 'USD',
    reservedMicros: micros,
    reservedGbpMicros: gbp,
    usdGbpRate: storedRate('USD', ctx.usdGbpRate),
    settledMicros: micros,
    settledGbpMicros: gbp,
    settledAt: at,
    status: input.status,
    latencyMs: input.latencyMs ?? null,
    at,
  })
}

/** A replayed record must describe the same call, or it is refused rather than merged. */
export function checkSameCall(row: LedgerRow, planned: LedgerInsert): Result<true, CostMeterError> {
  if (
    row.module !== planned.module ||
    row.kind !== planned.kind ||
    row.currency !== planned.currency
  ) {
    return failure(
      'cost-meter.mismatch',
      `${row.provider} call ${row.refId} is already recorded for another module, kind or currency.`,
    )
  }
  return ok(true)
}

/**
 * Whether a settlement applies to a row. It replaces the reservation once: a replay with the same
 * amount changes nothing; a different amount is refused. An Apify reading counts only once it was
 * taken at least APIFY_SETTLE_DELAY_MS after the run finished.
 */
export function planSettlement(
  row: LedgerRow,
  input: CostMeterSettleInput,
  ctx: CostMeterContext,
): Result<SettlementPatch | null, CostMeterError> {
  if (row.currency !== input.currency) {
    return failure('cost-meter.mismatch', `Call ${row.refId} is recorded in ${row.currency}.`)
  }
  if (row.settledAt !== null) {
    if (row.settledMicros === input.settledMicros) return ok(null)
    return failure(
      'cost-meter.already_settled',
      `Call ${row.refId} is already settled at ${row.settledMicros} micros.`,
    )
  }
  if (row.provider === 'apify') {
    if (!input.finishedAt) {
      return failure('cost-meter.not_final', 'An Apify settlement needs the run finishedAt.')
    }
    const wait = Date.parse(input.readAt) - Date.parse(input.finishedAt)
    if (wait < APIFY_SETTLE_DELAY_MS) {
      return failure(
        'cost-meter.not_final',
        `Apify cost read ${Math.max(0, Math.round(wait / 1000))} s after the run finished; it is final only after ${APIFY_SETTLE_DELAY_MS / 60000} minutes.`,
      )
    }
  }
  return ok({
    settledMicros: input.settledMicros,
    settledGbpMicros: toGbpMicros(input.settledMicros, input.currency, ctx.usdGbpRate),
    usdGbpRate: storedRate(input.currency, ctx.usdGbpRate),
    settledAt: new Date(input.readAt),
    status: input.status,
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
  })
}

/** A row as readers see it in v_costs: the settlement once there is one, else the reservation. */
export function toCall(row: LedgerRow): CostMeterCall {
  return CostMeterCall.parse({
    id: row.id,
    module: row.module,
    provider: row.provider,
    kind: row.kind,
    refId: row.refId,
    currency: row.currency,
    reservedMicros: row.reservedMicros,
    settledMicros: row.settledMicros,
    reservedGbpMicros: row.reservedGbpMicros,
    settledGbpMicros: row.settledGbpMicros,
    countedGbpMicros: row.settledGbpMicros ?? row.reservedGbpMicros,
    status: row.status,
    latencyMs: row.latencyMs,
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    at: row.at.toISOString(),
  })
}
