// Public API of the listing-suppression module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/listing-suppression' only, never from its internals. It keeps
// the suppression list (hashes of named listing IDs, seller keys, and look-alike fingerprints that
// expire after 90 days) and resolves it to the listings every user-facing view must hide
// (README.md).

import {
  LISTING_SUPPRESSION_EVENT_BATCH_SIZE,
  LISTING_SUPPRESSION_LOOKALIKE_DAYS,
} from '@nabvy/config/modules/listing-suppression'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
  Uuid,
} from '@nabvy/contracts'
import {
  events,
  ListingSuppressionAddInput,
  type ListingSuppressionNamedListing,
} from '@nabvy/contracts/modules/listing-suppression'
import type { Queryable } from '@nabvy/db'
import { z } from 'zod'
import { buildEntries, chunk, eventKey, uniqueListings } from './domain'
import {
  insertEntries,
  selectCardFingerprints,
  selectDescriptionFingerprints,
  selectEntryIds,
  selectListingIds,
  selectSuppressed,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/listing-suppression'
export { listingHash } from './domain'

/** What one `add` call did. */
export interface AddReport {
  requestId: string
  /** Entries this call inserted (0 on a replay). */
  written: number
  /** Every entry ID of the request, oldest first. */
  entryIds: string[]
  /**
   * Named listings listing-ingest does not show (not ingested yet, or listing-ingest off): their
   * hash is recorded, but no look-alike could be taken. Calling `add` again with the same request
   * once they are ingested adds the look-alikes.
   */
  withoutLookalike: ListingSuppressionNamedListing[]
  /** `changed` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Records a `seller-rights` request on the suppression list: a hash of each named listing ID
 * (never the ID), each seller key as `seller-key` gives it, and look-alike entries (the named
 * listings' card and current-description fingerprints) that hide matching listings for 90 days.
 * Runs whatever the switch says (rule 11: `add` keeps recording while off). Safe to run twice: a
 * replay writes nothing and returns the same event keys, which the transport drops. Deletes
 * nothing. Only `seller-rights` calls it.
 */
export async function add(
  q: Queryable,
  input: ListingSuppressionAddInput,
  options: { now?: Date } = {},
): Promise<Result<AddReport, AppError>> {
  const parsed = ListingSuppressionAddInput.safeParse(input)
  if (!parsed.success) {
    return err({
      code: 'listing-suppression.invalid_input',
      message: `add: ${z.prettifyError(parsed.error)}`,
    })
  }
  const { requestId, sellerKeys } = parsed.data
  const listings = uniqueListings(parsed.data.listings)

  const listingIdOf = await selectListingIds(q, listings)
  const found = [...new Set(listingIdOf.values())]
  const rows = buildEntries({
    listings,
    sellerKeys,
    cardFingerprints: await selectCardFingerprints(q, found),
    descriptionFingerprints: await selectDescriptionFingerprints(q, found),
    now: options.now ?? new Date(),
    days: LISTING_SUPPRESSION_LOOKALIKE_DAYS,
  })
  const written = await insertEntries(q, requestId, rows)
  const entryIds = await selectEntryIds(q, requestId)

  return ok({
    requestId,
    written,
    entryIds,
    withoutLookalike: listings.filter((l) => !listingIdOf.has(`${l.source}:${l.sourceListingId}`)),
    events: chunk(entryIds, LISTING_SUPPRESSION_EVENT_BATCH_SIZE).map((ids, i) =>
      createEvent(
        events,
        'listing-suppression.changed',
        1,
        { entryIds: ids },
        { key: eventKey(requestId, entryIds.length, i) },
      ),
    ) as EventEnvelope[],
  })
}

/**
 * The listings among these that the list hides now, through `listing_suppression.is_suppressed()`
 * (the same check every user-facing view makes). For `notifier` before a send and for batch
 * readers. Fails closed as the SQL function does. Takes any number of IDs, checked 500 at a time.
 */
export async function suppressed(q: Queryable, listingIds: string[]): Promise<Set<string>> {
  const ids = z.array(Uuid).parse(listingIds)
  const out = new Set<string>()
  for (const batch of chunk([...new Set(ids)], LISTING_SUPPRESSION_EVENT_BATCH_SIZE)) {
    for (const id of await selectSuppressed(q, batch)) out.add(id)
  }
  return out
}
