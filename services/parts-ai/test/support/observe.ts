import type { RunReport } from '../../src'
import type { TestDatabase } from './database'

type Json = Record<string, unknown>

/** A fixture case's input (README.md, "Fixtures and pass rate"). */
export interface CaseInput {
  run: string
  /** Only these source listing IDs' rows (plus the run's other records). */
  only?: string[]
  /** Field edits per source listing ID (synthetic). */
  edits?: { listingId: string; fields: Json }[]
  /** Recorded responses for this case, per source listing ID, over the shared recording. */
  responses?: Record<string, import('../../src').PartsAiResponse>
  /** A second collected job with these further edits, run after the first (cache cases). */
  second?: { listingId: string; fields: Json }[]
}

/**
 * What a case checks: per listing (only those the expectation names), how the call ended, the
 * kind and the parts, as the views give them; the report's counts; the model calls made; and the
 * details-queue items this module asked for.
 */
export async function observe(
  t: TestDatabase,
  report: RunReport,
  modelCalls: number,
  expected: Json,
): Promise<Json> {
  const listings: Record<string, Json> = {}
  const of = (sid: string) => {
    listings[sid] ??= { status: 'none', parts: [] }
    return listings[sid] as { parts: string[] } & Json
  }
  const sids = await t.asPipeline(
    'select id, source_listing_id as sid from listing_ingest.v_listings',
  )
  for (const row of sids) of(row.sid as string)
  for (const r of await t.asPipeline(
    `select l.source_listing_id as sid, r.status, r.kind, r.kind_source, r.kind_quote,
            q.problem
     from parts_ai.v_runs r
     join listing_ingest.v_listings l on l.id = r.listing_id
     join detail_evidence.v_current c on c.listing_id = r.listing_id and c.evidence_hash = r.evidence_hash
     left join parts_ai.v_quarantine q on q.listing_id = r.listing_id
       and q.evidence_hash = r.evidence_hash and q.prompt_version = r.prompt_version`,
  )) {
    const o = of(r.sid as string)
    o.status = r.problem ? `quarantined:${r.problem}` : (r.status as string)
    if (r.kind) o.kind = `${r.kind_source}:${r.kind}:${r.kind_quote}`
  }
  for (const p of await t.asPipeline(
    `select l.source_listing_id as sid, p.source, p.part_type, p.quote, p.catalogue_id, p.family,
            p.inclusion
     from parts_ai.v_ai_parts p join listing_ingest.v_listings l on l.id = p.listing_id
     order by p.seq`,
  )) {
    const target = p.catalogue_id ? ` → ${p.catalogue_id}` : p.family ? ` (${p.family})` : ''
    of(p.sid as string).parts.push(
      `${p.source}:${p.part_type}:${p.quote}${target} [${p.inclusion}]`,
    )
  }
  const observed: Json = {}
  if (expected.report) {
    const want = expected.report as Json
    const got: Json = {
      openVersions: report.openVersions,
      cached: report.cached,
      called: report.called,
      extracted: report.extracted,
      quarantined: report.quarantined,
      refreshRequested: report.refreshRequested.length,
      deferred: report.deferred.length,
      failed: report.failed.length,
      paused: report.paused ?? null,
      modelCalls,
      events: report.events.map((e) => (e.payload as { listingIds: string[] }).listingIds.length),
    }
    observed.report = Object.fromEntries(Object.keys(want).map((k) => [k, got[k]]))
  }
  if (expected.queue) {
    observed.queue = (
      await t.asPipeline(
        `select source_listing_id as sid, reason, requested_by, priority
         from details_queue.items order by source_listing_id`,
      )
    ).map((r) => `${r.sid}:${r.reason}:${r.requested_by}:${r.priority}`)
  }
  observed.listings = Object.fromEntries(
    Object.keys(expected.listings as Json).map((sid) => {
      const got = listings[sid] ?? {}
      const want = (expected.listings as Record<string, Json>)[sid] as Json
      return [sid, Object.fromEntries(Object.keys(want).map((k) => [k, got[k]]))]
    }),
  )
  return observed
}
