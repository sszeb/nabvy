// Public API of the pickup-location module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/pickup-location' only, never from its internals. It resolves
// where each listing really is from the location field and the places named in its text, keeps
// the precise evidence in its own tables, and publishes only the town or area (README.md).

import {
  PICKUP_LOCATION_AGREE_KM,
  PICKUP_LOCATION_CONFLICT_KM,
  PICKUP_LOCATION_CUE_WINDOW_CHARS,
  PICKUP_LOCATION_DELIVERY_FAR_KM,
  PICKUP_LOCATION_EVENT_BATCH_SIZE,
  PICKUP_LOCATION_MAX_CANDIDATES,
} from '@nabvy/config/modules/pickup-location'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import type { LocationPoint } from '@nabvy/contracts/modules/location'
import {
  events,
  PickupLocationOverride,
  type PickupLocationPass,
  type PickupLocationPoint,
} from '@nabvy/contracts/modules/pickup-location'
import type { Queryable } from '@nabvy/db'
import { pointForPostcode } from '@nabvy/location'
import { redact } from '@nabvy/quote-redaction'
import { isOn, state } from '@nabvy/switches'
import {
  batchKey,
  buildGazetteer,
  type Candidate,
  candidatesFrom,
  chunk,
  decide,
  extractMentions,
  fieldFrom,
  type Gazetteer,
  handoverFrom,
  type Mention,
  ruleVersion,
  type Thresholds,
} from './domain'
import {
  type CurrentRow,
  type CurrentWrite,
  deleteListings,
  enqueueAi,
  insertResolutions,
  type ResolutionRow,
  selectCardFields,
  selectCards,
  selectCityPages,
  selectCurrent,
  selectDone,
  selectHandover,
  selectOverrides,
  selectVersions,
  upsertCurrent,
  upsertHandover,
  upsertOverride,
  type Version,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/pickup-location'
export {
  buildGazetteer,
  classifyCue,
  decide,
  extractMentions,
  handoverFrom,
  STOP_LIST,
} from './domain'
export { detailEvidenceChangedHandler, listingIngestFirstSeenHandler } from './handlers'

const MODULE = 'pickup-location'

const THRESHOLDS: Thresholds = {
  agreeKm: PICKUP_LOCATION_AGREE_KM,
  conflictKm: PICKUP_LOCATION_CONFLICT_KM,
  deliveryFarKm: PICKUP_LOCATION_DELIVERY_FAR_KM,
  cueWindowChars: PICKUP_LOCATION_CUE_WINDOW_CHARS,
  maxCandidates: PICKUP_LOCATION_MAX_CANDIDATES,
}

/** The rule version in force: the cues, the stop-list and the thresholds, hashed. */
export function currentRuleVersion(): string {
  return ruleVersion(THRESHOLDS)
}

/** What `run` may be given instead of its defaults (tests inject a postcode lookup). */
export interface RunDeps {
  /**
   * A postcode's point. The default is `location`'s `pointForPostcode` (cached, postcodes.io
   * behind location's own switch); a test passes a map. `undefined` means unknown.
   */
  postcodePoint?: (q: Queryable, postcode: string) => Promise<LocationPoint | undefined>
}

/** What one `run` call did. */
export interface RunReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  ruleVersion: string
  /** Listing versions found for this pass. */
  listings: number
  resolutionsWritten: number
  /** Listings whose current row moved (the `changed` event). */
  changed: string[]
  /** Listings resolved in this call (new or already stored). */
  resolved: string[]
  /** `pickup-location.resolved` and `pickup-location.changed` envelopes, to publish after commit. */
  events: EventEnvelope[]
}

const emptyReport = (): RunReport => ({
  open: false,
  ruleVersion: '',
  listings: 0,
  resolutionsWritten: 0,
  changed: [],
  resolved: [],
  events: [],
})

/**
 * Resolves the given listings for one pass (up to 500 IDs): `card` reads listing-ingest's card
 * (title, town label, page; from `listing-ingest.first-seen`), `detail` reads detail-evidence's
 * current version (text and coarse coordinates; from `detail-evidence.changed`). Versions already
 * resolved at this pass and rule version are skipped, so a replay writes nothing and returns the
 * same event keys. A `detail` resolution replaces a `card` one; an older input never replaces a
 * newer one. Off, or with the pipeline paused: nothing is read or written.
 */
export async function run(
  q: Queryable,
  input: { pass: PickupLocationPass; listingIds: string[] },
  deps: RunDeps = {},
): Promise<Result<RunReport, AppError>> {
  const report = emptyReport()
  if (input.listingIds.length > PICKUP_LOCATION_EVENT_BATCH_SIZE) {
    return err({
      code: 'pickup-location.too_many_listings',
      message: `A batch holds at most ${PICKUP_LOCATION_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true
  const version = currentRuleVersion()
  report.ruleVersion = version

  const listingIds = [...new Set(input.listingIds)]
  const versions =
    input.pass === 'card' ? await selectCards(q, listingIds) : await selectVersions(q, listingIds)
  report.listings = versions.length
  if (versions.length === 0) return ok(report)
  const done = await selectDone(q, listingIds, input.pass, version)
  const todo = versions.filter((v) => !done.has(`${v.listingId}@${v.evidenceHash}`))

  const gazetteer = buildGazetteer(await selectCityPages(q))
  const lookup = deps.postcodePoint ?? pointForPostcode
  const rows: ResolutionRow[] = []
  for (const v of todo) rows.push(await resolveOne(q, input.pass, v, gazetteer, lookup))

  const ids = await insertResolutions(q, version, rows)
  report.resolutionsWritten = ids.size
  const fresh = rows.filter((r) => ids.has(`${r.version.listingId}@${r.version.evidenceHash}`))

  const before = await selectCurrent(
    q,
    fresh.map((r) => r.version.listingId),
  )
  const beforeHandover = await selectHandover(
    q,
    fresh.map((r) => r.version.listingId),
  )
  const overrides = await selectOverrides(
    q,
    fresh.map((r) => r.version.listingId),
  )
  const writes: CurrentWrite[] = []
  const handovers: Parameters<typeof upsertHandover>[1] = []
  const changed: string[] = []
  for (const r of fresh) {
    const id = r.version.listingId
    const old = before.get(id)
    if (!wins(input.pass, r.version, old)) continue
    const write = currentFrom(r, ids.get(`${id}@${r.version.evidenceHash}`) as string)
    const override = overrides.get(id)
    if (override) {
      Object.assign(write, {
        decidedBy: 'review',
        status: 'confirmed',
        basis: 'fallback',
        townOrArea: override.townOrArea,
        areaId: override.areaId,
        lat: override.lat,
        lng: override.lng,
        approximate: false,
        conflict: false,
        noteCode: null,
        notePlaceLabel: null,
        listedInLabel: null,
      } satisfies Partial<CurrentWrite>)
    }
    writes.push(write)
    const text = `${r.version.title}\n${r.version.description ?? ''}`
    const facts = handoverFrom(r.version.deliveryTypes, text)
    handovers.push({ listingId: id, evidenceHash: r.version.evidenceHash, ...facts })
    if (moved(old, write) || movedHandover(beforeHandover.get(id), facts)) changed.push(id)
  }
  await upsertCurrent(q, writes)
  await upsertHandover(q, handovers)
  await enqueueAi(
    q,
    fresh
      .filter((r) => r.decision.aiReason !== null)
      .map((r) => ({
        listingId: r.version.listingId,
        evidenceHash: r.version.evidenceHash,
        reason: r.decision.aiReason as 'uncertain' | 'delivers_elsewhere',
      })),
  )

  const resolved = [...versions].sort((a, b) => a.listingId.localeCompare(b.listingId))
  report.resolved = resolved.map((v) => v.listingId)
  report.changed = changed.sort()
  const changedVersions = resolved.filter((v) => changed.includes(v.listingId))
  report.events = [
    ...chunk(resolved, PICKUP_LOCATION_EVENT_BATCH_SIZE).map((batch, i) =>
      createEvent(
        events,
        'pickup-location.resolved',
        1,
        { listingIds: batch.map((v) => v.listingId) },
        { key: batchKey('resolved', version, batch, i) },
      ),
    ),
    ...chunk(changedVersions, PICKUP_LOCATION_EVENT_BATCH_SIZE).map((batch, i) =>
      createEvent(
        events,
        'pickup-location.changed',
        1,
        { listingIds: batch.map((v) => v.listingId) },
        { key: batchKey('changed', version, batch, i) },
      ),
    ),
  ] as EventEnvelope[]
  return ok(report)
}

async function resolveOne(
  q: Queryable,
  pass: PickupLocationPass,
  v: Version,
  gazetteer: Gazetteer,
  lookup: NonNullable<RunDeps['postcodePoint']>,
): Promise<ResolutionRow> {
  const field = fieldFrom(
    { cityPageId: v.cityPageId, townLabel: v.townLabel, coordinates: v.coordinates },
    gazetteer,
  )
  const mentions: Mention[] = [
    ...extractMentions('title', v.title, gazetteer, THRESHOLDS),
    ...(v.description ? extractMentions('description', v.description, gazetteer, THRESHOLDS) : []),
  ].slice(0, THRESHOLDS.maxCandidates)
  const postcodePoints = new Map<string, LocationPoint>()
  for (const m of mentions) {
    if (m.kind !== 'postcode_full' || m.rejection || postcodePoints.has(m.value)) continue
    const point = await lookup(q, m.value)
    if (point) postcodePoints.set(m.value, point)
  }
  const candidates: Candidate[] = candidatesFrom(
    mentions,
    postcodePoints,
    field,
    gazetteer,
    THRESHOLDS,
  )
  const decision = decide(pass, field, candidates, THRESHOLDS)
  const redactedQuotes = candidates.map((c) => {
    const text = c.source === 'title' ? v.title : (v.description ?? '')
    const from = Math.max(0, c.start - 30)
    return redact(text.slice(from, Math.min(text.length, c.end + 30))).text
  })
  return {
    version: v,
    pass,
    decision,
    candidates,
    redactedQuotes,
    fieldLabel: field.label,
    fieldPoint: field.point,
  }
}

/** Whether a new resolution replaces the listing's current row. */
function wins(pass: PickupLocationPass, v: Version, old: CurrentRow | undefined): boolean {
  if (!old) return true
  if (old.pass === 'card' && pass === 'detail') return true
  if (old.pass === 'detail' && pass === 'card') return false
  return old.inputFetchedAt === null || v.inputFetchedAt >= old.inputFetchedAt
}

function currentFrom(r: ResolutionRow, resolutionId: string): CurrentWrite {
  const d = r.decision
  const shown = d.display?.point ? d.display : null
  return {
    listingId: r.version.listingId,
    resolutionId,
    pass: r.pass,
    evidenceHash: r.version.evidenceHash,
    status: d.status,
    basis: d.basis,
    source: d.source,
    decidedBy: 'rules',
    conflict: d.conflict,
    approximate: d.approximate,
    townOrArea: shown?.label ?? null,
    areaId: shown?.areaId ?? null,
    areaDistrict: d.district,
    lat: shown?.point?.lat ?? null,
    lng: shown?.point?.lng ?? null,
    noteCode: d.noteCode,
    notePlaceLabel: d.notePlaceLabel,
    listedInLabel: d.listedInLabel,
  }
}

const USER_VISIBLE: (keyof CurrentWrite)[] = [
  'status',
  'conflict',
  'approximate',
  'townOrArea',
  'areaId',
  'areaDistrict',
  'lat',
  'lng',
  'noteCode',
  'notePlaceLabel',
  'listedInLabel',
]

function moved(old: CurrentRow | undefined, next: CurrentWrite): boolean {
  if (!old) return true
  return USER_VISIBLE.some((k) => (old as unknown as CurrentWrite)[k] !== next[k])
}

function movedHandover(
  old: ReturnType<typeof handoverFrom> | undefined,
  next: ReturnType<typeof handoverFrom>,
): boolean {
  if (!old) return true
  return (Object.keys(next) as (keyof typeof next)[]).some((k) => old[k] !== next[k])
}

/**
 * The point to measure distance from for each listing, for `spec-match`, `notifier` and
 * procedures. On: the resolved display point (a gazetteer centroid). Off or shadow: exactly the
 * same fallback for both, so shadow changes nothing users see (README.md, "Switch"): listing-
 * ingest's town label snapped to its city page's point, marked approximate, basis `fallback`.
 * A listing with no point is missing from the result ("distance unknown"); nothing here is ever
 * a listing's own coordinates.
 */
export async function pointsFor(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, PickupLocationPoint>> {
  const out = new Map<string, PickupLocationPoint>()
  const ids = [...new Set(listingIds)]
  if (ids.length === 0) return out
  const gazetteer = buildGazetteer(await selectCityPages(q))
  if ((await state(q, MODULE)) === 'on') {
    const rows = await selectCurrent(q, ids)
    for (const [listingId, row] of rows) {
      if (row.lat === null || row.lng === null || !row.townOrArea) continue
      out.set(listingId, {
        listingId,
        point: { lat: row.lat, lng: row.lng },
        townOrArea: row.townOrArea,
        approximate: row.approximate,
        basis: row.basis,
      })
    }
  }
  const missing = ids.filter((id) => !out.has(id))
  for (const card of await selectCardFields(q, missing)) {
    const field = fieldFrom(
      { cityPageId: card.cityPageId, townLabel: card.townLabel, coordinates: null },
      gazetteer,
    )
    if (!field.display?.point) continue
    out.set(card.listingId, {
      listingId: card.listingId,
      point: field.display.point,
      townOrArea: field.display.label,
      approximate: true,
      basis: 'fallback',
    })
  }
  return out
}

/**
 * Stores a reviewer's correction (for `review-console`) and applies it to the listing's current
 * row. The caller has checked the reviewer's session and passes the pipeline transaction. Runs
 * whatever the switch says: a correction is never lost.
 */
export async function applyOverride(
  q: Queryable,
  override: PickupLocationOverride,
): Promise<Result<{ applied: true }, AppError>> {
  const o = PickupLocationOverride.parse(override)
  const gazetteer = buildGazetteer(await selectCityPages(q))
  const place = gazetteer.byAreaId.get(o.areaId)
  if (!place?.point) {
    return err({
      code: 'pickup-location.area_not_found',
      message: `No gazetteer area ${o.areaId} with a point.`,
    })
  }
  await upsertOverride(q, {
    listingId: o.listingId,
    areaId: place.areaId,
    townOrArea: place.label,
    lat: place.point.lat,
    lng: place.point.lng,
    by: o.by,
    reason: o.reason,
  })
  const [existing] = [...(await selectCurrent(q, [o.listingId])).values()]
  if (existing) {
    await upsertCurrent(q, [
      {
        ...(existing as unknown as CurrentWrite),
        resolutionId: existing.resolutionId,
        decidedBy: 'review',
        status: 'confirmed',
        basis: 'fallback',
        townOrArea: place.label,
        areaId: place.areaId,
        areaDistrict: null,
        lat: place.point.lat,
        lng: place.point.lng,
        approximate: false,
        conflict: false,
        noteCode: null,
        notePlaceLabel: null,
        listedInLabel: null,
      },
    ])
  }
  return ok({ applied: true })
}

/**
 * Removes everything this module holds about these listings (rule 12: `seller-rights` erasure).
 * Runs whatever the switch says. Returns how many current rows were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, PICKUP_LOCATION_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
