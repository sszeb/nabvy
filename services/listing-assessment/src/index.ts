// Public API of the listing-assessment module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/listing-assessment' only, never from its internals. It
// decides what a listing version is and what its parts let us conclude (container, form, GPU
// state, confirmed parts, exclusions, cautions, coverage) and stamps T3 (README.md). It reads the
// listing kind from parts-record and stores none; it prices nothing, hides nothing and labels no
// behaviour.

import {
  LISTING_ASSESSMENT_EVENT_BATCH_SIZE,
  LISTING_ASSESSMENT_RULES,
} from '@nabvy/config/modules/listing-assessment'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { events, ListingAssessmentCorrection } from '@nabvy/contracts/modules/listing-assessment'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import { assessedKey, assessOne, chunk, ruleVersion } from './domain'
import {
  type AssessmentRow,
  deleteListings,
  insertAssessments,
  selectInputs,
  selectLatest,
  selectNow,
  updateCorrection,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/listing-assessment'
export {
  assessOne,
  confirmedOf,
  containerOf,
  exclusionsOf,
  extrasOf,
  gpuStateOf,
  recordHash,
  ruleVersion,
} from './domain'
export { partsRecordRecordedHandler } from './handlers'

const MODULE = 'listing-assessment'

/** The rule version of the configured rules. */
export const LISTING_ASSESSMENT_RULE_VERSION = ruleVersion(LISTING_ASSESSMENT_RULES)

/** What one `assess` call did. */
export interface AssessReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  /** Listings whose current version has a parts record. */
  listings: number
  /** Versions whose latest stored assessment already matches every input (nothing to add). */
  current: number
  written: number
  /** Listings whose current version now has an assessment. */
  assessed: string[]
  /** `listing-assessment.assessed` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

const keyOf = (r: { listingId: string; evidenceHash: string }) => `${r.listingId}@${r.evidenceHash}`

/**
 * Assesses the current version of each listing (the `parts-record.recorded` payload, up to 500
 * IDs): reads `v_current` and `v_text`, the parts record's kind and parts, and listing-ingest's
 * card, applies the rules and writes one assessment per version whose inputs (card hash, record
 * hash, rule version) differ from the stored latest, with `now` as T3. A reviewer's correction on
 * the latest assessment of the same version is carried onto the new row. Safe to run twice: the
 * second run writes nothing and returns the same event key, which the transport drops. Listings
 * with no current version or no parts record for it are skipped.
 */
export async function assess(
  q: Queryable,
  input: { listingIds: string[]; now: Date },
): Promise<Result<AssessReport, AppError>> {
  const report: AssessReport = {
    open: false,
    listings: 0,
    current: 0,
    written: 0,
    assessed: [],
    events: [],
  }
  if (input.listingIds.length > LISTING_ASSESSMENT_EVENT_BATCH_SIZE) {
    return err({
      code: 'listing-assessment.too_many_listings',
      message: `A batch holds at most ${LISTING_ASSESSMENT_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const listingIds = [...new Set(input.listingIds)]
  const inputs = await selectInputs(q, listingIds)
  report.listings = inputs.length
  if (inputs.length === 0) return ok(report)

  const latest = await selectLatest(q, listingIds)
  const rows: AssessmentRow[] = []
  for (const i of inputs) {
    const a = assessOne(i, LISTING_ASSESSMENT_RULES, LISTING_ASSESSMENT_RULE_VERSION)
    const stored = latest.get(keyOf(a))
    if (
      stored &&
      stored.cardHash === a.cardHash &&
      stored.recordHash === a.recordHash &&
      stored.ruleVersion === a.ruleVersion
    ) {
      report.current += 1
      continue
    }
    rows.push({ ...a, assessedAt: input.now, correction: stored?.correction ?? null })
  }
  report.written = await insertAssessments(q, rows)

  // Every listing among the input whose current version has an assessment, stored now or
  // before: derived from stored rows, so a replay publishes the same keys.
  const after = await selectLatest(q, listingIds)
  const done = inputs
    .map((i) => after.get(keyOf(i)))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .sort((a, b) => a.listingId.localeCompare(b.listingId))
  report.assessed = done.map((r) => r.listingId)
  report.events = chunk(done, LISTING_ASSESSMENT_EVENT_BATCH_SIZE).map((batch, i) =>
    createEvent(
      events,
      'listing-assessment.assessed',
      1,
      { listingIds: batch.map((r) => r.listingId) },
      { key: assessedKey(batch, i) },
    ),
  ) as EventEnvelope[]
  return ok(report)
}

/**
 * Stores a reviewer's correction (form, container or GPU state) beside the latest assessment of
 * a listing version, for `review-console`. The caller has checked the reviewer's session and
 * passes the pipeline transaction. Runs whatever the switch says, like erasure: a correction is
 * never lost. The views show the corrected values, and a re-assessment of the same version
 * carries the correction forward.
 */
export async function applyCorrection(
  q: Queryable,
  correction: ListingAssessmentCorrection,
): Promise<Result<{ applied: true }, AppError>> {
  const c = ListingAssessmentCorrection.parse(correction)
  const applied = await updateCorrection(q, c, {
    ...(c.form !== undefined ? { form: c.form } : {}),
    ...(c.container !== undefined ? { container: c.container } : {}),
    ...(c.gpuState !== undefined ? { gpuState: c.gpuState } : {}),
    by: c.by,
    reason: c.reason,
    at: await selectNow(q),
  })
  if (!applied) {
    return err({
      code: 'listing-assessment.not_found',
      message: `No assessment of listing ${c.listingId} at ${c.evidenceHash}.`,
    })
  }
  return ok({ applied: true })
}

/**
 * Removes the assessments of these listings (rule 12: `seller-rights` erasure). Runs whatever
 * the switch says. Returns how many rows were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, LISTING_ASSESSMENT_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
