// Event handlers of the spend-governor module. A settled Apify run changes committed spend, so a
// batch of `apify-gateway.run-settled` events triggers one recompute for the whole batch (rule 9);
// the scheduled recompute task calls `recompute` directly. Safe to run twice: a second recompute
// at the same time writes nothing, and alert keys repeat.
import type { EventEnvelope } from '@nabvy/contracts'
import type { Queryable } from '@nabvy/db'
import { type RecomputeReport, recompute } from '../index'

export async function onRunSettled(
  q: Queryable,
  batch: EventEnvelope[],
  deps: { now: string; usdGbpRate: number },
): Promise<RecomputeReport> {
  const settled = batch.filter((e) => e.type === 'apify-gateway.run-settled')
  if (settled.length === 0) return { written: [], events: [] }
  const result = await recompute(q, deps)
  // Off: acknowledge and write nothing (rule 11); v_throttle already holds paid work.
  return result.ok ? result.value : { written: [], events: [] }
}
