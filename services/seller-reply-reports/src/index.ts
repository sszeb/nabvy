// Public API of the seller-reply-reports module: the functions other modules, procedures and
// tasks may call. Other modules import from '@nabvy/seller-reply-reports' only, never from its
// internals. It takes one-tap reports of what a seller told a buyer, weighs them, and publishes
// evidence per listing and family for suspected-labels (README.md). It labels nothing.
import { createHash } from 'node:crypto'
import { isActive } from '@nabvy/account'
import {
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
  type Source,
} from '@nabvy/contracts'
import type { LocationPoint } from '@nabvy/contracts/modules/location'
import {
  events,
  SellerReplyReportsCanReportInput,
  SellerReplyReportsEditInput,
  type SellerReplyReportsEligibility,
  type SellerReplyReportsError,
  type SellerReplyReportsFamily,
  type SellerReplyReportsHoldReason,
  type SellerReplyReportsOutcome,
  SellerReplyReportsResolveInput,
  type SellerReplyReportsScope,
  SellerReplyReportsSubmitInput,
  SellerReplyReportsWithdrawInput,
} from '@nabvy/contracts/modules/seller-reply-reports'
import type { Queryable } from '@nabvy/db'
import { distanceKm } from '@nabvy/location'
import { pointsFor } from '@nabvy/pickup-location'
import { state } from '@nabvy/switches'
import {
  burstOf,
  type Contribution,
  counterWeight,
  distanceBand,
  editWindowOpen,
  eligibilityOf,
  familyEvidence,
  familyOf,
  holdOf,
  inputsHash,
  isReportThenBuy,
  type ReasonContext,
  RULE_VERSION,
  reasonCounts,
  reportWeight,
  sheetGate,
  statusOf,
  storedReason,
} from './domain'
import * as repo from './repo'

export { events, module } from '@nabvy/contracts/modules/seller-reply-reports'
export {
  onAccountDeleted,
  onCopyAdvertClustered,
  onListingFeedbackRecorded,
  onPickupLocationChanged,
  onRecorded,
  onStandingChanged,
} from './handlers'
export { RULE_VERSION }

const MODULE = 'seller-reply-reports'

/** What notifier's open record says about one listing for one user (`v_alert_open_context`). */
export interface OpenRecord {
  openVia: string
  firstOpenedAt: Date
}

/** The listing flags recorded with a report (detail-evidence; §3.1). `null`: unknown. */
export interface ListingFlags {
  messagingEnabled: boolean | null
  shippingOffered: boolean | null
  checkoutEnabled: boolean | null
  cardHash: string | null
  evidenceHash: string | null
}

/**
 * Everything this module reads from other modules, injected so an unmerged provider is a seam
 * with a conservative default (docs/session-conventions.md, "Soft edges";
 * docs/questions/seller-reply-reports.md). Every function takes a batch.
 */
export interface SellerReplyReportsDeps {
  /** notifier's open record (not merged): default none, so the sheet is never offered. */
  openRecords(q: Queryable, userId: string, listingIds: string[]): Promise<Map<string, OpenRecord>>
  /** detail-evidence's messaging, shipping and checkout flags (not published yet): default unknown. */
  listingFlags(q: Queryable, listingIds: string[]): Promise<Map<string, ListingFlags>>
  /** noise-filter's wanted, service and buy-in adverts (not merged): default none. */
  noiseListings(q: Queryable, listingIds: string[]): Promise<Set<string>>
  /** Account age, email verification and standing. Unknown email verification never counts. */
  reporterAccounts(
    q: Queryable,
    userIds: string[],
  ): Promise<
    Map<string, { createdAt: Date | null; emailVerified: boolean | null; active: boolean }>
  >
  /** account-integrity's `linkedGroupOf()` (soft): default each user is their own group. */
  linkedGroupOf(q: Queryable, userIds: string[]): Promise<Map<string, string>>
  /** listing-feedback's `v_bought_for_reports`, keyed `user|listing`. */
  boughtAt(q: Queryable, userIds: string[]): Promise<Map<string, Date>>
  /** copy-advert's confirmed clusters (`v_members`), keyed by member listing. */
  clusters(q: Queryable, listingIds: string[]): Promise<Map<string, repo.ClusterRow>>
  /** copy-advert's possible originals (not published): default none. They never receive spread reports. */
  possibleOriginals(q: Queryable, listingIds: string[]): Promise<Set<string>>
  /** Each listing's display point (pickup-location's `pointsFor`). */
  listingPoints(q: Queryable, listingIds: string[]): Promise<Map<string, LocationPoint>>
  /** Each reported place's gazetteer point. */
  placePoints(q: Queryable, placeIds: string[]): Promise<Map<string, LocationPoint>>
  /** asking-price-position's gem candidates (not built): default none. */
  gemCandidates(q: Queryable, listingIds: string[]): Promise<Set<string>>
  /** warning-signs and parts-record fault facts (soft, not published): default none. */
  itemFaultStated(q: Queryable, listingIds: string[]): Promise<Set<string>>
  /** T1 of each listing (listing-ingest). */
  firstFetchedAt(q: Queryable, listingIds: string[]): Promise<Map<string, Date>>
}

export const defaultDeps: SellerReplyReportsDeps = {
  openRecords: async () => new Map(),
  listingFlags: async () => new Map(),
  noiseListings: async () => new Set(),
  async reporterAccounts(q, userIds) {
    const facts = await repo.selectAccountFacts(q, userIds)
    // No published view carries email verification yet: unknown, which never counts.
    return new Map([...facts].map(([id, f]) => [id, { ...f, emailVerified: null }]))
  },
  linkedGroupOf: async (_q, userIds) => new Map(userIds.map((id) => [id, id])),
  boughtAt: repo.selectBought,
  clusters: repo.selectClusters,
  possibleOriginals: async () => new Set(),
  async listingPoints(q, listingIds) {
    const points = await pointsFor(q, listingIds)
    return new Map([...points].map(([id, p]) => [id, p.point]))
  },
  placePoints: repo.selectPlacePoints,
  gemCandidates: async () => new Set(),
  itemFaultStated: async () => new Set(),
  firstFetchedAt: repo.selectFirstFetched,
}

function refuse(code: SellerReplyReportsError['code'], message: string) {
  return err<SellerReplyReportsError>({ code, message })
}

// ---------------------------------------------------------------------------------------------
// The reporter's calls (nabvy_app, inside withUser)
// ---------------------------------------------------------------------------------------------

export interface CanReportAnswer {
  listingId: string
  /** Whether the sheet may be offered. */
  allowed: boolean
  /** The user's existing report on the listing, if any (one per user per listing). */
  reportId: string | null
}

/**
 * Whether the report sheet may be offered on each listing (§3.1): notifier's open 5 minutes to
 * 14 days ago, messaging not off, not suppressed or noise, an active account; in shadow, to
 * testers only (design §6.2). The internal reason is never returned.
 */
export async function canReport(
  q: Queryable,
  rawInput: SellerReplyReportsCanReportInput,
  deps: SellerReplyReportsDeps = defaultDeps,
  options: { now?: Date } = {},
): Promise<Result<CanReportAnswer[], SellerReplyReportsError>> {
  const parsed = SellerReplyReportsCanReportInput.safeParse(rawInput)
  if (!parsed.success) return refuse('seller-reply-reports.invalid_input', parsed.error.message)
  const gates = await gatesFor(
    q,
    parsed.data.userId,
    parsed.data.listingIds,
    deps,
    options.now ?? new Date(),
  )
  if (!gates.ok) return gates
  const own = await repo.selectOwnReports(q, { listingIds: parsed.data.listingIds })
  const byListing = new Map(own.map((r) => [r.listingId, r.id]))
  return ok(
    [...new Set(parsed.data.listingIds)].map((listingId) => ({
      listingId,
      allowed: gates.value.get(listingId)?.gate === 'eligible',
      reportId: byListing.get(listingId) ?? null,
    })),
  )
}

async function gatesFor(
  q: Queryable,
  userId: string,
  listingIds: string[],
  deps: SellerReplyReportsDeps,
  now: Date,
): Promise<
  Result<
    Map<string, { gate: SellerReplyReportsEligibility; open?: OpenRecord; flags?: ListingFlags }>,
    SellerReplyReportsError
  >
> {
  const switchState = await state(q, MODULE)
  if (switchState === 'off') return refuse('seller-reply-reports.off', 'Reports are unavailable.')
  const ids = [...new Set(listingIds)]
  const active = await isActive(q, userId)
  const tester = switchState === 'shadow' ? await repo.isTester(q, userId) : true
  const [opens, flags, noise, suppressed] = await Promise.all([
    deps.openRecords(q, userId, ids),
    deps.listingFlags(q, ids),
    deps.noiseListings(q, ids),
    repo.suppressedOf(q, ids),
  ])
  const out = new Map<
    string,
    { gate: SellerReplyReportsEligibility; open?: OpenRecord; flags?: ListingFlags }
  >()
  for (const id of ids) {
    const open = opens.get(id)
    const flag = flags.get(id)
    const gate = sheetGate(
      {
        firstOpenedAt: open?.firstOpenedAt,
        messagingEnabled: flag?.messagingEnabled ?? null,
        suppressed: suppressed.has(id),
        noise: noise.has(id),
        active: active && tester,
      },
      now,
    )
    out.set(id, { gate, open, flags: flag })
  }
  return ok(out)
}

export interface SubmitOutcome {
  reportId: string
  /** False when the user had already reported this listing: the existing report is returned. */
  created: boolean
  /** `seller-reply-reports.recorded`, for the caller to publish after its transaction commits. */
  event: EventEnvelope | null
}

/**
 * Saves a tap (§3.1). One report per user per listing: a second submit returns the existing
 * report unchanged (edit it instead). Over the rate limit the report still saves; the aggregator
 * gives it weight 0 (§3.3, "Silent over-limit").
 */
export async function submit(
  q: Queryable,
  rawInput: SellerReplyReportsSubmitInput,
  deps: SellerReplyReportsDeps = defaultDeps,
  options: { now?: Date } = {},
): Promise<Result<SubmitOutcome, SellerReplyReportsError>> {
  const parsed = SellerReplyReportsSubmitInput.safeParse(rawInput)
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message))
  const input = parsed.data
  const now = options.now ?? new Date()
  const gates = await gatesFor(q, input.userId, [input.listingId], deps, now)
  if (!gates.ok) return gates
  const gate = gates.value.get(input.listingId)
  if (gate?.gate !== 'eligible') {
    return refuse('seller-reply-reports.not_eligible', 'This listing cannot be reported now.')
  }
  const { id, created } = await repo.insertReport(q, {
    source: input.source,
    listingId: input.listingId,
    reporterUserId: input.userId,
    cardHash: gate.flags?.cardHash ?? null,
    evidenceHash: gate.flags?.evidenceHash ?? null,
    openVia: gate.open?.openVia ?? null,
    firstOpenedAt: gate.open?.firstOpenedAt ?? null,
    shippingOffered: gate.flags?.shippingOffered ?? null,
    checkoutEnabled: gate.flags?.checkoutEnabled ?? null,
    messagingEnabled: gate.flags?.messagingEnabled ?? null,
    ruleVersion: RULE_VERSION,
  })
  if (!created) return ok({ reportId: id, created: false, event: null })
  await repo.replaceReasons(q, id, input.reasons.map(storedReason))
  return ok({
    reportId: id,
    created: true,
    event: recordedEvent(input.source, [id], 'submit', now),
  })
}

/** Replaces a report's reasons within 24 hours of making it (§3.2). */
export async function edit(
  q: Queryable,
  rawInput: SellerReplyReportsEditInput,
  options: { now?: Date } = {},
): Promise<Result<{ reportId: string; event: EventEnvelope }, SellerReplyReportsError>> {
  const parsed = SellerReplyReportsEditInput.safeParse(rawInput)
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message))
  const input = parsed.data
  const now = options.now ?? new Date()
  if ((await state(q, MODULE)) === 'off')
    return refuse('seller-reply-reports.off', 'Reports are unavailable.')
  const [report] = await repo.selectOwnReports(q, { ids: [input.reportId] })
  if (!report || report.withdrawnAt)
    return refuse('seller-reply-reports.not_found', 'No such report.')
  if (!editWindowOpen(report.createdAt, now)) {
    return refuse(
      'seller-reply-reports.edit_window_closed',
      'This report can no longer be changed.',
    )
  }
  await repo.replaceReasons(q, report.id, input.reasons.map(storedReason))
  return ok({
    reportId: report.id,
    event: recordedEvent(report.source, [report.id], `edit:${now.toISOString()}`, now),
  })
}

/** Withdraws a report at any time (§3.2); the aggregator then removes its weight. Idempotent. */
export async function withdraw(
  q: Queryable,
  rawInput: SellerReplyReportsWithdrawInput,
  options: { now?: Date } = {},
): Promise<Result<{ reportId: string; event: EventEnvelope }, SellerReplyReportsError>> {
  const parsed = SellerReplyReportsWithdrawInput.safeParse(rawInput)
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message))
  const now = options.now ?? new Date()
  if ((await state(q, MODULE)) === 'off')
    return refuse('seller-reply-reports.off', 'Reports are unavailable.')
  const [report] = await repo.selectOwnReports(q, { ids: [parsed.data.reportId] })
  if (!report) return refuse('seller-reply-reports.not_found', 'No such report.')
  await repo.markWithdrawn(q, report.id, now)
  return ok({
    reportId: report.id,
    event: recordedEvent(report.source, [report.id], 'withdraw', now),
  })
}

function invalid(messages: string[]) {
  for (const code of [
    'seller-reply-reports.duplicate_reason',
    'seller-reply-reports.as_listed_alone',
  ] as const) {
    if (messages.includes(code)) return refuse(code, 'The reasons were not accepted.')
  }
  return refuse('seller-reply-reports.invalid_input', messages.join('; ') || 'Invalid input.')
}

function recordedEvent(
  source: string,
  reportIds: string[],
  action: string,
  now: Date,
): EventEnvelope {
  return createEvent(
    events,
    'seller-reply-reports.recorded',
    1,
    { source: source as Source, reportIds, recordedAt: now.toISOString() },
    { key: `seller-reply-reports.recorded:${[...reportIds].sort().join(',')}@${action}` },
  ) as EventEnvelope
}

// ---------------------------------------------------------------------------------------------
// The pipeline (nabvy_pipeline)
// ---------------------------------------------------------------------------------------------

export interface AggregateOutcome {
  /** Listings whose evidence row changed in this run. */
  changedListingIds: string[]
  /** `seller-reply-reports.evidence-changed` (none when nothing changed). */
  events: EventEnvelope[]
}

const FAMILIES: SellerReplyReportsFamily[] = ['location', 'handover', 'payment', 'link', 'item']

/**
 * Recomputes eligibility, weights and the evidence of these listings and of every member of
 * their copy-advert clusters (§3.2). Idempotent: an unchanged input writes nothing and publishes
 * no event (the `inputs_hash` of design §6.6). Off: writes nothing.
 */
export async function aggregate(
  q: Queryable,
  input: { listingIds: string[] },
  deps: SellerReplyReportsDeps = defaultDeps,
  options: { now?: Date } = {},
): Promise<AggregateOutcome> {
  const now = options.now ?? new Date()
  const none: AggregateOutcome = { changedListingIds: [], events: [] }
  if ((await state(q, MODULE)) === 'off') return none
  const asked = [...new Set(input.listingIds)].slice(0, 500)
  if (asked.length === 0) return none

  const clusters = await deps.clusters(q, asked)
  const targets = [...new Set([...asked, ...[...clusters.values()].flatMap((c) => c.members)])]
  const reports = await repo.selectReportsOn(q, targets)
  const reporters = [...new Set(reports.map((r) => r.reporterUserId))]
  const placeIds = [
    ...new Set(
      reports.flatMap((r) =>
        r.reasons.map((x) => x.reportedPlaceId).filter((p): p is string => !!p),
      ),
    ),
  ]
  const [
    accounts,
    records,
    bought,
    groups,
    gems,
    originals,
    faults,
    listingPoints,
    placePoints,
    t1,
  ] = await Promise.all([
    deps.reporterAccounts(q, reporters),
    repo.selectReporterRecords(q, reporters),
    deps.boughtAt(q, reporters),
    deps.linkedGroupOf(q, reporters),
    deps.gemCandidates(q, targets),
    deps.possibleOriginals(q, targets),
    deps.itemFaultStated(q, targets),
    deps.listingPoints(q, targets),
    deps.placePoints(q, placeIds),
    deps.firstFetchedAt(q, targets),
  ])

  // Bursts, on each listing and on each cluster, over every report not withdrawn (§3.3).
  const live = reports.filter((r) => !r.withdrawnAt)
  const listingBurst = new Map<string, SellerReplyReportsHoldReason | null>()
  for (const id of targets) {
    const times = live.filter((r) => r.listingId === id).map((r) => r.createdAt)
    listingBurst.set(id, burstOf(times, gems.has(id)))
  }
  const clusterBurst = new Map<string, SellerReplyReportsHoldReason | null>()
  for (const c of new Set(clusters.values())) {
    const times = live.filter((r) => c.members.includes(r.listingId)).map((r) => r.createdAt)
    clusterBurst.set(
      c.clusterKey,
      burstOf(
        times,
        c.members.some((m) => gems.has(m)),
      ),
    )
  }

  // Each report's eligibility, weight and report-then-buy outcome.
  const assessed = new Map<
    string,
    {
      eligibility: SellerReplyReportsEligibility
      weight: number
      rtb: boolean
      outcome: string | null
    }
  >()
  for (const r of reports) {
    const account = accounts.get(r.reporterUserId)
    const record = records.get(r.reporterUserId) ?? { tester: false, upheld: 0, notUpheld: 0 }
    const eligibility = eligibilityOf(
      {
        accountCreatedAt: account?.createdAt ?? null,
        emailVerified: account?.emailVerified ?? null,
        active: account?.active ?? false,
        tester: record.tester,
        upheld: record.upheld,
        notUpheld: record.notUpheld,
      },
      { lastHour: r.priorHour, lastDay: r.priorDay },
      (listingBurst.get(r.listingId) ?? null) !== null,
      now,
    )
    const weight =
      eligibility === 'eligible' ? reportWeight(account?.createdAt ?? null, record, now) : 0
    const rtb = isReportThenBuy(r.createdAt, bought.get(`${r.reporterUserId}|${r.listingId}`))
    const outcome = r.outcome ?? (rtb ? 'unknown' : null)
    assessed.set(r.id, { eligibility, weight, rtb: rtb && r.outcomeBy !== 'ban', outcome })
  }

  // The weight a report adds to a family: none once withdrawn, voided or not upheld; none for
  // report-then-buy except the item family (§3.3).
  const familyWeight = (r: repo.ReportRow, family: SellerReplyReportsFamily): number => {
    const a = assessed.get(r.id)
    if (!a || r.withdrawnAt) return 0
    if (a.outcome === 'void' || a.outcome === 'not_upheld') return 0
    if (r.outcomeBy === 'report_then_buy' || a.rtb) {
      if (family !== 'item') return 0
    }
    return a.weight
  }

  const contextFor = (r: repo.ReportRow, placeId: string | null, target: string): ReasonContext => {
    const from = listingPoints.get(target)
    const to = placeId ? placePoints.get(placeId) : undefined
    return {
      distanceKm: from && to ? distanceKm(from, to, 'city_page').km : null,
      shippingOffered: r.shippingOffered,
      itemFaultStated: faults.has(r.listingId),
    }
  }

  // Evidence per target listing, family and scope.
  const existing = await repo.selectEvidenceHashes(q, targets, RULE_VERSION)
  const changed = new Set<string>()
  const helping = new Set<string>()
  for (const target of targets) {
    const cluster = clusters.get(target)
    const scopes: Array<{
      scope: SellerReplyReportsScope
      from: repo.ReportRow[]
      hold: SellerReplyReportsHoldReason | null
    }> = [
      {
        scope: 'own',
        from: reports.filter((r) => r.listingId === target),
        hold: listingBurst.get(target) ?? null,
      },
    ]
    if (cluster && !originals.has(target)) {
      scopes.push({
        scope: 'copy',
        from: reports.filter(
          (r) => r.listingId !== target && cluster.members.includes(r.listingId),
        ),
        hold: clusterBurst.get(cluster.clusterKey) ?? null,
      })
    }
    for (const { scope, from, hold: burst } of scopes) {
      const counters: Contribution[] = from
        .filter((r) => r.reasons.some((x) => x.reason === 'as_listed'))
        .map((r) => ({
          reportId: r.id,
          personKey: groups.get(r.reporterUserId) ?? r.reporterUserId,
          weight: r.withdrawnAt ? 0 : (assessed.get(r.id)?.weight ?? 0),
          counts: 'none',
          placeId: null,
          band: null,
        }))
      const counter = counterWeight(counters)
      for (const family of FAMILIES) {
        const contributions: Contribution[] = []
        for (const r of from) {
          for (const reason of r.reasons) {
            if (familyOf(reason.reason) !== family) continue
            const ctx = contextFor(r, reason.reportedPlaceId, target)
            contributions.push({
              reportId: r.id,
              personKey: groups.get(r.reporterUserId) ?? r.reporterUserId,
              weight: familyWeight(r, family),
              counts: reasonCounts(reason, ctx),
              placeId: family === 'location' ? reason.reportedPlaceId : null,
              band: family === 'location' ? distanceBand(ctx.distanceKm) : null,
            })
          }
        }
        const key = `${target}|${family}|${scope}`
        if (contributions.length === 0 && !existing.has(key)) continue
        const evidence = familyEvidence(contributions)
        const hold = holdOf(burst, counter, evidence.level)
        const hash = inputsHash({
          listingId: target,
          family,
          scope,
          contributions,
          counter,
          memberSetHash: scope === 'copy' ? (cluster?.memberSetHash ?? null) : null,
          hold,
        })
        if (scope === 'own' && evidence.level !== 'none' && !hold) {
          for (const c of contributions)
            if (c.counts === 'any_path' && c.weight > 0) helping.add(c.reportId)
        }
        if (existing.get(key) === hash) continue
        const source = from[0]?.source ?? 'facebook'
        await repo.upsertEvidence(
          q,
          {
            source,
            listingId: target,
            family,
            scope,
            persons: evidence.persons,
            weightSum: evidence.weightSum,
            counterWeight: counter,
            level: evidence.level,
            placeId: evidence.placeId,
            distanceBand: evidence.distanceBand,
            held: hold !== null,
            holdReason: hold,
            inputsHash: hash,
            ruleVersion: RULE_VERSION,
            t1FetchedAt: t1.get(target) ?? null,
          },
          now,
        )
        if (hold)
          await repo.openHold(
            q,
            source,
            scope === 'copy' && cluster ? cluster.clusterKey : target,
            hold,
            now,
          )
        changed.add(target)
      }
    }
  }

  // Write back each report's assessment and each reason's own-listing check, only where changed.
  for (const r of reports) {
    const a = assessed.get(r.id)
    if (!a) continue
    const weightAtSubmit = r.weightAtSubmit ?? (r.eligibility === 'pending' ? a.weight : null)
    const outcomeBy = r.outcomeBy ?? (a.outcome === 'unknown' && a.rtb ? 'report_then_buy' : null)
    const status = statusOf({
      withdrawn: r.withdrawnAt !== null,
      outcome: a.outcome as SellerReplyReportsOutcome | null,
      eligibility: a.eligibility,
      helping: helping.has(r.id),
    })
    if (
      a.eligibility !== r.eligibility ||
      a.weight !== r.weight ||
      weightAtSubmit !== r.weightAtSubmit ||
      status !== r.status ||
      a.outcome !== r.outcome ||
      outcomeBy !== r.outcomeBy
    ) {
      await repo.updateReport(q, {
        id: r.id,
        eligibility: a.eligibility,
        weight: a.weight,
        weightAtSubmit,
        status,
        outcome: a.outcome,
        outcomeBy,
      })
    }
    for (const reason of r.reasons) {
      const ctx = contextFor(r, reason.reportedPlaceId, r.listingId)
      const counts = reasonCounts(reason, ctx)
      const band =
        reason.reason === 'collection_elsewhere' && reason.reportedPlaceId
          ? distanceBand(ctx.distanceKm)
          : null
      if (counts !== reason.counts || band !== reason.distanceBand) {
        await repo.updateReason(q, r.id, reason.reason, { distanceBand: band, counts })
      }
    }
  }

  const changedListingIds = [...changed].sort()
  if (changedListingIds.length === 0) return { changedListingIds, events: [] }
  const source = reports[0]?.source ?? 'facebook'
  const key = createHash('sha256')
    .update(JSON.stringify([RULE_VERSION, changedListingIds, now.toISOString()]))
    .digest('hex')
  return {
    changedListingIds,
    events: [
      createEvent(
        events,
        'seller-reply-reports.evidence-changed',
        1,
        { source: source as Source, listingIds: changedListingIds, changedAt: now.toISOString() },
        { key: `seller-reply-reports.evidence-changed:${key}` },
      ) as EventEnvelope,
    ],
  }
}

/**
 * Records an outcome on reports (review-console, a correction, corroboration, a ban) and
 * recounts their reporters' accuracy (§3.2), then re-aggregates their listings. Idempotent: an
 * outcome already recorded writes nothing and publishes nothing.
 */
export async function resolve(
  q: Queryable,
  rawInput: SellerReplyReportsResolveInput,
  deps: SellerReplyReportsDeps = defaultDeps,
  options: { now?: Date } = {},
): Promise<Result<{ resolvedIds: string[]; events: EventEnvelope[] }, SellerReplyReportsError>> {
  const parsed = SellerReplyReportsResolveInput.safeParse(rawInput)
  if (!parsed.success) return refuse('seller-reply-reports.invalid_input', parsed.error.message)
  const now = options.now ?? new Date()
  if ((await state(q, MODULE)) === 'off')
    return refuse('seller-reply-reports.off', 'Reports are unavailable.')
  const resolvedIds = await repo.setOutcomes(
    q,
    parsed.data.reportIds,
    parsed.data.outcome,
    parsed.data.by,
  )
  if (resolvedIds.length === 0) return ok({ resolvedIds, events: [] })
  await repo.recountStats(q, await repo.selectReporters(q, resolvedIds))
  const listings = await repo.selectReportListings(q, { reportIds: resolvedIds })
  const agg = await aggregate(q, { listingIds: listings }, deps, { now })
  const sorted = [...resolvedIds].sort()
  const resolved = createEvent(
    events,
    'seller-reply-reports.resolved',
    1,
    { reportIds: sorted, resolvedAt: now.toISOString() },
    {
      key: `seller-reply-reports.resolved:${sorted.join(',')}@${parsed.data.outcome}:${parsed.data.by}`,
    },
  ) as EventEnvelope
  return ok({ resolvedIds: sorted, events: [resolved, ...agg.events] })
}

/**
 * Deletes every report, evidence row and hold on these listings (seller-rights, rule 12), and
 * recounts the affected reporters. Idempotent. Runs whatever the switch.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<void> {
  const ids = [...new Set(listingIds)]
  for (let i = 0; i < ids.length; i += 500) {
    const reporters = await repo.deleteListings(q, ids.slice(i, i + 500))
    await repo.recountStats(q, reporters)
  }
}

/** Adds the team's accounts to the tester list (the admin path writes the audit row first). */
export async function addTesters(
  q: Queryable,
  input: { userIds: string[]; addedBy: string; auditId: string },
  options: { now?: Date } = {},
): Promise<void> {
  await repo.insertTesters(q, input, options.now ?? new Date())
}
