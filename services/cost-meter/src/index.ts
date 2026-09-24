// Public API of the cost-meter module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/cost-meter' only, never from its internals.
import { ok, type Result } from '@nabvy/contracts'
import {
  type CostMeterCall,
  type CostMeterError,
  CostMeterModelCallInput,
  CostMeterRecordInput,
  CostMeterSettleInput,
} from '@nabvy/contracts/modules/cost-meter'
import type { Queryable } from '@nabvy/db'
import {
  type CostMeterContext,
  checkSameCall,
  checkSwitch,
  failure,
  type LedgerInsert,
  planModelCall,
  planRecord,
  planSettlement,
  toCall,
} from './domain'
import { findCall, insertCall, listCalls, writeSettlement } from './repo'

export { APIFY_SETTLE_DELAY_MS, MODEL_PRICES_NANO_USD } from '@nabvy/config/modules/cost-meter'
export { events, module } from '@nabvy/contracts/modules/cost-meter'
export { type CostMeterContext, modelCostMicros, toGbpMicros, unitsToMicros } from './domain'

/** The outcome of a write: the call as readers see it, and whether this call changed the ledger. */
export interface CostMeterWrite {
  call: CostMeterCall
  changed: boolean
}

async function writeCall(
  db: Queryable,
  planned: LedgerInsert,
): Promise<Result<CostMeterWrite, CostMeterError>> {
  const { row, created } = await insertCall(db, planned)
  if (!created) {
    const same = checkSameCall(row, planned)
    if (!same.ok) return same
  }
  return ok({ call: toCall(row), changed: created })
}

/**
 * Records a call before (or as) it spends: an Apify run with its reservation, or a free eBay or
 * CeX call (settled at zero). Idempotent on (provider, refId). Fails closed: when the meter is
 * off it writes nothing and returns `cost-meter.off`, and the caller must not spend.
 */
export async function record(
  db: Queryable,
  input: CostMeterRecordInput,
  ctx: CostMeterContext,
): Promise<Result<CostMeterWrite, CostMeterError>> {
  const on = checkSwitch(ctx)
  if (!on.ok) return on
  return writeCall(db, planRecord(CostMeterRecordInput.parse(input), ctx))
}

/** Records a model call once it returns: tokens × the price table, settled at once. */
export async function recordModelCall(
  db: Queryable,
  input: CostMeterModelCallInput,
  ctx: CostMeterContext,
): Promise<Result<CostMeterWrite, CostMeterError>> {
  const on = checkSwitch(ctx)
  if (!on.ok) return on
  const planned = planModelCall(CostMeterModelCallInput.parse(input), ctx)
  if (!planned.ok) return planned
  return writeCall(db, planned.value)
}

/**
 * Settles a recorded call with the provider's final cost. The settlement replaces the
 * reservation once; a replay with the same amount changes nothing. An Apify reading taken less
 * than APIFY_SETTLE_DELAY_MS after the run finished is refused (`cost-meter.not_final`), and the
 * reservation keeps counting.
 */
export async function settle(
  db: Queryable,
  input: CostMeterSettleInput,
  ctx: CostMeterContext,
): Promise<Result<CostMeterWrite, CostMeterError>> {
  const on = checkSwitch(ctx)
  if (!on.ok) return on
  const settlement = CostMeterSettleInput.parse(input)
  // Two passes at most: if another settler wins between the read and the write, the second pass
  // sees its settlement and answers as a replay (same amount) or a refusal (different amount).
  for (let pass = 0; pass < 2; pass++) {
    const row = await findCall(db, settlement.provider, settlement.refId)
    if (!row) {
      return failure(
        'cost-meter.not_found',
        `No ${settlement.provider} call ${settlement.refId} is recorded.`,
      )
    }
    const patch = planSettlement(row, settlement, ctx)
    if (!patch.ok) return patch
    if (patch.value === null) return ok({ call: toCall(row), changed: false })
    const written = await writeSettlement(db, row.id, patch.value)
    if (written) return ok({ call: toCall(written), changed: true })
  }
  throw new Error(`cost-meter: settlement of ${settlement.refId} kept losing a race`)
}

/**
 * The ledger since a time, optionally for one module, as v_costs shows it. Empty while the meter
 * is off (rule 11); readers treat that as "no data", and paid modules pause on `record` anyway.
 */
export async function readCosts(
  db: Queryable,
  filter: { since: Date; module?: string },
  ctx: Pick<CostMeterContext, 'state'>,
): Promise<CostMeterCall[]> {
  if (ctx.state === 'off') return []
  return (await listCalls(db, filter)).map(toCall)
}
