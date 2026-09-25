// Public API of the parts-record module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/parts-record' only, never from its internals. It keeps one
// versioned parts record per listing version, merged from the rule rows, the AI rows and (later)
// the photo verdicts, and owns the listing kind (README.md). It decides nothing about containers
// or GPU state (listing-assessment) and prices nothing.

import { PARTS_RECORD_EVENT_BATCH_SIZE } from '@nabvy/config/modules/parts-record'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import {
  events,
  PartsRecordCorrection,
  type PartsRecordPhotoVerdict,
} from '@nabvy/contracts/modules/parts-record'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import {
  addsInformation,
  carryCorrections,
  chunk,
  merge,
  type PhotoInput,
  recordedKey,
  type Versions,
} from './domain'
import {
  deleteListings,
  insertRecords,
  type RecordRow,
  selectCorrected,
  selectFamilies,
  selectInputs,
  selectLatest,
  selectNow,
  updateCorrection,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/parts-record'
export { findConflicts, merge, mergeKind } from './domain'
export { partsAiExtractedHandler, partsRulesRanHandler } from './handlers'

const MODULE = 'parts-record'

/**
 * The photo-review seam (docs/design/modules/soft-edges.json): the verdicts over these listing
 * versions, grouped by version. `photo-review` does not exist yet, so the default returns none
 * and every record's `photo_version` stays null: a photo never read is "not stated", never "no".
 */
export type PhotoVerdicts = (
  q: Queryable,
  versions: ReadonlyArray<{ listingId: string; evidenceHash: string }>,
) => Promise<PartsRecordPhotoVerdict[]>

export const noPhotoVerdicts: PhotoVerdicts = async () => []

export interface PartsRecordDeps {
  photoVerdicts?: PhotoVerdicts
}

/** What one `record` call did. */
export interface RecordReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  /** Listings with a current version the rules have run over. */
  listings: number
  /** Versions whose stored record already holds every input version (nothing to add). */
  current: number
  recordsWritten: number
  partsWritten: number
  /** Listings whose current version now has a record. */
  recorded: string[]
  /** `parts-record.recorded` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Records the current version of each listing (the `parts-rules.ran` or `parts-ai.extracted`
 * payload, up to 500 IDs): reads `v_current`, the rules' latest run over it with its hits and
 * kind signals, parts-ai's latest extracted call with its parts, the photo verdicts through the
 * injected seam and the catalogue's families, merges them into one record per version, and
 * writes it when it adds an input version the stored record lacks. Safe to run twice: the
 * second run writes nothing and returns the same event key, which the transport drops. Listings
 * with no current version or no rules run (parts-rules or detail-evidence off, or not run yet)
 * are skipped: with no rules row there is nothing to record.
 */
export async function record(
  q: Queryable,
  input: { listingIds: string[] },
  deps: PartsRecordDeps = {},
): Promise<Result<RecordReport, AppError>> {
  const report: RecordReport = {
    open: false,
    listings: 0,
    current: 0,
    recordsWritten: 0,
    partsWritten: 0,
    recorded: [],
    events: [],
  }
  if (input.listingIds.length > PARTS_RECORD_EVENT_BATCH_SIZE) {
    return err({
      code: 'parts-record.too_many_listings',
      message: `A batch holds at most ${PARTS_RECORD_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const listingIds = [...new Set(input.listingIds)]
  const inputs = await selectInputs(q, listingIds)
  report.listings = inputs.length
  if (inputs.length === 0) return ok(report)

  const verdicts = await (deps.photoVerdicts ?? noPhotoVerdicts)(q, inputs)
  const photoByVersion = new Map<string, PhotoInput>()
  for (const v of verdicts) {
    const key = `${v.listingId}@${v.evidenceHash}`
    const entry = photoByVersion.get(key) ?? { photoVersion: v.photoVersion, verdicts: [] }
    entry.verdicts.push(v)
    photoByVersion.set(key, entry)
  }
  const families = await selectFamilies(
    q,
    [
      ...inputs.flatMap((i) => [
        ...i.rules.parts.map((p) => p.catalogueId),
        ...(i.ai?.parts.map((p) => p.catalogueId) ?? []),
      ]),
      ...verdicts.map((v) => v.catalogueId),
    ].filter((id): id is string => id !== null),
  )
  const latest = await selectLatest(q, listingIds)
  const merged = inputs.map((i) =>
    merge({
      ...i,
      photo: photoByVersion.get(`${i.listingId}@${i.evidenceHash}`) ?? null,
      families,
    }),
  )
  const todo = merged.filter((m) => {
    const stored = latest.get(`${m.listingId}@${m.evidenceHash}`) ?? null
    if (addsInformation(m, stored)) return true
    report.current += 1
    return false
  })

  // A re-merge keeps the reviewer's corrections where the same evidence is found again.
  const previous = todo
    .map((m) => latest.get(`${m.listingId}@${m.evidenceHash}`)?.id)
    .filter((id): id is string => id !== undefined)
  const corrected = await selectCorrected(q, previous)
  const rows: RecordRow[] = todo.map((m) => {
    const before = latest.get(`${m.listingId}@${m.evidenceHash}`)
    return {
      ...m,
      corrections: carryCorrections(
        corrected.filter((c) => c.recordId === before?.id) as Parameters<
          typeof carryCorrections
        >[0],
        m.parts,
      ),
    }
  })
  const written = await insertRecords(q, rows)
  report.recordsWritten = written.records
  report.partsWritten = written.parts

  // Every listing among the input whose current version has a record, stored now or before,
  // with the versions that record merged: derived from stored rows, so a replay publishes the
  // same keys.
  const after = await selectLatest(q, listingIds)
  const current = inputs
    .map((i) => after.get(`${i.listingId}@${i.evidenceHash}`))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .sort((a, b) => a.listingId.localeCompare(b.listingId))
  report.recorded = current.map((r) => r.listingId)
  report.events = chunk(current, PARTS_RECORD_EVENT_BATCH_SIZE).map((batch, i) =>
    createEvent(
      events,
      'parts-record.recorded',
      1,
      { listingIds: batch.map((r) => r.listingId) },
      { key: recordedKey(batch as (Versions & { listingId: string; evidenceHash: string })[], i) },
    ),
  ) as EventEnvelope[]
  return ok(report)
}

/**
 * Stores a reviewer's correction beside one part of the latest record of a listing version (for
 * `review-console`). The caller has checked the reviewer's session and passes the pipeline
 * transaction. Runs whatever the switch says, like erasure: a correction is never lost. The
 * views show the corrected inclusion, and a re-merge carries the correction forward.
 */
export async function applyCorrection(
  q: Queryable,
  correction: PartsRecordCorrection,
): Promise<Result<{ applied: true }, AppError>> {
  const c = PartsRecordCorrection.parse(correction)
  const applied = await updateCorrection(q, c, {
    ...(c.inclusion !== undefined ? { inclusion: c.inclusion } : {}),
    ...(c.rejected !== undefined ? { rejected: c.rejected } : {}),
    by: c.by,
    reason: c.reason,
    at: await selectNow(q),
  })
  if (!applied) {
    return err({
      code: 'parts-record.part_not_found',
      message: `No part ${c.seq} on the latest record of listing ${c.listingId} at ${c.evidenceHash}.`,
    })
  }
  return ok({ applied: true })
}

/**
 * Removes the records and parts of these listings (rule 12: `seller-rights` erasure). Runs
 * whatever the switch says. Returns how many records were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, PARTS_RECORD_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
