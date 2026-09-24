// Public API of the detail-evidence module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/detail-evidence' only, never from its internals. It keeps
// every detail version of a listing, keyed by its evidence hash, with how complete it is, and
// announces listings with a new current version or an unresolved fetch (README.md).

import {
  DETAIL_EVIDENCE_EVENT_BATCH_SIZE,
  DETAIL_EVIDENCE_LINK_LIFETIME_HOURS,
} from '@nabvy/config/modules/detail-evidence'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { events } from '@nabvy/contracts/modules/detail-evidence'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import { chunk, type Detail, eventKey, firstPerListing, readDetail } from './domain'
import {
  deleteListings,
  insertFetches,
  insertVersions,
  type Located,
  selectChanged,
  selectJob,
  selectListingIds,
  selectListingRows,
  selectUnresolved,
  touchVersions,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/detail-evidence'
export { evidenceHash, normaliseText } from './domain'
export { runCollectedHandler } from './handlers'

const MODULE = 'detail-evidence'
const SOURCE = 'facebook'

/** What one `record` call did. */
export interface RecordReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  jobId: number
  /** Detail rows in the job, one per listing. */
  details: number
  versionsWritten: number
  fetchesWritten: number
  changed: string[]
  unresolved: string[]
  /** `changed` and `unresolved` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Records the detail rows of one collected job (the `apify-gateway.run-collected` payload): reads
 * its `listing` rows from `apify_gateway.v_rows`, keeps one fetch per listing, writes a version
 * only when the evidence hash is new, and returns the `changed` and `unresolved` events. Search
 * cards without details are skipped. Safe to run twice: the second run writes nothing and returns
 * the same event keys, which the transport drops.
 *
 * Listing IDs are listing-ingest's. Both modules handle the same event, so a detail row whose
 * listing is not ingested yet fails the call before anything is written, and the handler retries.
 * An unresolved ID that was never ingested is recorded without a listing ID and not announced.
 */
export async function record(
  q: Queryable,
  input: { jobId: number },
): Promise<Result<RecordReport, AppError>> {
  const report: RecordReport = {
    open: false,
    jobId: input.jobId,
    details: 0,
    versionsWritten: 0,
    fetchesWritten: 0,
    changed: [],
    unresolved: [],
    events: [],
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const job = await selectJob(q, input.jobId)
  if (job?.status !== 'succeeded') {
    return err({
      code: 'detail-evidence.job_not_found',
      message: `Job ${input.jobId} is not a collected job in apify_gateway.v_jobs (or the gateway is off).`,
    })
  }
  const fallbackAt = job.collectedAt ?? job.finishedAt ?? new Date().toISOString()

  const details = firstPerListing(
    (await selectListingRows(q, input.jobId)).flatMap((row) => {
      const detail = readDetail(row.item, row.seq, fallbackAt, DETAIL_EVIDENCE_LINK_LIFETIME_HOURS)
      return detail ? [detail] : []
    }),
  )
  report.details = details.length

  const listingIdOf = await selectListingIds(
    q,
    SOURCE,
    details.map((d) => d.sourceListingId),
  )
  const missing = details.filter((d) => d.evidence && !listingIdOf.has(d.sourceListingId))
  if (missing.length > 0) {
    return err({
      code: 'detail-evidence.listing_not_ingested',
      message: `Job ${input.jobId}: ${missing.length} detail rows have no listing in listing_ingest.v_listings yet.`,
    })
  }

  const located: Located[] = details.flatMap((detail: Detail) => {
    const listingId = listingIdOf.get(detail.sourceListingId)
    return listingId && detail.evidence ? [{ listingId, detail, evidence: detail.evidence }] : []
  })
  report.versionsWritten = await insertVersions(q, SOURCE, input.jobId, located)
  await touchVersions(q, SOURCE, input.jobId, located)
  report.fetchesWritten = await insertFetches(
    q,
    SOURCE,
    input.jobId,
    details.map((detail) => ({
      listingId: listingIdOf.get(detail.sourceListingId) ?? null,
      detail,
    })),
  )

  report.changed = await selectChanged(q, input.jobId)
  report.unresolved = await selectUnresolved(q, input.jobId)
  report.events = [
    ...chunk(report.changed, DETAIL_EVIDENCE_EVENT_BATCH_SIZE).map((listingIds, i) =>
      createEvent(
        events,
        'detail-evidence.changed',
        1,
        { listingIds },
        { key: eventKey('detail-evidence.changed', input.jobId, i) },
      ),
    ),
    ...chunk(report.unresolved, DETAIL_EVIDENCE_EVENT_BATCH_SIZE).map((listingIds, i) =>
      createEvent(
        events,
        'detail-evidence.unresolved',
        1,
        { listingIds },
        { key: eventKey('detail-evidence.unresolved', input.jobId, i) },
      ),
    ),
  ] as EventEnvelope[]
  return ok(report)
}

/**
 * Removes the versions and fetches of these listings (rule 12: `seller-rights` erasure). Runs
 * whatever the switch says, so erasure always reaches the rows. Returns how many versions were
 * removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, DETAIL_EVIDENCE_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
