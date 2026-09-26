// Handlers. The module consumes no event to do its work: a week is published on a schedule, from
// the views as they stand when the week has closed (README.md, "Decisions"). The weekly job is
// thin: one transaction, one call, the events handed back for publishing after commit.
import type { EventEnvelope } from '@nabvy/contracts'
import type { Queryable } from '@nabvy/db'
import { publishLastClosedWeek } from '../index'

export interface WeeklyDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/** The weekly job: publish the latest closed week; returns the events to publish after commit. */
export async function runWeekly(deps: WeeklyDeps, now: Date): Promise<EventEnvelope[]> {
  const result = await deps.transaction((q) => publishLastClosedWeek(q, now))
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value.events
}
