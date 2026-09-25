// Pure logic: no I/O, no database, no clock or randomness passed in implicitly
// (docs/design/modules/_rules.md, folder shape). Implements docs/design/modules/source-health.md:
// the day's tally, the alert threshold, and the ramp's advance rule.
import {
  SOURCE_HEALTH_ALERT_PCT_DEGRADED,
  SOURCE_HEALTH_PAGE_SIZE,
  SOURCE_HEALTH_RAMP_STAGES,
  type SourceHealthRampStageConfig,
} from '@nabvy/config/modules/source-health'
import type { SourceHealthAlertReason } from '@nabvy/contracts/modules/source-health'

/** Routes run-coverage reports that count as degraded (card: "searches on browser-fallback or failed"). */
const DEGRADED_ROUTES = new Set(['browser-fallback', 'failed'])

/** A configured ramp stage by index, or throws — `SOURCE_HEALTH_RAMP_STAGES` is validated non-empty by config. */
export function rampStageAt(
  stages: readonly SourceHealthRampStageConfig[],
  index: number,
): SourceHealthRampStageConfig {
  const stage = stages[index]
  if (!stage) throw new Error(`source-health: no ramp stage configured at index ${index}`)
  return stage
}

/** Europe/London calendar day of a timestamp, `YYYY-MM-DD` (en-CA gives that format directly). */
const LONDON_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function londonDay(at: string | Date): string {
  return LONDON_DAY.format(typeof at === 'string' ? new Date(at) : at)
}

/**
 * The calendar day `days` before (or, negative, after) a `YYYY-MM-DD` day. Arithmetic on the
 * calendar, not on the clock: on the clocks-forward Sunday `now - 24h` is still the day before
 * yesterday for an hour, whereas a day minus one calendar day is always yesterday.
 */
export function dayBefore(day: string, days = 1): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error(`source-health: not a calendar day: ${day}`)
  const noon = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - days, 12)
  return new Date(noon).toISOString().slice(0, 10)
}

export interface SearchOutcome {
  route: string
}

export function countDegraded(searches: readonly SearchOutcome[]): {
  total: number
  degraded: number
} {
  const total = searches.length
  const degraded = searches.reduce((n, s) => n + (DEGRADED_ROUTES.has(s.route) ? 1 : 0), 0)
  return { total, degraded }
}

export function pctDegradedOf(total: number, degraded: number): number {
  return total === 0 ? 0 : degraded / total
}

export function isDegradedSpike(
  pct: number,
  threshold: number = SOURCE_HEALTH_ALERT_PCT_DEGRADED,
): boolean {
  return pct > threshold
}

/**
 * Groups presence flags (apify-gateway's `v_seller_presence` rows, in seq order — they carry no
 * page field, `fb-scrap-engine/docs/design/SELLER_DATA.md:38-41`) into pages of `pageSize`, and
 * flags a page as a seller-block page when any of its rows lack a seller object
 * (docs/questions/source-health.md, "what counts as a seller block page").
 */
export function pagesOf(
  presence: readonly boolean[],
  pageSize: number = SOURCE_HEALTH_PAGE_SIZE,
): boolean[] {
  const pages: boolean[] = []
  for (let i = 0; i < presence.length; i += pageSize) {
    pages.push(presence.slice(i, i + pageSize).some((present) => !present))
  }
  return pages
}

export interface HealthDayTotals {
  totalSearches: number
  degradedSearches: number
  breakerTrips: number
  newOperationIds: string[]
  blockedPages: boolean[]
  alerted: SourceHealthAlertReason[]
}

export const emptyHealthDay = (): HealthDayTotals => ({
  totalSearches: 0,
  degradedSearches: 0,
  breakerTrips: 0,
  newOperationIds: [],
  blockedPages: [],
  alerted: [],
})

export interface HealthDayBatch {
  jobId: number
  searches: readonly SearchOutcome[]
  /** True when this job's region read `circuit-open` on route-health's `v_decisions` (see
   * docs/questions/source-health.md, "counting breaker trips"). */
  breakerTripped: boolean
  /** route-health's `v_decisions.newQueryIds` for this job's region, already computed by it. */
  newOperationIds: readonly string[]
  /** apify-gateway's `v_seller_presence.present`, in `seq` order, for this job. */
  sellerPresence: readonly boolean[]
}

/**
 * Folds one collected job into a day's running totals: the pure form of the SQL increments the
 * repo runs (`addJobToDay`), used by the fixtures and the domain tests. Replay protection is not
 * here: the repo dedupes on the job ID in `processed_jobs` before it increments anything (rule 8;
 * README, "Decisions"), so a replayed `apify-gateway.run-collected` never reaches these sums.
 */
export function mergeHealthDay(existing: HealthDayTotals, batch: HealthDayBatch): HealthDayTotals {
  const { total, degraded } = countDegraded(batch.searches)
  return {
    totalSearches: existing.totalSearches + total,
    degradedSearches: existing.degradedSearches + degraded,
    breakerTrips: existing.breakerTrips + (batch.breakerTripped ? 1 : 0),
    newOperationIds: Array.from(new Set([...existing.newOperationIds, ...batch.newOperationIds])),
    blockedPages: [...existing.blockedPages, ...pagesOf(batch.sellerPresence)],
    alerted: existing.alerted,
  }
}

/**
 * Alert reasons a day's totals cross that have not already fired today (`totals.alerted`). Card,
 * "Starting alert value": more than `threshold` of the day's searches degraded; the card's second
 * alert path is a new Facebook operation ID.
 */
export function evaluateAlert(
  totals: HealthDayTotals,
  threshold: number = SOURCE_HEALTH_ALERT_PCT_DEGRADED,
): SourceHealthAlertReason[] {
  const pct = pctDegradedOf(totals.totalSearches, totals.degradedSearches)
  const reasons: SourceHealthAlertReason[] = []
  if (isDegradedSpike(pct, threshold) && !totals.alerted.includes('degraded-spike')) {
    reasons.push('degraded-spike')
  }
  if (totals.newOperationIds.length > 0 && !totals.alerted.includes('new-operation-id')) {
    reasons.push('new-operation-id')
  }
  return reasons
}

export interface RampState {
  stage: number
  startedAt: Date
}

/** What the ramp reads of a complete day (from `v_health`): its degraded share and its alerts. */
export interface RampDayRead {
  pctDegraded: number
  alerted: readonly SourceHealthAlertReason[]
}

export type RampAdvanceReason =
  | 'too-soon'
  | 'max-stage'
  | 'no-baseline'
  | 'alerted'
  | 'degraded'
  | 'degraded-rate-rose'
  | 'held-or-improved'

export interface RampAdvanceDecision {
  advance: boolean
  reason: RampAdvanceReason
  nextStage?: number
}

/**
 * Whether the ramp may move to its next stage now (card: "Holds the ramp stage: volume rises in
 * steps of 24-48 hours, and only while 302s and fallbacks do not rise",
 * `fb-scrap-engine/docs/design/SCALE_PLAN.md:111-113`). `yesterday` and `dayBefore` are the two
 * most recent complete days, or `null` when that day has no row. The rule refuses, in this order:
 * at the last stage; before the stage's minimum hold time; without both days (a rise can only be
 * judged against a baseline, so missing history never advances); when yesterday alerted for any
 * reason; when yesterday's degraded share is above the alert threshold (a day that is degraded
 * throughout is not "not rising", it is already bad); when yesterday's share is above the day
 * before's. Otherwise it advances by one stage.
 */
export function decideRampAdvance(
  current: RampState,
  now: Date,
  yesterday: RampDayRead | null,
  dayBefore: RampDayRead | null,
  stages: readonly SourceHealthRampStageConfig[] = SOURCE_HEALTH_RAMP_STAGES,
  threshold: number = SOURCE_HEALTH_ALERT_PCT_DEGRADED,
): RampAdvanceDecision {
  const config = stages[current.stage]
  if (current.stage >= stages.length - 1 || !config) return { advance: false, reason: 'max-stage' }
  const hoursAtStage = (now.getTime() - current.startedAt.getTime()) / 3_600_000
  if (hoursAtStage < config.minHoursAtStage) {
    return { advance: false, reason: 'too-soon' }
  }
  if (yesterday === null || dayBefore === null) return { advance: false, reason: 'no-baseline' }
  if (yesterday.alerted.length > 0) return { advance: false, reason: 'alerted' }
  if (isDegradedSpike(yesterday.pctDegraded, threshold)) {
    return { advance: false, reason: 'degraded' }
  }
  if (yesterday.pctDegraded > dayBefore.pctDegraded) {
    return { advance: false, reason: 'degraded-rate-rose' }
  }
  return { advance: true, reason: 'held-or-improved', nextStage: current.stage + 1 }
}
