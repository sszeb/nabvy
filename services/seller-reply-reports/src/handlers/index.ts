// Event handlers of the seller-reply-reports module: thin (parse, call, return). Each takes a
// batch of payloads, runs inside one pipeline transaction, and is safe to run twice: the
// aggregator writes nothing when its inputs are unchanged (the inputs hash, design §6.6).
import type { EventEnvelope } from '@nabvy/contracts'
import { AccountDeletedEvent, AccountStandingChangedEvent } from '@nabvy/contracts/modules/account'
import { events as copyAdvertEvents } from '@nabvy/contracts/modules/copy-advert'
import { PickupLocationChangedEvent } from '@nabvy/contracts/modules/pickup-location'
import { SellerReplyReportsRecordedEvent } from '@nabvy/contracts/modules/seller-reply-reports'
import type { Queryable } from '@nabvy/db'
import { aggregate, defaultDeps, type SellerReplyReportsDeps } from '../index'
import * as repo from '../repo'

const CopyAdvertClusteredEvent = copyAdvertEvents.definitions['copy-advert.clustered'][1]

async function aggregateAll(
  q: Queryable,
  listingIds: string[],
  deps: SellerReplyReportsDeps,
): Promise<EventEnvelope[]> {
  const ids = [...new Set(listingIds)]
  const out: EventEnvelope[] = []
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...(await aggregate(q, { listingIds: ids.slice(i, i + 500) }, deps)).events)
  }
  return out
}

/** `seller-reply-reports.recorded` → aggregate the reports' listings (the aggregation step of submit). */
export async function onRecorded(
  q: Queryable,
  payloads: unknown[],
  deps = defaultDeps,
): Promise<EventEnvelope[]> {
  const reportIds = payloads.flatMap((p) => SellerReplyReportsRecordedEvent.parse(p).reportIds)
  if (reportIds.length === 0) return []
  return aggregateAll(q, await repo.selectReportListings(q, { reportIds }), deps)
}

/** `copy-advert.clustered` → the cluster's members get their spread evidence recomputed. */
export async function onCopyAdvertClustered(
  q: Queryable,
  payloads: unknown[],
  deps = defaultDeps,
): Promise<EventEnvelope[]> {
  return aggregateAll(
    q,
    payloads.flatMap((p) => CopyAdvertClusteredEvent.parse(p).listingIds),
    deps,
  )
}

/** `pickup-location.changed` → location reports are re-measured from the listing's new place. */
export async function onPickupLocationChanged(
  q: Queryable,
  payloads: unknown[],
  deps = defaultDeps,
): Promise<EventEnvelope[]> {
  return aggregateAll(
    q,
    payloads.flatMap((p) => PickupLocationChangedEvent.parse(p).listingIds),
    deps,
  )
}

/**
 * `listing-feedback.recorded` → report-then-buy (§3.3). The payload names verdicts, which this
 * module cannot read; it re-checks every report without an outcome whose reporter has a
 * `bought` verdict on the same listing (`v_bought_for_reports`).
 */
export async function onListingFeedbackRecorded(
  q: Queryable,
  _payloads: unknown[],
  deps = defaultDeps,
): Promise<EventEnvelope[]> {
  return aggregateAll(q, await repo.selectBoughtReportListings(q), deps)
}

/** `account.standing-changed` → a banned reporter's reports are voided and their listings recomputed. */
export async function onStandingChanged(
  q: Queryable,
  payloads: unknown[],
  deps = defaultDeps,
): Promise<EventEnvelope[]> {
  const userIds = [...new Set(payloads.map((p) => AccountStandingChangedEvent.parse(p).userId))]
  const banned = await repo.selectBanned(q, userIds)
  if (banned.length === 0) return []
  const voided = await repo.voidReportsOf(q, banned)
  await repo.recountStats(q, banned)
  if (voided.length === 0) return []
  return aggregateAll(q, await repo.selectReportListings(q, { reportIds: voided }), deps)
}

/**
 * `account.deleted` → purges the users' reports, reasons, stats and tester rows (rule 12), then
 * recomputes the listings they had reported. Safe to run twice: a second run finds nothing.
 */
export async function onAccountDeleted(
  q: Queryable,
  payloads: unknown[],
  deps = defaultDeps,
): Promise<EventEnvelope[]> {
  const userIds = [...new Set(payloads.map((p) => AccountDeletedEvent.parse(p).userId))]
  if (userIds.length === 0) return []
  const listings = await repo.selectReportListings(q, { userIds })
  await repo.deleteUsers(q, userIds)
  return aggregateAll(q, listings, deps)
}
