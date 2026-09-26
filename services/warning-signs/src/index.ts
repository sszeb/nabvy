// Public API of the warning-signs module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/warning-signs' only, never from its internals. It computes
// listing-level warning facts, each with its evidence, rule ID and version (README.md): neutral
// facts for users and inputs for the scam review. It scores nothing, labels nothing and never
// holds an alert.

import {
  WARNING_SIGNS_EVENT_BATCH_SIZE,
  WARNING_SIGNS_RULES,
} from '@nabvy/config/modules/warning-signs'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { events } from '@nabvy/contracts/modules/warning-signs'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import {
  type Announced,
  chunk,
  compile,
  type Evaluation,
  evaluateOne,
  foundKey,
  ruleVersion,
} from './domain'
import {
  deleteListings,
  selectGroupListings,
  selectInputs,
  selectLatest,
  writeEvaluations,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/warning-signs'
export {
  clauses,
  compile,
  evaluateOne,
  inputHash,
  isFacebookHost,
  lowestGroup,
  payFirstOf,
  phrasePattern,
  ruleVersion,
} from './domain'
export {
  askingPriceIndexUpdatedHandler,
  detailEvidenceChangedHandler,
  listingAssessmentAssessedHandler,
} from './handlers'

const MODULE = 'warning-signs'

/** The rule version of the configured rules. */
export const WARNING_SIGNS_RULE_VERSION = ruleVersion(WARNING_SIGNS_RULES)
const COMPILED = compile(WARNING_SIGNS_RULES)

/** What one `evaluate` call did. */
export interface EvaluateReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  /** Listings with a current version and a card. */
  listings: number
  /** Listings whose latest stored evaluation already matches every input. */
  current: number
  /** Evaluations newly written (an earlier one made latest again is not counted). */
  written: number
  /** Listings whose latest evaluation matches their current inputs after this call. */
  found: string[]
  /** `warning-signs.found` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

const empty = (): EvaluateReport => ({
  open: false,
  listings: 0,
  current: 0,
  written: 0,
  found: [],
  events: [],
})

const same = (a: Announced & { cardHash: string }, b: Evaluation) =>
  a.evidenceHash === b.evidenceHash &&
  a.cardHash === b.cardHash &&
  a.inputHash === b.inputHash &&
  a.ruleVersion === b.ruleVersion

/**
 * Evaluates the current version of each listing (up to 500 IDs): reads the text, the card, the
 * assessment's cautions and exclusions and the index groups, applies the rules and writes one
 * evaluation with its facts wherever the listing's latest stored evaluation differs, with `now`
 * as the done time. Safe to run twice: the second run writes nothing and returns the same event
 * key, which the transport drops. Listings with no current version or no card are skipped.
 */
export async function evaluate(
  q: Queryable,
  input: { listingIds: string[]; now: Date },
): Promise<Result<EvaluateReport, AppError>> {
  const report = empty()
  if (input.listingIds.length > WARNING_SIGNS_EVENT_BATCH_SIZE) {
    return err({
      code: 'warning-signs.too_many_listings',
      message: `A batch holds at most ${WARNING_SIGNS_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const listingIds = [...new Set(input.listingIds)]
  const inputs = await selectInputs(q, listingIds)
  report.listings = inputs.length
  if (inputs.length === 0) return ok(report)

  const latest = await selectLatest(q, listingIds)
  const rows: Evaluation[] = []
  for (const i of inputs) {
    const e = evaluateOne(i, COMPILED, WARNING_SIGNS_RULE_VERSION)
    const stored = latest.get(e.listingId)
    if (stored && same(stored, e)) {
      report.current += 1
      continue
    }
    rows.push(e)
  }
  report.written = await writeEvaluations(q, rows, input.now)

  // Every listing among the input whose latest evaluation is now stored: derived from stored
  // rows, so a replay publishes the same keys.
  const after = await selectLatest(q, listingIds)
  const done = inputs
    .map((i) => after.get(i.listingId))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .sort((a, b) => a.listingId.localeCompare(b.listingId))
  report.found = done.map((r) => r.listingId)
  report.events = chunk(done, WARNING_SIGNS_EVENT_BATCH_SIZE).map((batch, i) =>
    createEvent(
      events,
      'warning-signs.found',
      1,
      { listingIds: batch.map((r) => r.listingId) },
      { key: foundKey(batch, i) },
    ),
  ) as EventEnvelope[]
  return ok(report)
}

/**
 * Re-evaluates every listing whose ask is a member of these index groups (the
 * `asking-price-index.updated` payload), 500 listings at a time, and returns the combined report.
 */
export async function evaluateGroups(
  q: Queryable,
  input: { groupKeys: string[]; now: Date },
): Promise<Result<EvaluateReport, AppError>> {
  const total = empty()
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(total)
  const listingIds = await selectGroupListings(q, input.groupKeys)
  for (const batch of chunk(listingIds, WARNING_SIGNS_EVENT_BATCH_SIZE)) {
    const result = await evaluate(q, { listingIds: batch, now: input.now })
    if (!result.ok) return result
    const r = result.value
    total.open = r.open
    total.listings += r.listings
    total.current += r.current
    total.written += r.written
    total.found.push(...r.found)
    total.events.push(...r.events)
  }
  return ok(total)
}

/**
 * Removes the evaluations and facts of these listings (rule 12: `seller-rights` erasure). Runs
 * whatever the switch says. Returns how many evaluations were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, WARNING_SIGNS_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
