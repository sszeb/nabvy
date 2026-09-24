// Pure logic of the spend-governor module: periods, committed spend, forecasts, throttle levels
// and advice. No I/O. Amounts are integer micros of the budget's unit.
import {
  SPEND_GOVERNOR_FORECAST_MIN_ELAPSED_MS,
  SPEND_GOVERNOR_LEVEL_AT_PERCENT,
  SPEND_GOVERNOR_REFRESH_AFTER_MS,
  SPEND_GOVERNOR_SCALE_PLAN_USD_MICROS,
  SPEND_GOVERNOR_VALID_FOR_MS,
} from '@nabvy/config/modules/spend-governor'
import {
  SPEND_GOVERNOR_LEVELS,
  type SpendGovernorAdvice,
  type SpendGovernorLevel,
  type SpendGovernorProvider,
  type SpendGovernorUnit,
} from '@nabvy/contracts/modules/spend-governor'

/** A budget as the governor computes it (a row of `spend_governor.budgets`). */
export interface BudgetDef {
  name: string
  provider: SpendGovernorProvider | null
  unit: SpendGovernorUnit
  limitMicros: number
}

/** A call in cost-meter's ledger (`v_costs`), with the gateway's provisional cost of its run. */
export interface LedgerCall {
  provider: string
  currency: 'USD' | 'GBP'
  reservedMicros: number
  settledMicros: number | null
  reservedGbpMicros: number
  settledGbpMicros: number | null
  /** The gateway's running cost of an unsettled Apify run (`v_jobs.cost_usd`), USD micros. */
  provisionalUsdMicros: number | null
  at: Date
}

/** A gateway run (`v_jobs`, kind `run`) that cost-meter has not recorded yet. */
export interface UnmeteredRun {
  status: string
  started: boolean
  reserveUsdMicros: number
  costUsdMicros: number | null
  settled: boolean
  createdAt: Date
}

/** A settled Apify run's residential proxy traffic; null when it cannot be read. */
export interface ProxyRun {
  proxyGbMicros: number | null
}

/** The throttle row as last written. */
export interface ThrottleState {
  level: SpendGovernorLevel
  since: Date
  periodStart: Date
  committedMicros: number | null
  forecastMicros: number | null
  computedAt: Date
}

const rank = (level: SpendGovernorLevel) => SPEND_GOVERNOR_LEVELS.indexOf(level)

/** The higher of two levels. */
export const maxLevel = (a: SpendGovernorLevel, b: SpendGovernorLevel): SpendGovernorLevel =>
  rank(a) >= rank(b) ? a : b

/** The highest level of a list; an empty list fails closed at `hold-new`. */
export function overallLevel(levels: SpendGovernorLevel[]): SpendGovernorLevel {
  if (levels.length === 0) return 'hold-new'
  return levels.reduce(maxLevel, 'none')
}

/**
 * The level a budget imposes: the highest level whose threshold its committed share has reached.
 * Integer arithmetic, so 80% of 150 000 000 is reached at exactly 120 000 000.
 */
export function levelFor(
  committedMicros: number,
  limitMicros: number,
  at: Record<Exclude<SpendGovernorLevel, 'none'>, number> = SPEND_GOVERNOR_LEVEL_AT_PERCENT,
): SpendGovernorLevel {
  let level: SpendGovernorLevel = 'none'
  for (const candidate of SPEND_GOVERNOR_LEVELS) {
    if (candidate === 'none') continue
    if (committedMicros * 100 >= at[candidate] * limitMicros) level = candidate
  }
  return level
}

/** Parts of a date in Europe/London. */
function londonParts(date: Date): { year: number; month: number; hour: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') }
}

/** Midnight in London on the first of a month, as an instant (London is UTC+0 or UTC+1). */
function londonMonthStartOf(year: number, month: number): Date {
  const utcMidnight = Date.UTC(year, month - 1, 1)
  // At UTC midnight on the 1st, London reads 00:00 (GMT) or 01:00 (BST).
  const offsetHours = londonParts(new Date(utcMidnight)).hour
  return new Date(utcMidnight - offsetHours * 3_600_000)
}

/** The calendar month in Europe/London that `now` falls in: [start, end). The gateway's month. */
export function londonMonth(now: Date): { start: Date; end: Date } {
  const { year, month } = londonParts(now)
  const start = londonMonthStartOf(year, month)
  const end = month === 12 ? londonMonthStartOf(year + 1, 1) : londonMonthStartOf(year, month + 1)
  return { start, end }
}

/** A decimal dollar string (Postgres numeric) in micros, rounded up. */
export function decimalToMicros(value: string): number {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim())
  if (!match) throw new RangeError(`Not a non-negative decimal: ${value}`)
  const [, whole = '0', fraction = ''] = match
  const kept = Number(fraction.slice(0, 6).padEnd(6, '0'))
  const roundUp = /[1-9]/.test(fraction.slice(6)) ? 1 : 0
  return Number(whole) * 1_000_000 + kept + roundUp
}

/** A float quantity (Apify's GB) in micros, rounded up. */
export const floatToMicros = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid quantity ${value}`)
  return Math.ceil(Math.round(value * 1e9) / 1000)
}

const toGbp = (usdMicros: number, usdGbpRate: number) => Math.ceil(usdMicros * usdGbpRate)

const inPeriod = (at: Date, start: Date, end: Date) => at >= start && at < end

const appliesTo = (budget: BudgetDef, provider: string) =>
  budget.provider === null || budget.provider === provider

/**
 * Committed money of a budget this period: settled calls at their settlement, unsettled calls at
 * the larger of their reservation and their provisional cost (supabase/README.md, "Spend";
 * displayed costs have been up to 45% low). Unsettled calls count whatever month they began in,
 * as long as they stay unsettled. Gateway runs cost-meter has not recorded yet count as the
 * gateway counts them: settled at cost, started at the larger of cost and reservation, queued at
 * their reservation.
 */
export function committedMoney(
  budget: BudgetDef,
  period: { start: Date; end: Date },
  calls: LedgerCall[],
  unmetered: UnmeteredRun[],
  usdGbpRate: number,
): number {
  if (budget.unit === 'GB') throw new Error(`${budget.name} counts GB, not money`)
  let total = 0
  for (const call of calls) {
    if (!appliesTo(budget, call.provider)) continue
    const settled = call.settledMicros !== null
    if (settled && !inPeriod(call.at, period.start, period.end)) continue
    const provisional = call.provisionalUsdMicros ?? 0
    if (budget.unit === 'USD') {
      if (call.currency !== 'USD') continue
      total += settled ? (call.settledMicros as number) : Math.max(call.reservedMicros, provisional)
    } else {
      total += settled
        ? (call.settledGbpMicros as number)
        : Math.max(call.reservedGbpMicros, toGbp(provisional, usdGbpRate))
    }
  }
  if (appliesTo(budget, 'apify')) {
    for (const run of unmetered) {
      if (run.settled && !inPeriod(run.createdAt, period.start, period.end)) continue
      const usd = run.settled
        ? (run.costUsdMicros ?? 0)
        : run.started || run.status === 'running'
          ? Math.max(run.costUsdMicros ?? 0, run.reserveUsdMicros)
          : run.status === 'pending'
            ? run.reserveUsdMicros
            : 0
      total += budget.unit === 'USD' ? usd : toGbp(usd, usdGbpRate)
    }
  }
  return total
}

/** Residential proxy GB of the period's settled runs; null if any run's traffic is unknown. */
export function committedProxy(runs: ProxyRun[]): number | null {
  let total = 0
  for (const run of runs) {
    if (run.proxyGbMicros === null) return null
    total += run.proxyGbMicros
  }
  return total
}

/**
 * The period's end-of-month projection at the rate so far: committed × period length ÷ time
 * elapsed, with at least `minElapsedMs` elapsed so one early run does not forecast a month of them.
 */
export function forecast(
  committedMicros: number,
  period: { start: Date; end: Date },
  now: Date,
  minElapsedMs: number = SPEND_GOVERNOR_FORECAST_MIN_ELAPSED_MS,
): number {
  const length = period.end.getTime() - period.start.getTime()
  const elapsed = Math.min(length, Math.max(minElapsedMs, now.getTime() - period.start.getTime()))
  return Math.ceil((committedMicros * length) / elapsed)
}

/** The next throttle state of a budget, from its committed spend (null: cannot be measured). */
export function nextState(
  budget: BudgetDef,
  committedMicros: number | null,
  period: { start: Date; end: Date },
  now: Date,
): Omit<ThrottleState, 'since'> {
  if (committedMicros === null) {
    return {
      level: 'none',
      periodStart: period.start,
      committedMicros: null,
      forecastMicros: null,
      computedAt: now,
    }
  }
  return {
    level: levelFor(committedMicros, budget.limitMicros),
    periodStart: period.start,
    committedMicros,
    forecastMicros: forecast(committedMicros, period, now),
    computedAt: now,
  }
}

/**
 * What a recompute does with one budget. It writes when anything but the time changed, or when the
 * row is due a refresh; `since` moves only when the level changes. It alerts when the level rises
 * above `none`, or a new period starts above `none`; the key makes each level one alert per period.
 */
export function plan(
  prev: ThrottleState | null,
  next: Omit<ThrottleState, 'since'>,
  refreshAfterMs: number = SPEND_GOVERNOR_REFRESH_AFTER_MS,
): { write: boolean; since: Date; alert: boolean } {
  const samePeriod = prev !== null && prev.periodStart.getTime() === next.periodStart.getTime()
  const sameLevel = prev !== null && samePeriod && prev.level === next.level
  const since = sameLevel && prev ? prev.since : next.computedAt
  const changed =
    !sameLevel ||
    prev?.committedMicros !== next.committedMicros ||
    prev?.forecastMicros !== next.forecastMicros
  const due =
    prev !== null && next.computedAt.getTime() - prev.computedAt.getTime() >= refreshAfterMs
  const alert =
    rank(next.level) > 0 && (!samePeriod || rank(next.level) > rank((prev as ThrottleState).level))
  return { write: changed || due, since, alert }
}

/** When a written row stops being trusted. */
export const validUntil = (computedAt: Date, validForMs: number = SPEND_GOVERNOR_VALID_FOR_MS) =>
  new Date(computedAt.getTime() + validForMs)

/** The idempotency key of an alert: one per budget, period and level (rule 8). */
export const alertKey = (budget: string, periodStart: string, level: SpendGovernorLevel) =>
  `spend-governor.budget-alerted:${budget}@${periodStart}@${level}`

/**
 * Advice for the owner (the governor never acts on it): a forecast over a budget's limit, and a
 * monthly Apify forecast at which the Scale plan may pay (SCALE_PLAN.md:84-86), reported once.
 */
export function advise(
  budgets: (BudgetDef & { forecastMicros: number | null })[],
  scalePlanUsdMicros: number = SPEND_GOVERNOR_SCALE_PLAN_USD_MICROS,
): SpendGovernorAdvice[] {
  const advice: SpendGovernorAdvice[] = []
  let scaleReported = false
  for (const b of budgets) {
    if (b.forecastMicros === null) continue
    if (b.forecastMicros > b.limitMicros) {
      advice.push({
        budget: b.name,
        advice: 'forecast-over-limit',
        forecastMicros: b.forecastMicros,
        limitMicros: b.limitMicros,
      })
    }
    if (
      !scaleReported &&
      b.provider === 'apify' &&
      b.unit === 'USD' &&
      b.forecastMicros >= scalePlanUsdMicros
    ) {
      scaleReported = true
      advice.push({
        budget: b.name,
        advice: 'scale-plan-may-pay',
        forecastMicros: b.forecastMicros,
        limitMicros: b.limitMicros,
      })
    }
  }
  return advice
}
