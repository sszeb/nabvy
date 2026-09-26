// Public API of the spec-match module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/spec-match' only, never from its internals. It matches wants against
// listings by the parts they contain, including parts inside PCs, stamps T5 and announces only
// verdict changes; it also runs spec searches on demand over the same shared views, with no fetch
// and no model call (README.md). It sends no alerts and computes no prices.

import { isActive as accountIsActive } from '@nabvy/account'
import { SPEC_MATCH_EVENT_BATCH_SIZE, SPEC_MATCH_RULES } from '@nabvy/config/modules/spec-match'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
  Uuid,
} from '@nabvy/contracts'
import { AccountDeletedEvent } from '@nabvy/contracts/modules/account'
import type { LocationDistanceBasis, LocationPoint } from '@nabvy/contracts/modules/location'
import {
  events,
  type SpecMatchCriterionResult,
  type SpecMatchResult,
  type SpecMatchResults,
  SpecMatchSearchInput,
} from '@nabvy/contracts/modules/spec-match'
import type { Queryable } from '@nabvy/db'
import { suppressed } from '@nabvy/listing-suppression'
import { distanceKm } from '@nabvy/location'
import { redact } from '@nabvy/quote-redaction'
import { isOn, state } from '@nabvy/switches'
import { getPreferences, wantOwners } from '@nabvy/want-manager'
import {
  chunk,
  compareBy,
  evaluate,
  inputHash,
  type ListingInput,
  matchedKey,
  ruleVersion,
  type SortFacts,
  type WantInput,
} from './domain'
import {
  type CardFacts,
  deleteByListings,
  deleteByUser,
  deleteByWants,
  insertMatch,
  type StoredWant,
  selectActiveWants,
  selectByKey,
  selectCandidateIds,
  selectLatest,
  selectListingIdsSince,
  selectListings,
  selectNoiseReasonsForApp,
  selectNoisy,
  selectResults,
  selectWants,
  touchMatch,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/spec-match'
export {
  catalogueFit,
  compareBy,
  distanceCriterion,
  evaluate,
  partCriterion,
  priceCriterion,
  ruleVersion,
  verdictOf,
} from './domain'
export {
  accountDeletedHandler,
  listingEventHandlers,
  wantManagerChangedHandler,
} from './handlers'

const MODULE = 'spec-match'

/** The rule version of the configured rules. */
export const SPEC_MATCH_RULE_VERSION = ruleVersion(SPEC_MATCH_RULES)

// ---------------------------------------------------------------------------------------------
// Injected seams (soft edges: pickup-location, copy-advert's app view, multi-quantity-filter,
// asking-price-position). Each stub returns "no data", the conservative default.
// ---------------------------------------------------------------------------------------------

/** A listing's point to measure from (pickup-location's `pointsFor` shape). */
export interface ListingPoint {
  point: LocationPoint
  /** pickup-location's basis; `fallback` is the city page, anything else the listing's area. */
  basis: string
}

/** An asking-price position as asking-price-position will publish it: a rank and its sample. */
export interface ListingPosition {
  position: number
  sample: number
}

export interface SpecMatchDeps {
  /** pickup-location's `pointsFor` (soft). Stub: no points, so distance is not stated. */
  pointsFor?(q: Queryable, listingIds: string[]): Promise<Map<string, ListingPoint>>
  /** Listings with a shown flag in `app.v_copy_advert_flags` (copy-advert 1.7c). Stub: none. */
  spamFlags?(q: Queryable, listingIds: string[]): Promise<Set<string>>
  /** Listings `app.v_multi_quantity_filter_flags` flags (multi-quantity-filter, soft). Stub: none. */
  multiQuantityFlags?(q: Queryable, listingIds: string[]): Promise<Set<string>>
  /** Positions from `v_positions` (asking-price-position, soft). Stub: none, so all sort last. */
  positions?(q: Queryable, listingIds: string[]): Promise<Map<string, ListingPosition>>
  /** The account's standing (account). Injected for tests; defaults to `@nabvy/account`. */
  isActive?(q: Queryable, userId: string): Promise<boolean>
}

const none = async () => new Map()
const noneSet = async () => new Set<string>()

async function distances(
  q: Queryable,
  from: LocationPoint | null,
  inputs: ListingInput[],
  deps: SpecMatchDeps,
): Promise<Map<string, ListingPoint>> {
  if (from === null || inputs.length === 0) return new Map()
  return (deps.pointsFor ?? none)(
    q,
    inputs.map((i) => i.listingId),
  )
}

const withDistance = (
  input: ListingInput,
  from: LocationPoint | null,
  points: Map<string, ListingPoint>,
): ListingInput => {
  const p = points.get(input.listingId)
  if (from === null || !p) return { ...input, distanceKm: null }
  const basis: LocationDistanceBasis = p.basis === 'fallback' ? 'city_page' : 'coordinates'
  return { ...input, distanceKm: distanceKm(from, p.point, basis).km }
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** What one match call did. */
export interface MatchReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  wants: number
  listings: number
  /** Pairs whose stored verdict already matches every input (nothing to add). */
  current: number
  written: number
  /** Matches whose verdict changed (new pair, or a different verdict). */
  changed: string[]
  /** `spec-match.matched` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

const emptyReport = (): MatchReport => ({
  open: false,
  wants: 0,
  listings: 0,
  current: 0,
  written: 0,
  changed: [],
  events: [],
})

async function isOpen(q: Queryable): Promise<boolean> {
  return (await state(q, MODULE)) !== 'off' && (await isOn(q, 'pipeline'))
}

async function ownersOf(q: Queryable, wantIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const batch of chunk(wantIds, SPEC_MATCH_EVENT_BATCH_SIZE)) {
    for (const [k, v] of await wantOwners(q, batch)) out.set(k, v)
  }
  return out
}

/** Matches wants against one batch of listings and writes what changed. */
async function matchBatch(
  q: Queryable,
  wants: StoredWant[],
  listingIds: string[],
  opts: { now: Date; backfill: boolean },
  deps: SpecMatchDeps,
  report: MatchReport,
): Promise<void> {
  const { inputs } = await selectListings(q, listingIds)
  report.listings += inputs.length
  if (inputs.length === 0 || wants.length === 0) return
  const owners = await ownersOf(
    q,
    wants.map((w) => w.id),
  )
  const latest = await selectLatest(
    q,
    wants.map((w) => w.id),
    inputs.map((i) => i.listingId),
  )
  const points = await (deps.pointsFor ?? none)(
    q,
    inputs.map((i) => i.listingId),
  )
  for (const want of wants) {
    const userId = owners.get(want.id)
    if (!userId) continue
    for (const raw of inputs) {
      const listing = withDistance(raw, want.point, points)
      const e = evaluate(want, listing, SPEC_MATCH_RULES)
      const before = latest.get(`${want.id}@${listing.listingId}`)
      if (!e.relevant && !before) continue
      const hash = inputHash(want, listing, e)
      if (before && before.inputHash === hash && before.ruleVersion === SPEC_MATCH_RULE_VERSION) {
        report.current += 1
        continue
      }
      const key = {
        wantId: want.id,
        listingId: listing.listingId,
        inputHash: hash,
        ruleVersion: SPEC_MATCH_RULE_VERSION,
      }
      let id = await insertMatch(q, {
        ...key,
        userId,
        evidenceHash: listing.evidenceHash,
        cardHash: listing.cardHash,
        verdict: e.verdict,
        criteria: e.criteria,
        insidePc: e.insidePc,
        origin: e.origin,
        backfill: opts.backfill,
        matchedAt: opts.now,
      })
      if (!id) {
        // The inputs returned to an earlier state: that row becomes the latest again.
        id = (await selectByKey(q, key))?.id
        if (!id) continue
        await touchMatch(q, id, opts.now)
      }
      report.written += 1
      if (!before || before.verdict !== e.verdict) report.changed.push(id)
    }
  }
}

function finish(report: MatchReport): MatchReport {
  const ids = [...report.changed].sort()
  report.events = chunk(ids, SPEC_MATCH_EVENT_BATCH_SIZE).map((batch, i) =>
    createEvent(
      events,
      'spec-match.matched',
      1,
      { matchIds: batch },
      { key: matchedKey(batch, i) },
    ),
  ) as EventEnvelope[]
  return report
}

/**
 * Matches every active want against these listings (the listing events' payload, up to 500 IDs),
 * with `now` as T5. Safe to run twice: the second run writes nothing and announces nothing.
 */
export async function matchListings(
  q: Queryable,
  input: { listingIds: string[]; now: Date },
  deps: SpecMatchDeps = {},
): Promise<Result<MatchReport, AppError>> {
  if (input.listingIds.length > SPEC_MATCH_EVENT_BATCH_SIZE) {
    return err({
      code: 'spec-match.too_many_listings',
      message: `A batch holds at most ${SPEC_MATCH_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  const report = emptyReport()
  if (!(await isOpen(q))) return ok(report)
  report.open = true
  const wants = await selectActiveWants(q)
  report.wants = wants.length
  const ids = [...new Set(input.listingIds.map((id) => Uuid.parse(id)))]
  await matchBatch(q, wants, ids, { now: input.now, backfill: false }, deps, report)
  return ok(finish(report))
}

/**
 * On a new or edited want: backfills it against listings first seen within the last
 * `backfillDays` days, marked `backfill` (in-app and the next digest only, never an instant
 * alert). A want that no longer exists loses its matches; a paused want keeps them and matches
 * nothing new. Safe to run twice.
 */
export async function matchWants(
  q: Queryable,
  input: { wantIds: string[]; now: Date },
  deps: SpecMatchDeps = {},
): Promise<Result<MatchReport, AppError>> {
  if (input.wantIds.length > SPEC_MATCH_EVENT_BATCH_SIZE) {
    return err({
      code: 'spec-match.too_many_wants',
      message: `A batch holds at most ${SPEC_MATCH_EVENT_BATCH_SIZE} want IDs.`,
    })
  }
  const report = emptyReport()
  if (!(await isOpen(q))) return ok(report)
  report.open = true
  const ids = [...new Set(input.wantIds.map((id) => Uuid.parse(id)))]
  const found = await selectWants(q, ids)
  // Only while want-manager shows its wants: an off want-manager is "no data", never "deleted".
  if ((await state(q, 'want-manager')) !== 'off') {
    const gone = ids.filter((id) => !found.some((w) => w.id === id))
    await deleteByWants(q, gone)
  }
  const wants = found.filter((w) => w.active)
  report.wants = wants.length
  if (wants.length === 0) return ok(finish(report))
  const since = new Date(input.now.getTime() - SPEC_MATCH_RULES.backfillDays * 86_400_000)
  const listingIds = await selectListingIdsSince(q, since)
  for (const batch of chunk(listingIds, SPEC_MATCH_EVENT_BATCH_SIZE)) {
    await matchBatch(q, wants, batch, { now: input.now, backfill: true }, deps, report)
  }
  return ok(finish(report))
}

// ---------------------------------------------------------------------------------------------
// User-facing reads
// ---------------------------------------------------------------------------------------------

/** Quotes through quote-redaction; null while it is off (fail closed). */
function redactCriteria(
  criteria: SpecMatchCriterionResult[],
  redactionOn: boolean,
): SpecMatchCriterionResult[] {
  return criteria.map((c) => ({
    ...c,
    evidence: c.evidence.map((e) => ({
      ...e,
      quote: redactionOn && e.quote !== null ? redact(e.quote).text.slice(0, 400) : null,
    })),
  }))
}

interface Hidden {
  noise: Set<string>
  spam: Set<string>
  multiQuantity: Set<string>
}

/** Applies the user's hide preferences; each listing counts once, under its first reason. */
function sectioned(results: SpecMatchResult[], hidden: Hidden, limit: number): SpecMatchResults {
  const counts = { noise: 0, spam: 0, multiQuantity: 0 }
  const shown: SpecMatchResult[] = []
  for (const r of results) {
    if (hidden.noise.has(r.listingId)) counts.noise += 1
    else if (hidden.spam.has(r.listingId)) counts.spam += 1
    else if (hidden.multiQuantity.has(r.listingId)) counts.multiQuantity += 1
    else shown.push(r)
  }
  return {
    standalone: shown.filter((r) => !r.insidePc).slice(0, limit),
    insidePc: shown.filter((r) => r.insidePc).slice(0, limit),
    hidden: counts,
  }
}

async function hiddenFor(
  q: Queryable,
  userId: string,
  listingIds: string[],
  deps: SpecMatchDeps,
  noise: (ids: string[]) => Promise<Set<string>>,
): Promise<Hidden> {
  const prefs = await getPreferences(q, userId)
  return {
    noise: prefs.hideNoise ? await noise(listingIds) : new Set(),
    spam: prefs.hideSpam ? await (deps.spamFlags ?? noneSet)(q, listingIds) : new Set(),
    multiQuantity: prefs.hideMultiQuantity
      ? await (deps.multiQuantityFlags ?? noneSet)(q, listingIds)
      : new Set(),
  }
}

/**
 * A spec search on demand, for a signed-in user: the same rules over the shared views, with the
 * owner's filters and sorts; no fetch, no model call. Runs inside withPipeline (it reads only
 * shared internal views; nothing here is user-scoped but the preferences) after the procedure
 * has checked the session. Rows only while this module and listing-suppression are on; never a
 * suppressed listing; quotes redacted.
 */
export async function search(
  q: Queryable,
  rawInput: SpecMatchSearchInput,
  deps: SpecMatchDeps = {},
): Promise<Result<SpecMatchResults, AppError>> {
  const parsed = SpecMatchSearchInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'spec-match.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  if (!(await (deps.isActive ?? accountIsActive)(q, input.userId))) {
    return err({ code: 'spec-match.account_inactive', message: 'The account is not active.' })
  }
  const empty: SpecMatchResults = {
    standalone: [],
    insidePc: [],
    hidden: { noise: 0, spam: 0, multiQuantity: 0 },
  }
  if (!(await isOn(q, MODULE))) {
    return err({ code: 'spec-match.off', message: 'Spec search is not available.' })
  }
  if (!(await isOn(q, 'listing-suppression'))) return ok(empty)

  const ids = await selectCandidateIds(q, input.criteria, SPEC_MATCH_RULES.searchCandidateLimit)
  const { inputs, cards } = await selectListings(q, ids)
  const hide = await suppressed(q, ids)
  const points = await distances(q, input.point, inputs, deps)
  const want: WantInput = {
    id: null,
    centreId: null,
    point: input.point,
    radiusKm: input.radiusKm,
    priceCapMinor: input.priceMaxMinor ?? null,
    currency: input.currency,
    deliveryMethods: input.handover ?? ['collection', 'posted'],
    criteria: input.criteria,
  }
  const redactionOn = await isOn(q, 'quote-redaction')
  const kept: { result: SpecMatchResult; facts: SortFacts }[] = []
  for (const raw of inputs) {
    if (hide.has(raw.listingId)) continue
    const listing = withDistance(raw, input.point, points)
    const e = evaluate(want, listing, SPEC_MATCH_RULES)
    if (!e.relevant || e.verdict === 'no_match') continue
    const card = cards.get(listing.listingId) as CardFacts
    const samePrice = card.currency === input.currency ? card.priceMinor : null
    if (
      input.priceMinMinor !== undefined &&
      samePrice !== null &&
      samePrice < input.priceMinMinor
    ) {
      continue
    }
    kept.push({
      result: {
        matchId: null,
        wantId: null,
        listingId: listing.listingId,
        verdict: e.verdict,
        insidePc: e.insidePc,
        origin: null,
        backfill: false,
        criteria: redactCriteria(e.criteria, redactionOn),
        matchedAt: null,
      },
      facts: {
        listingId: listing.listingId,
        distanceKm: listing.distanceKm,
        priceMinor: samePrice,
        listedAt: card.listedAt,
        position: null,
      },
    })
  }
  if (input.sort === 'best_position' && kept.length > 0) {
    const positions = await (deps.positions ?? none)(
      q,
      kept.map((k) => k.result.listingId),
    )
    for (const k of kept) {
      const p = positions.get(k.result.listingId)
      // Only positions shown at n≥10 take part; a hidden one sorts last, so it never leaks.
      k.facts.position = p && p.sample >= SPEC_MATCH_RULES.positionMinSample ? p.position : null
    }
  }
  kept.sort((a, b) => compareBy(input.sort)(a.facts, b.facts))
  const results = kept.map((k) => k.result)
  const noiseOn = await isOn(q, 'noise-filter')
  const hidden = await hiddenFor(
    q,
    input.userId,
    results.map((r) => r.listingId),
    deps,
    (listingIds) => (noiseOn ? selectNoisy(q, listingIds) : Promise.resolve(new Set())),
  )
  return ok(sectioned(results, hidden, input.limit))
}

/**
 * The signed-in user's own results, inside withUser: `app.v_spec_match_results` (quotes redacted
 * there, rows only while on, never a suppressed listing), newest first, in two sections, with the
 * user's hide preferences applied as visible counts.
 */
export async function results(
  q: Queryable,
  input: { userId: string; wantId?: string },
  deps: SpecMatchDeps = {},
): Promise<Result<SpecMatchResults, AppError>> {
  const userId = Uuid.parse(input.userId)
  if (!(await (deps.isActive ?? accountIsActive)(q, userId))) {
    return err({ code: 'spec-match.account_inactive', message: 'The account is not active.' })
  }
  const rows = await selectResults(q, input.wantId ? Uuid.parse(input.wantId) : undefined)
  const out: SpecMatchResult[] = rows.map((r) => ({
    matchId: r.matchId,
    wantId: r.wantId,
    listingId: r.listingId,
    verdict: r.verdict as SpecMatchResult['verdict'],
    insidePc: r.insidePc,
    origin: r.origin as SpecMatchResult['origin'],
    backfill: r.backfill,
    criteria: r.criteria as SpecMatchCriterionResult[],
    matchedAt: new Date(r.matchedAt).toISOString(),
  }))
  const hidden = await hiddenFor(
    q,
    userId,
    out.map((r) => r.listingId),
    deps,
    (listingIds) => selectNoiseReasonsForApp(q, listingIds),
  )
  return ok(sectioned(out, hidden, 100))
}

// ---------------------------------------------------------------------------------------------
// Erasure and purge
// ---------------------------------------------------------------------------------------------

/** Removes the matches of these listings (rule 12: seller-rights erasure). Runs whatever the switch. */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, SPEC_MATCH_EVENT_BATCH_SIZE)) {
    removed += await deleteByListings(q, batch)
  }
  return removed
}

/** `account.deleted`: removes every match of those users (rule 12), whatever the switch. */
export async function onAccountDeleted(q: Queryable, payloads: unknown[]): Promise<number> {
  const userIds = [...new Set(payloads.map((p) => AccountDeletedEvent.parse(p).userId))]
  let removed = 0
  for (const userId of userIds) removed += await deleteByUser(q, userId)
  return removed
}
