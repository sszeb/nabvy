// Event handlers. Each takes a batch, is idempotent on its natural key and writes only this
// module's tables (CLAUDE.md; _rules.md rules 8-10).

import { RunCoverageSearchDegradedEvent } from '@nabvy/contracts/modules/run-coverage'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { rerunnable } from '../domain'
import { insertRun, selectDegradedSearches, selectRunsByJob } from '../repo'

/**
 * `run-coverage.search-degraded` v1: queues one rerun per degraded search of this module's own
 * runs (card: "Reruns degraded searches"; the test "a degraded search reruns once"). The rerun is
 * a `pending` row the next tick sends in its region's slot, under the throttle and the ramp. Key:
 * the degraded search's ID (unique `rerun_of`), so a replayed event queues nothing new, and a
 * rerun's own degraded search is never rerun. Searches with no centre or term (the search URL
 * named none) cannot be repeated and are skipped. Off: acknowledges and writes nothing.
 */
export async function onSearchDegraded(q: Queryable, payloads: unknown[]): Promise<number> {
  if ((await state(q, 'check-scheduler')) === 'off') return 0
  const events = payloads.map((p) => RunCoverageSearchDegradedEvent.parse(p))
  const searchIds = [...new Set(events.flatMap((e) => e.searchIds))]
  const searches = await selectDegradedSearches(q, searchIds)
  const runs = await selectRunsByJob(q, [...new Set(searches.map((s) => s.jobId))])
  let queued = 0
  for (const search of rerunnable(searches, runs)) {
    const run = runs.get(search.jobId)
    if (!run || search.centreId === null || search.term === null) continue
    const inserted = await insertRun(q, {
      centreId: search.centreId,
      kind: run.kind,
      shape: run.shape,
      terms: [search.term],
      reason: 'rerun',
      status: 'pending',
      tickAt: null,
      jobId: null,
      rerunOf: search.id,
    })
    if (inserted) queued += 1
  }
  return queued
}
