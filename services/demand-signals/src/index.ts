// Public API of the demand-signals module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/demand-signals' only, never from its internals. It publishes, once
// per closed week, want counts and wanted or swap advert counts per search centre and catalogue
// family, with every count under 10 suppressed; never anything by user or seller (README.md).

import {
  DEMAND_SIGNALS_RULE_VERSION,
  DEMAND_SIGNALS_SUPPRESSION_THRESHOLD,
} from '@nabvy/config/modules/demand-signals'
import { createEvent, type EventEnvelope, err, ok, type Result } from '@nabvy/contracts'
import {
  DemandSignalsCell,
  type DemandSignalsError,
  DemandSignalsPublishInput,
  events,
} from '@nabvy/contracts/modules/demand-signals'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { buildCells, isClosed, lastClosedWeek, publishedKey, weekRange } from './domain'
import {
  insertCells,
  lockWeek,
  selectAdverts,
  selectCells,
  selectWantTerms,
  weekPublished,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/demand-signals'
export { lastClosedWeek, weekStartOf } from './domain'

export interface PublishReport {
  /** The module's switch state when the call ran; off writes nothing (rule 11). */
  state: 'off' | 'shadow' | 'on'
  weekStart: string
  /** Cells written by this call: 0 for a replay of a published week. */
  written: number
  /** Cells of the week at this rule version, after the call. */
  cells: number
  /** `demand-signals.published` for the caller to publish after commit; none when off or empty. */
  events: EventEnvelope[]
}

/**
 * Publishes one closed week: reads the want counts and the week's wanted or swap adverts,
 * builds the cells, suppresses every count under the threshold, and writes them once. A week
 * already published at this rule version writes nothing and returns the same event key, so a
 * replay, a retry or a concurrent duplicate is harmless (the week's advisory lock serialises
 * them). Off: acknowledges and writes nothing. Run inside `withPipeline`.
 */
export async function publishWeek(
  q: Queryable,
  input: unknown,
  now: Date,
): Promise<Result<PublishReport, DemandSignalsError>> {
  const parsed = DemandSignalsPublishInput.safeParse(input)
  if (!parsed.success) {
    return err({ code: 'demand-signals.invalid_input', message: parsed.error.message })
  }
  const { weekStart } = parsed.data
  if (!isClosed(weekStart, now)) {
    return err({
      code: 'demand-signals.week_not_closed',
      message: `week ${weekStart} has not ended`,
    })
  }
  const switchState = await state(q, 'demand-signals')
  if (switchState === 'off') {
    return ok({ state: switchState, weekStart, written: 0, cells: 0, events: [] })
  }

  const ruleVersion = DEMAND_SIGNALS_RULE_VERSION
  await lockWeek(q, weekStart, ruleVersion)
  let written = 0
  if (!(await weekPublished(q, weekStart, ruleVersion))) {
    const { from, to } = weekRange(weekStart)
    const [wants, adverts] = [await selectWantTerms(q), await selectAdverts(q, from, to)]
    const drafts = buildCells(wants, adverts, DEMAND_SIGNALS_SUPPRESSION_THRESHOLD)
    written = await insertCells(q, weekStart, ruleVersion, drafts)
  }

  const stored = (await listCells(q, weekStart)).filter((c) => c.ruleVersion === ruleVersion)
  const envelopes =
    stored.length === 0
      ? []
      : [
          createEvent(
            events,
            'demand-signals.published',
            1,
            { weekStart },
            { key: publishedKey(weekStart, ruleVersion) },
          ) as EventEnvelope,
        ]
  return ok({ state: switchState, weekStart, written, cells: stored.length, events: envelopes })
}

/** Publishes the latest closed week at `now`: the weekly job's one call. */
export function publishLastClosedWeek(q: Queryable, now: Date) {
  return publishWeek(q, { weekStart: lastClosedWeek(now) }, now)
}

/**
 * The week's cells through the internal view `v_cells`, parsed with the contract (empty while the
 * module is off). For internal readers; no user-facing path exists (README.md, "Outputs").
 */
export async function listCells(q: Queryable, weekStart: string): Promise<DemandSignalsCell[]> {
  const rows = await selectCells(q, weekStart)
  return rows.map((r) =>
    DemandSignalsCell.parse({ ...r, publishedAt: new Date(r.publishedAt).toISOString() }),
  )
}
export { runWeekly, type WeeklyDeps } from './handlers'
