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
  processedJobIds: number[]
  totalSearches: number
  degradedSearches: number
  breakerTrips: number
  newOperationIds: string[]
  sellerBlockPages: boolean[]
  alerted: SourceHealthAlertReason[]
}

export const emptyHealthDay = (): HealthDayTotals => ({
  processedJobIds: [],
  totalSearches: 0,
  degradedSearches: 0,
  breakerTrips: 0,
  newOperationIds: [],
  sellerBlockPages: [],
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
 * Folds one collected job into a day's running totals. Idempotent (rule 8): a `jobId` already in
 * `processedJobIds` returns `existing` unchanged, so a replayed `apify-gateway.run-collected`
 * event adds nothing twice.
 */
export function mergeHealthDay(existing: HealthDayTotals, batch: HealthDayBatch): HealthDayTotals {
  if (existing.processedJobIds.includes(batch.jobId)) return existing
  const { total, degraded } = countDegraded(batch.searches)
  return {
    processedJobIds: [...existing.processedJobIds, batch.jobId],
    totalSearches: existing.totalSearches + total,
    degradedSearches: existing.degradedSearches + degraded,
    breakerTrips: existing.breakerTrips + (batch.breakerTripped ? 1 : 0),
    newOperationIds: Array.from(new Set([...existing.newOperationIds, ...batch.newOperationIds])),
    sellerBlockPages: [...existing.sellerBlockPages, ...pagesOf(batch.sellerPresence)],
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

export type RampAdvanceReason = 'too-soon' | 'degraded-rate-rose' | 'held-or-improved' | 'max-stage'

export interface RampAdvanceDecision {
  advance: boolean
  reason: RampAdvanceReason
  nextStage?: number
}

/**
 * Whether the ramp may move to its next stage now (card: "Holds the ramp stage: volume rises in
 * steps of 24-48 hours, and only while 302s and fallbacks do not rise",
 * `fb-scrap-engine/docs/design/SCALE_PLAN.md:111-113`). `previousPctDegraded` is the prior day's
 * degraded share, or `null` when there is none recorded yet — missing history never blocks the
 * first advance.
 */
export function decideRampAdvance(
  current: RampState,
  now: Date,
  todayPctDegraded: number,
  previousPctDegraded: number | null,
  stages: readonly SourceHealthRampStageConfig[] = SOURCE_HEALTH_RAMP_STAGES,
): RampAdvanceDecision {
  if (current.stage >= stages.length - 1) return { advance: false, reason: 'max-stage' }
  const hoursAtStage = (now.getTime() - current.startedAt.getTime()) / 3_600_000
  if (hoursAtStage < stages[current.stage].minHoursAtStage) {
    return { advance: false, reason: 'too-soon' }
  }
  if (previousPctDegraded !== null && todayPctDegraded > previousPctDegraded) {
    return { advance: false, reason: 'degraded-rate-rose' }
  }
  return { advance: true, reason: 'held-or-improved', nextStage: current.stage + 1 }
}
