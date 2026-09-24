// Database access of the spend-governor module, as nabvy_pipeline (inside withPipeline): its own
// schema spend_governor, and the published views it reads, cost_meter.v_costs and
// apify_gateway.v_jobs. It never names another module's tables.
import type {
  SpendGovernorLevel,
  SpendGovernorReason,
} from '@nabvy/contracts/modules/spend-governor'
import type { Queryable } from '@nabvy/db'
import { sql } from 'drizzle-orm'
import {
  type BudgetDef,
  decimalToMicros,
  type LedgerCall,
  type ProxyRun,
  type ThrottleState,
  type UnmeteredRun,
} from '../domain'

type Row = Record<string, unknown>
const rowsOf = (result: unknown): Row[] => (result as { rows: Row[] }).rows
const num = (v: unknown) => Number(v)
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)))
const usd = (v: unknown) => (v === null || v === undefined ? null : decimalToMicros(String(v)))

/** Every budget, by name. */
export async function selectBudgets(q: Queryable): Promise<(BudgetDef & { setBy: string })[]> {
  const rows = rowsOf(
    await q.execute(sql`select name, provider, unit, limit_micros, set_by
      from spend_governor.budgets order by name`),
  )
  return rows.map((r) => ({
    name: String(r.name),
    provider: (r.provider ?? null) as BudgetDef['provider'],
    unit: r.unit as BudgetDef['unit'],
    limitMicros: num(r.limit_micros),
    setBy: String(r.set_by),
  }))
}

/**
 * Ledger calls the period may count: those made since `start`, and every call still unsettled.
 * An unsettled Apify call carries its run's provisional cost from the gateway's `v_jobs`.
 */
export async function selectLedgerCalls(q: Queryable, start: Date): Promise<LedgerCall[]> {
  const rows = rowsOf(
    await q.execute(sql`select c.provider, c.currency, c.reserved_micros, c.settled_micros,
        c.reserved_gbp_micros, c.settled_gbp_micros, c.at,
        case when c.settled_at is null then j.cost_usd end as provisional_usd
      from cost_meter.v_costs c
      left join apify_gateway.v_jobs j on c.provider = 'apify' and j.apify_run_id = c.ref_id
      where c.at >= ${start.toISOString()}::timestamptz or c.settled_at is null`),
  )
  return rows.map((r) => ({
    provider: String(r.provider),
    currency: r.currency as LedgerCall['currency'],
    reservedMicros: num(r.reserved_micros),
    settledMicros: numOrNull(r.settled_micros),
    reservedGbpMicros: num(r.reserved_gbp_micros),
    settledGbpMicros: numOrNull(r.settled_gbp_micros),
    provisionalUsdMicros: usd(r.provisional_usd),
    at: date(r.at),
  }))
}

/**
 * Gateway runs cost-meter has not recorded (queued, or started before the watcher meters them):
 * those created since `start`, and every one not yet settled.
 */
export async function selectUnmeteredRuns(q: Queryable, start: Date): Promise<UnmeteredRun[]> {
  const rows = rowsOf(
    await q.execute(sql`select j.status, j.apify_run_id, j.reserve_usd, j.cost_usd, j.settled_at,
        j.created_at
      from apify_gateway.v_jobs j
      where j.kind = 'run'
        and (j.created_at >= ${start.toISOString()}::timestamptz or j.settled_at is null)
        and not exists (select 1 from cost_meter.v_costs c
                        where c.provider = 'apify' and c.ref_id = j.apify_run_id)`),
  )
  return rows.map((r) => ({
    status: String(r.status),
    started: r.apify_run_id !== null && r.apify_run_id !== undefined,
    reserveUsdMicros: usd(r.reserve_usd) ?? 0,
    costUsdMicros: usd(r.cost_usd),
    settled: r.settled_at !== null && r.settled_at !== undefined,
    createdAt: date(r.created_at),
  }))
}

/**
 * Settled runs of the period with their residential proxy GB. `v_jobs` does not publish the run
 * object's `usage.PROXY_RESIDENTIAL_TRANSFER_GBYTES` yet, so each run's traffic is unknown (null)
 * and the proxy budget reads as unmeasured (docs/questions/spend-governor.md).
 */
export async function selectProxyRuns(q: Queryable, start: Date): Promise<ProxyRun[]> {
  const rows = rowsOf(
    await q.execute(sql`select j.id from apify_gateway.v_jobs j
      where j.kind = 'run' and j.settled_at >= ${start.toISOString()}::timestamptz`),
  )
  return rows.map(() => ({ proxyGbMicros: null }))
}

/** The last written throttle row of each budget. */
export async function selectThrottle(q: Queryable): Promise<Map<string, ThrottleState>> {
  const rows = rowsOf(
    await q.execute(sql`select budget, level, since, period_start, committed_micros,
        forecast_micros, computed_at from spend_governor.throttle`),
  )
  return new Map(
    rows.map((r) => [
      String(r.budget),
      {
        level: r.level as SpendGovernorLevel,
        since: date(r.since),
        periodStart: date(r.period_start),
        committedMicros: numOrNull(r.committed_micros),
        forecastMicros: numOrNull(r.forecast_micros),
        computedAt: date(r.computed_at),
      },
    ]),
  )
}

/** Writes one budget's throttle row. */
export async function upsertThrottle(
  q: Queryable,
  budget: string,
  state: ThrottleState,
  validUntil: Date,
): Promise<void> {
  await q.execute(sql`insert into spend_governor.throttle
      (budget, level, since, period_start, committed_micros, forecast_micros, computed_at, valid_until)
    values (${budget}, ${state.level}, ${state.since.toISOString()}::timestamptz,
      ${state.periodStart.toISOString()}::timestamptz, ${state.committedMicros},
      ${state.forecastMicros}, ${state.computedAt.toISOString()}::timestamptz,
      ${validUntil.toISOString()}::timestamptz)
    on conflict (budget) do update set
      level = excluded.level, since = excluded.since, period_start = excluded.period_start,
      committed_micros = excluded.committed_micros, forecast_micros = excluded.forecast_micros,
      computed_at = excluded.computed_at, valid_until = excluded.valid_until`)
}

/** `v_throttle` as paying modules read it. */
export async function selectThrottleView(q: Queryable): Promise<
  {
    budget: string
    level: SpendGovernorLevel
    reason: SpendGovernorReason
    since: Date | null
    computedAt: Date | null
  }[]
> {
  const rows = rowsOf(
    await q.execute(sql`select budget, level, reason, since, computed_at
      from spend_governor.v_throttle order by budget`),
  )
  return rows.map((r) => ({
    budget: String(r.budget),
    level: r.level as SpendGovernorLevel,
    reason: r.reason as SpendGovernorReason,
    since: r.since === null ? null : date(r.since),
    computedAt: r.computed_at === null ? null : date(r.computed_at),
  }))
}

/** `v_budgets` rows. */
export async function selectBudgetsView(q: Queryable): Promise<Row[]> {
  return rowsOf(
    await q.execute(sql`select name, provider, unit, period, limit_micros, committed_micros,
        remaining_micros, forecast_micros, level, period_start, computed_at, set_by
      from spend_governor.v_budgets order by name`),
  )
}
