// Pure rules of the seller-reply-reports module (too-good-to-be-true design §3.1-3.3): the open
// gate, eligibility, the weight, whether each reason counts, and the evidence per listing and
// family. No I/O: the repo loads the inputs and the entry points in ../index.ts write the results.
import { createHash } from 'node:crypto'
import {
  SELLER_REPLY_REPORTS_BURST_COUNT,
  SELLER_REPLY_REPORTS_BURST_WINDOW_HOURS,
  SELLER_REPLY_REPORTS_COLLECTION_ELSEWHERE_MIN_KM,
  SELLER_REPLY_REPORTS_EDIT_WINDOW_HOURS,
  SELLER_REPLY_REPORTS_GEM_BURST_COUNT,
  SELLER_REPLY_REPORTS_GEM_BURST_WINDOW_HOURS,
  SELLER_REPLY_REPORTS_MAX_DAYS_AFTER_OPEN,
  SELLER_REPLY_REPORTS_MIN_ACCOUNT_AGE_DAYS,
  SELLER_REPLY_REPORTS_MIN_MINUTES_AFTER_OPEN,
  SELLER_REPLY_REPORTS_MULTIPLE_LEVEL_MIN_WEIGHT,
  SELLER_REPLY_REPORTS_RATE_PER_DAY,
  SELLER_REPLY_REPORTS_RATE_PER_HOUR,
  SELLER_REPLY_REPORTS_REPORT_THEN_BUY_DAYS,
  SELLER_REPLY_REPORTS_REPORTED_VALUE_MIN_PEOPLE,
  SELLER_REPLY_REPORTS_SINGLE_LEVEL_MIN_WEIGHT,
} from '@nabvy/config/modules/seller-reply-reports'
import type {
  SellerReplyReportsCounts,
  SellerReplyReportsDistanceBand,
  SellerReplyReportsEligibility,
  SellerReplyReportsFamily,
  SellerReplyReportsHoldReason,
  SellerReplyReportsLevel,
  SellerReplyReportsOutcome,
  SellerReplyReportsReason,
  SellerReplyReportsReasonInput,
  SellerReplyReportsScope,
  SellerReplyReportsStatus,
} from '@nabvy/contracts/modules/seller-reply-reports'

/** Bumped whenever a rule below changes what the aggregator writes (rule 8). */
export const RULE_VERSION = 'seller-reply-reports@1'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The family a reason counts towards (design §3.1); `other` and `as_listed` belong to none. */
export function familyOf(reason: SellerReplyReportsReason): SellerReplyReportsFamily | null {
  switch (reason) {
    case 'collection_elsewhere':
      return 'location'
    case 'postage_only':
      return 'handover'
    case 'payment_first':
      return 'payment'
    case 'link_or_fb_delivery':
      return 'link'
    case 'not_as_described':
      return 'item'
    default:
      return null
  }
}

/** The stored columns of one tapped chip: its follow-up answer as `detail` or `second_answer`. */
export interface StoredReason {
  reason: SellerReplyReportsReason
  detail: string | null
  secondAnswer: string | null
  reportedPlaceId: string | null
}

export function storedReason(input: SellerReplyReportsReasonInput): StoredReason {
  switch (input.reason) {
    case 'collection_elsewhere':
      return {
        reason: input.reason,
        detail: null,
        // Not answered is read as "Didn't ask" (§6.4).
        secondAnswer: input.canSeeAndPay ?? 'didnt_ask',
        reportedPlaceId: input.placeId,
      }
    case 'postage_only':
      return {
        reason: input.reason,
        detail: null,
        secondAnswer: input.paidHow,
        reportedPlaceId: null,
      }
    case 'payment_first':
    case 'link_or_fb_delivery':
    case 'not_as_described':
      return { reason: input.reason, detail: input.kind, secondAnswer: null, reportedPlaceId: null }
    default:
      return { reason: input.reason, detail: null, secondAnswer: null, reportedPlaceId: null }
  }
}

/** The 5-minute to 14-day open gate (§3.1). `undefined`: no open record for this user and listing. */
export function openGate(
  firstOpenedAt: Date | undefined,
  now: Date,
): 'eligible' | 'no_open' | 'too_soon' | 'too_late' {
  if (!firstOpenedAt) return 'no_open'
  const since = now.getTime() - firstOpenedAt.getTime()
  if (since < SELLER_REPLY_REPORTS_MIN_MINUTES_AFTER_OPEN * MINUTE) return 'too_soon'
  if (since > SELLER_REPLY_REPORTS_MAX_DAYS_AFTER_OPEN * DAY) return 'too_late'
  return 'eligible'
}

/** What a listing looks like to the gate. `null` is unknown, never "no" (rule 11). */
export interface GateFacts {
  firstOpenedAt: Date | undefined
  messagingEnabled: boolean | null
  suppressed: boolean
  noise: boolean
  active: boolean
}

/** Whether the report sheet may be offered (§3.1): the first failing check, or `eligible`. */
export function sheetGate(facts: GateFacts, now: Date): SellerReplyReportsEligibility {
  if (!facts.active) return 'not_active'
  if (facts.suppressed) return 'suppressed'
  if (facts.noise) return 'noise'
  if (facts.messagingEnabled === false) return 'messaging_off'
  return openGate(facts.firstOpenedAt, now)
}

/** Whether a report may still be edited (24 h, §3.2). Withdrawing has no window. */
export function editWindowOpen(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= SELLER_REPLY_REPORTS_EDIT_WINDOW_HOURS * HOUR
}

/** Whole days since `createdAt`, rounded down. */
export function accountAgeDays(createdAt: Date, now: Date): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / DAY)
}

/** 1.0 for an established account (30 days or more), 0 below (§3.2): younger accounts never count. */
export function ageFactor(createdAt: Date | null, now: Date): number {
  if (!createdAt) return 0
  return accountAgeDays(createdAt, now) >= SELLER_REPLY_REPORTS_MIN_ACCOUNT_AGE_DAYS ? 1 : 0
}

/** The Beta-reputation accuracy factor `2 (u + 1) / (u + n + 2)`, capped at 1 (§3.2). */
export function accuracyFactor(upheld: number, notUpheld: number): number {
  return Math.min(1, (2 * (upheld + 1)) / (upheld + notUpheld + 2))
}

/** `age × accuracy`, capped at 1 and stored to two decimals (numeric(3,2)), rounded down. */
export function reportWeight(
  createdAt: Date | null,
  stats: { upheld: number; notUpheld: number },
  now: Date,
): number {
  const w = Math.min(1, ageFactor(createdAt, now) * accuracyFactor(stats.upheld, stats.notUpheld))
  return Math.floor(w * 100 + 1e-9) / 100
}

/** What the aggregator knows about a reporter. `null`: unknown, which is read conservatively. */
export interface ReporterFacts {
  accountCreatedAt: Date | null
  emailVerified: boolean | null
  active: boolean
  tester: boolean
  upheld: number
  notUpheld: number
}

/**
 * The first check a report fails (§3.2), else `eligible`. Unknown email verification or account
 * age is read as the failing side: a report never counts on a fact nobody could confirm.
 */
export function eligibilityOf(
  reporter: ReporterFacts,
  priorReports: { lastHour: number; lastDay: number },
  inBurst: boolean,
  now: Date,
): SellerReplyReportsEligibility {
  if (reporter.tester) return 'tester'
  if (!reporter.active) return 'not_active'
  if (reporter.emailVerified !== true) return 'email_unverified'
  if (ageFactor(reporter.accountCreatedAt, now) === 0) return 'too_new'
  if (
    priorReports.lastHour >= SELLER_REPLY_REPORTS_RATE_PER_HOUR ||
    priorReports.lastDay >= SELLER_REPLY_REPORTS_RATE_PER_DAY
  ) {
    return 'rate_limited'
  }
  if (inBurst) return 'burst_hold'
  return 'eligible'
}

/** The distance band between a listing's display place and a reported place (ASCII codes). */
export function distanceBand(km: number | null): SellerReplyReportsDistanceBand {
  if (km === null || !Number.isFinite(km)) return 'unknown'
  if (km < 10) return 'lt_10'
  if (km < 25) return '10_25'
  if (km < 50) return '25_50'
  if (km < 100) return '50_100'
  return '100_plus'
}

/** The listing-side facts a reason is checked against (§3.1). `null`: unknown. */
export interface ReasonContext {
  /** km from the listing the evidence is for to the reported place, when both points are known. */
  distanceKm: number | null
  /** The listing's `shippingOffered` recorded with the report. */
  shippingOffered: boolean | null
  /** warning-signs or parts-record says faulty, for parts, untested, sold as seen or a part missing. */
  itemFaultStated: boolean
}

/** Whether a stored reason counts (§3.1): in every path, only in path B, or never. */
export function reasonCounts(reason: StoredReason, ctx: ReasonContext): SellerReplyReportsCounts {
  switch (reason.reason) {
    case 'collection_elsewhere': {
      // "Didn't say" where: path B only. A place with no measurable distance cannot be checked.
      if (reason.reportedPlaceId === null) return 'path_b_only'
      if (
        ctx.distanceKm === null ||
        ctx.distanceKm < SELLER_REPLY_REPORTS_COLLECTION_ELSEWHERE_MIN_KM
      ) {
        return 'none'
      }
      if (reason.secondAnswer === 'no') return 'any_path'
      if (reason.secondAnswer === 'yes') return 'none'
      return 'path_b_only'
    }
    case 'postage_only':
      if (ctx.shippingOffered === true) return 'none'
      if (reason.secondAnswer === 'protected') return 'none'
      return 'any_path'
    case 'payment_first':
    case 'link_or_fb_delivery':
      return 'any_path'
    case 'not_as_described':
      if (reason.detail === 'faulty_or_missing_parts' && ctx.itemFaultStated) return 'none'
      return 'any_path'
    default:
      return 'none'
  }
}

/** Whether a "bought" verdict falls inside the report-then-buy window after the report (§3.3). */
export function isReportThenBuy(reportedAt: Date, boughtAt: Date | undefined): boolean {
  if (!boughtAt) return false
  const after = boughtAt.getTime() - reportedAt.getTime()
  return after >= 0 && after <= SELLER_REPLY_REPORTS_REPORT_THEN_BUY_DAYS * DAY
}

/** Whether `times` holds `count` or more within any window of `windowMs` (a sliding window). */
export function hasBurst(times: Date[], count: number, windowMs: number): boolean {
  if (times.length < count) return false
  const sorted = times.map((t) => t.getTime()).sort((a, b) => a - b)
  for (let i = 0; i + count - 1 < sorted.length; i++) {
    const last = sorted[i + count - 1] as number
    if (last - (sorted[i] as number) <= windowMs) return true
  }
  return false
}

/** The burst reasons for one listing or cluster (§3.3): the gem burst wins over the plain one. */
export function burstOf(times: Date[], gem: boolean): SellerReplyReportsHoldReason | null {
  if (
    gem &&
    hasBurst(
      times,
      SELLER_REPLY_REPORTS_GEM_BURST_COUNT,
      SELLER_REPLY_REPORTS_GEM_BURST_WINDOW_HOURS * HOUR,
    )
  ) {
    return 'gem_burst'
  }
  if (
    hasBurst(
      times,
      SELLER_REPLY_REPORTS_BURST_COUNT,
      SELLER_REPLY_REPORTS_BURST_WINDOW_HOURS * HOUR,
    )
  ) {
    return 'burst'
  }
  return null
}

/** One counted contribution to a family on the listing the evidence is for. */
export interface Contribution {
  reportId: string
  /** account-integrity's linked group (or the user's own ID): a group counts once. */
  personKey: string
  weight: number
  counts: SellerReplyReportsCounts
  placeId: string | null
  band: SellerReplyReportsDistanceBand | null
}

export interface FamilyEvidence {
  persons: number
  weightSum: number
  level: SellerReplyReportsLevel
  placeId: string | null
  distanceBand: SellerReplyReportsDistanceBand | null
}

/** The level for a summed weight and a count of independent people (§3.2). */
export function levelOf(weightSum: number, persons: number): SellerReplyReportsLevel {
  if (weightSum >= SELLER_REPLY_REPORTS_MULTIPLE_LEVEL_MIN_WEIGHT - 1e-9 && persons >= 2)
    return 'multiple'
  if (weightSum >= SELLER_REPLY_REPORTS_SINGLE_LEVEL_MIN_WEIGHT - 1e-9) return 'single'
  return 'none'
}

/** Groups contributions by person, keeping each person's lowest weight (§3.2). */
function perPerson(contributions: Contribution[]): Map<string, Contribution> {
  const out = new Map<string, Contribution>()
  for (const c of contributions) {
    const prev = out.get(c.personKey)
    if (!prev || c.weight < prev.weight) out.set(c.personKey, c)
  }
  return out
}

/**
 * The evidence of one family on one listing: only `any_path` contributions count towards the
 * level (path-B-only reasons are stored for review; README.md, "Decisions"). A person, or a
 * linked group, counts once at their lowest weight. A reported place and its distance band are
 * published only when `reportedValueMinPeople` people gave the same one (§4.3).
 */
export function familyEvidence(contributions: Contribution[]): FamilyEvidence {
  const people = perPerson(contributions.filter((c) => c.counts === 'any_path' && c.weight > 0))
  const weightSum = round2([...people.values()].reduce((sum, c) => sum + c.weight, 0))
  const persons = people.size
  let placeId: string | null = null
  let band: SellerReplyReportsDistanceBand | null = null
  const byPlace = new Map<string, { n: number; band: SellerReplyReportsDistanceBand | null }>()
  for (const c of people.values()) {
    if (!c.placeId) continue
    const entry = byPlace.get(c.placeId) ?? { n: 0, band: c.band }
    entry.n += 1
    byPlace.set(c.placeId, entry)
  }
  for (const [id, entry] of [...byPlace.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.n >= SELLER_REPLY_REPORTS_REPORTED_VALUE_MIN_PEOPLE) {
      placeId = id
      band = entry.band
      break
    }
  }
  return { persons, weightSum, level: levelOf(weightSum, persons), placeId, distanceBand: band }
}

/** Summed counter-report weight, each person once at their lowest weight (§3.2). */
export function counterWeight(contributions: Contribution[]): number {
  const people = perPerson(contributions.filter((c) => c.weight > 0))
  return round2([...people.values()].reduce((sum, c) => sum + c.weight, 0))
}

/**
 * The hold on one evidence row: a burst on the listing or cluster, else a counter-report on a
 * listing that reaches a level (§3.2). Counter-reports never lower the level; they only hold it.
 */
export function holdOf(
  burst: SellerReplyReportsHoldReason | null,
  counter: number,
  level: SellerReplyReportsLevel,
): SellerReplyReportsHoldReason | null {
  if (burst) return burst
  if (counter > 0 && level !== 'none') return 'counter_report'
  return null
}

/** The idempotency key of one evidence row (design §6.6): replays hash the same. */
export function inputsHash(input: {
  listingId: string
  family: SellerReplyReportsFamily
  scope: SellerReplyReportsScope
  contributions: Contribution[]
  counter: number
  memberSetHash: string | null
  hold: SellerReplyReportsHoldReason | null
}): string {
  const parts = input.contributions
    .map(
      (c) =>
        `${c.reportId}:${c.personKey}:${c.weight.toFixed(2)}:${c.counts}:${c.placeId ?? ''}:${c.band ?? ''}`,
    )
    .sort()
  return createHash('sha256')
    .update(
      JSON.stringify([
        RULE_VERSION,
        input.listingId,
        input.family,
        input.scope,
        parts,
        input.counter.toFixed(2),
        input.memberSetHash ?? '',
        input.hold ?? '',
      ]),
    )
    .digest('hex')
}

/** The coarse status shown to the reporter (§3.4): `not_shown` covers every internal cause. */
export function statusOf(input: {
  withdrawn: boolean
  outcome: SellerReplyReportsOutcome | null
  eligibility: SellerReplyReportsEligibility
  helping: boolean
}): SellerReplyReportsStatus {
  if (input.withdrawn) return 'withdrawn'
  if (input.outcome === 'not_upheld' || input.outcome === 'void') return 'removed_after_check'
  if (input.eligibility === 'pending') return 'saved'
  return input.helping ? 'helping_warn' : 'not_shown'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
