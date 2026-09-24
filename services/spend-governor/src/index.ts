// Public API of the spend-governor module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/spend-governor' only, never from its internals. Paying modules
// read the throttle (`readThrottle`, or the view `spend_governor.v_throttle`) before they spend.
import { createEvent, type EventEnvelope, err, ok, type Result } from '@nabvy/contracts'
import {
  events,
  type SpendGovernorAdvice,
  SpendGovernorBudget,
  type SpendGovernorError,
  type SpendGovernorLevel,
  SpendGovernorRecomputeInput,
  SpendGovernorThrottle,
} from '@nabvy/contracts/modules/spend-governor'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import {
  advise,
  alertKey,
  committedMoney,
  committedProxy,
  londonMonth,
  nextState,
  overallLevel,
  plan,
  validUntil,
} from './domain'
import {
  selectBudgets,
  selectBudgetsView,
  selectLedgerCalls,
  selectProxyRuns,
  selectThrottle,
  selectThrottleView,
  selectUnmeteredRuns,
  upsertThrottle,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/spend-governor'
export { levelFor, londonMonth, overallLevel } from './domain'
// Handler registration for the task that consumes apify-gateway.run-settled.
export { onRunSettled } from './handlers'

const MODULE = 'spend-governor'

/** What one recompute did: the budgets it wrote, and the alerts for the caller to publish. */
export interface RecomputeReport {
  written: string[]
  events: EventEnvelope[]
}

/**
 * Recomputes every budget for `now` and writes the throttle rows that changed (or are due a
 * refresh). Returns the `budget-alerted` envelopes; the caller publishes them after its
 * transaction commits, and their keys make a replay a no-op. While the module is off it writes
 * nothing and `v_throttle` reads `hold-new` (fail closed).
 */
export async function recompute(
  q: Queryable,
  input: SpendGovernorRecomputeInput,
): Promise<Result<RecomputeReport, SpendGovernorError>> {
  const { now: nowIso, usdGbpRate } = SpendGovernorRecomputeInput.parse(input)
  if ((await state(q, MODULE)) === 'off') {
    return err({
      code: 'spend-governor.off',
      message: 'spend-governor is off: nothing is recomputed and paid work holds.',
    })
  }
  const now = new Date(nowIso)
  const period = londonMonth(now)
  const [budgets, calls, unmetered, proxyRuns, previous] = [
    await selectBudgets(q),
    await selectLedgerCalls(q, period.start),
    await selectUnmeteredRuns(q, period.start),
    await selectProxyRuns(q, period.start),
    await selectThrottle(q),
  ]

  const report: RecomputeReport = { written: [], events: [] }
  for (const budget of budgets) {
    const committed =
      budget.unit === 'GB'
        ? committedProxy(proxyRuns)
        : committedMoney(budget, period, calls, unmetered, usdGbpRate)
    const next = nextState(budget, committed, period, now)
    const prev = previous.get(budget.name) ?? null
    const decision = plan(prev, next)
    if (!decision.write) continue
    await upsertThrottle(q, budget.name, { ...next, since: decision.since }, validUntil(now))
    report.written.push(budget.name)
    if (decision.alert) {
      const periodStart = next.periodStart.toISOString()
      report.events.push(
        createEvent(
          events,
          'spend-governor.budget-alerted',
          1,
          { budget: budget.name, level: next.level, periodStart },
          { key: alertKey(budget.name, periodStart, next.level), at: nowIso },
        ) as EventEnvelope,
      )
    }
  }
  return ok(report)
}

/**
 * The throttle a paying module obeys: the highest level over all budgets, and each budget's row.
 * Fails closed: no rows, or a database that cannot be read, is `hold-new`.
 */
export async function readThrottle(
  q: Queryable,
): Promise<{ level: SpendGovernorLevel; budgets: SpendGovernorThrottle[] }> {
  try {
    const rows = await selectThrottleView(q)
    const budgets = rows.map((r) =>
      SpendGovernorThrottle.parse({
        budget: r.budget,
        level: r.level,
        reason: r.reason,
        since: r.since?.toISOString() ?? null,
        computedAt: r.computedAt?.toISOString() ?? null,
      }),
    )
    return { level: overallLevel(budgets.map((b) => b.level)), budgets }
  } catch {
    return { level: 'hold-new', budgets: [] }
  }
}

const iso = (v: unknown) =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString()
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** `v_budgets`: each budget's limit, committed, remaining and forecast. Empty while off. */
export async function readBudgets(q: Queryable): Promise<SpendGovernorBudget[]> {
  return (await selectBudgetsView(q)).map((r) =>
    SpendGovernorBudget.parse({
      name: r.name,
      provider: r.provider ?? null,
      unit: r.unit,
      period: r.period,
      limitMicros: Number(r.limit_micros),
      committedMicros: numOrNull(r.committed_micros),
      remainingMicros: numOrNull(r.remaining_micros),
      forecastMicros: numOrNull(r.forecast_micros),
      level: r.level ?? null,
      periodStart: iso(r.period_start),
      computedAt: iso(r.computed_at),
      setBy: r.set_by,
    }),
  )
}

/** Forecast advice for the owner, from `v_budgets`; the governor never acts on it. */
export async function readAdvice(q: Queryable): Promise<SpendGovernorAdvice[]> {
  return advise(await readBudgets(q))
}
