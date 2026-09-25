// Public API of the noise-filter module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/noise-filter' only, never from its internals. It marks listings
// that are not real offers of what someone searched for with reason codes (README.md). Nothing
// is deleted and nothing is hidden here: spec-match applies the reasons with a visible count.

import {
  NOISE_FILTER_EVENT_BATCH_SIZE,
  NOISE_FILTER_RULES,
} from '@nabvy/config/modules/noise-filter'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { events } from '@nabvy/contracts/modules/noise-filter'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import { chunk, classifiedKey, classifyOne, compile, ruleVersion } from './domain'
import {
  type ClassificationRow,
  deleteListings,
  insertClassifications,
  selectInputs,
  selectLatest,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/noise-filter'
export {
  advertReasons,
  classifyOne,
  compile,
  inputHash,
  ruleVersion,
  serviceReasons,
  termReasons,
  termStatuses,
} from './domain'
export { listingAssessmentAssessedHandler } from './handlers'

const MODULE = 'noise-filter'

/** The rule version of the configured rules. */
export const NOISE_FILTER_RULE_VERSION = ruleVersion(NOISE_FILTER_RULES)
const COMPILED = compile(NOISE_FILTER_RULES)

/** What one `classify` call did. */
export interface ClassifyReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  /** Listings whose current version has an assessment. */
  listings: number
  /** Versions whose latest stored classification already matches every input. */
  current: number
  written: number
  /** Listings whose current version now has a classification. */
  classified: string[]
  /** `noise-filter.classified` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

const keyOf = (r: { listingId: string; evidenceHash: string }) => `${r.listingId}@${r.evidenceHash}`

/**
 * Classifies the current version of each listing (the `listing-assessment.assessed` payload, up
 * to 500 IDs): reads the assessment's kind and form, the parts record, the parts-rules signals
 * and tag blocks, the text and the found-by terms, applies the rules and writes one
 * classification per version whose inputs (input hash, rule version) differ from the stored
 * latest, with `now` as its done time. Safe to run twice: the second run writes nothing and
 * returns the same event key, which the transport drops. Listings with no current version or no
 * assessment of it are skipped.
 */
export async function classify(
  q: Queryable,
  input: { listingIds: string[]; now: Date },
): Promise<Result<ClassifyReport, AppError>> {
  const report: ClassifyReport = {
    open: false,
    listings: 0,
    current: 0,
    written: 0,
    classified: [],
    events: [],
  }
  if (input.listingIds.length > NOISE_FILTER_EVENT_BATCH_SIZE) {
    return err({
      code: 'noise-filter.too_many_listings',
      message: `A batch holds at most ${NOISE_FILTER_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const listingIds = [...new Set(input.listingIds)]
  const inputs = await selectInputs(q, listingIds)
  report.listings = inputs.length
  if (inputs.length === 0) return ok(report)

  const latest = await selectLatest(q, listingIds)
  const rows: ClassificationRow[] = []
  for (const i of inputs) {
    const c = classifyOne(i, COMPILED, NOISE_FILTER_RULE_VERSION)
    const stored = latest.get(keyOf(c))
    if (stored && stored.inputHash === c.inputHash && stored.ruleVersion === c.ruleVersion) {
      report.current += 1
      continue
    }
    rows.push({ ...c, classifiedAt: input.now })
  }
  report.written = await insertClassifications(q, rows)

  // Every listing among the input whose current version has a classification, stored now or
  // before: derived from stored rows, so a replay publishes the same keys.
  const after = await selectLatest(q, listingIds)
  const done = inputs
    .map((i) => after.get(keyOf(i)))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .sort((a, b) => a.listingId.localeCompare(b.listingId))
  report.classified = done.map((r) => r.listingId)
  report.events = chunk(done, NOISE_FILTER_EVENT_BATCH_SIZE).map((batch, i) =>
    createEvent(
      events,
      'noise-filter.classified',
      1,
      { listingIds: batch.map((r) => r.listingId) },
      { key: classifiedKey(batch, i) },
    ),
  ) as EventEnvelope[]
  return ok(report)
}

/**
 * Removes the classifications of these listings (rule 12: `seller-rights` erasure). Runs
 * whatever the switch says. Returns how many rows were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, NOISE_FILTER_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
