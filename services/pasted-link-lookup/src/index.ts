// Public API of the pasted-link-lookup module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/pasted-link-lookup' only, never from its internals.
//
// A user pastes a Facebook Marketplace item link; `submit` (as nabvy_app inside withUser) takes
// the listing ID from it and records a request, answering at once when the listing's card is
// already visible with its details. `settle` (one pipeline tick, as nabvy_pipeline) moves queued
// requests on: ready when the card is visible with details, otherwise onto the shared details
// queue, which fetches through the Apify gateway; failed when the fetch failed or the request
// expired. This module never fetches a Facebook URL (CLAUDE.md, "No scrapers"; module card).
import { isActive } from '@nabvy/account'
import {
  PASTED_LINK_LOOKUP_DAILY_LIMIT,
  PASTED_LINK_LOOKUP_EVENT_BATCH_SIZE,
  PASTED_LINK_LOOKUP_REQUEST_TTL_DAYS,
  PASTED_LINK_LOOKUP_SETTLE_BATCH_SIZE,
} from '@nabvy/config/modules/pasted-link-lookup'
import { createEvent, type EventEnvelope, err, ok, type Result } from '@nabvy/contracts'
import type {
  DetailsQueueEnqueued,
  DetailsQueueEnqueueInput,
  DetailsQueueItem,
} from '@nabvy/contracts/modules/details-queue'
import {
  events,
  type PastedLinkLookupError,
  type PastedLinkLookupStatus,
  PastedLinkLookupSubmitInput,
} from '@nabvy/contracts/modules/pasted-link-lookup'
import type { Queryable } from '@nabvy/db'
import { enqueue, readQueue } from '@nabvy/details-queue'
import { state } from '@nabvy/switches'
import { canonicalLink, chunk, parseMarketplaceLink, readyKey } from './domain'
import {
  countRecent,
  findByKey,
  findCardsByLink,
  insertRequest,
  markFailed,
  markReady,
  type RequestRow,
  selectExpired,
  selectQueued,
  setListing,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/pasted-link-lookup'
export { canonicalLink, parseMarketplaceLink } from './domain'
export { onAccountDeleted } from './handlers'

const MODULE = 'pasted-link-lookup'

export interface SubmitOutcome {
  requestId: string
  sourceListingId: string
  /** `ready` at once when the card already shows the listing with its details. */
  status: PastedLinkLookupStatus
  /** listing-ingest's ID when the card is visible; the caller reads it through listing-card. */
  listingId: string | null
  /** Whether this call wrote a new row (false: the user already asked for this listing). */
  created: boolean
}

/**
 * Records a user's pasted link (docs/design/modules/pasted-link-lookup.md). Refuses anything but
 * a `facebook.com/marketplace/item/<id>/` link, an account that is not active, and a user past
 * their daily allowance (server time, from this module's own rows). The same link pasted twice
 * by one user is one request, so a resubmitted form writes nothing new. Requires the switch
 * `on`: pasting is a user-facing feature, so `shadow` refuses too (README.md, "Decisions").
 */
export async function submit(
  q: Queryable,
  rawInput: PastedLinkLookupSubmitInput,
): Promise<Result<SubmitOutcome, PastedLinkLookupError>> {
  const parsed = PastedLinkLookupSubmitInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'pasted-link-lookup.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  if ((await state(q, MODULE)) !== 'on') {
    return err({ code: 'pasted-link-lookup.off', message: 'Pasting a link is unavailable.' })
  }
  if (!(await isActive(q, input.userId))) {
    return err({
      code: 'pasted-link-lookup.account_restricted',
      message: 'The account may not look up listings right now.',
    })
  }
  const link = parseMarketplaceLink(input.url)
  if (!link.ok) {
    return err({
      code: 'pasted-link-lookup.invalid_link',
      message: 'Only a Facebook Marketplace item link can be looked up.',
    })
  }
  const existing = await findByKey(q, input.userId, link.source, link.sourceListingId)
  if (existing) {
    return ok(outcomeOf(existing, false))
  }
  if ((await countRecent(q, input.userId)) >= PASTED_LINK_LOOKUP_DAILY_LIMIT) {
    return err({
      code: 'pasted-link-lookup.rate_limited',
      message: 'The daily allowance of lookups is used up.',
    })
  }
  const [card] = await findCardsByLink(q, [canonicalLink(link.source, link.sourceListingId)])
  const { row, created } = await insertRequest(q, {
    userId: input.userId,
    source: link.source,
    sourceListingId: link.sourceListingId,
    listingId: card?.listingId ?? null,
    ready: card?.descriptionStatus != null,
  })
  return ok(outcomeOf(row, created))
}

function outcomeOf(row: RequestRow, created: boolean): SubmitOutcome {
  return {
    requestId: row.id,
    sourceListingId: row.sourceListingId,
    status: row.status as PastedLinkLookupStatus,
    listingId: row.listingId,
    created,
  }
}

/**
 * The other module one settle tick writes through, injected so tests can watch what is queued
 * without the details queue's own tables. `defaultPorts` wires the real one.
 */
export interface PastedLinkLookupPorts {
  /** details-queue's `enqueue`: the only way a pasted link reaches the actor. */
  enqueue(q: Queryable, request: DetailsQueueEnqueueInput): Promise<DetailsQueueEnqueued>
  /** details-queue's `readQueue`: whether a fetch has failed for good. */
  readQueue(
    q: Queryable,
    sourceListingIds: string[],
  ): Promise<Pick<DetailsQueueItem, 'sourceListingId' | 'lane' | 'status'>[]>
}

export const defaultPorts: PastedLinkLookupPorts = { enqueue, readQueue }

export type SettleReport =
  | { status: 'off' }
  | {
      status: 'settled'
      /** Requests moved to ready; their IDs are in `events`. */
      ready: number
      /** Requests closed as failed (expired, or the fetch failed for good). */
      failed: number
      /** What the details queue did with the listings still waiting; null when none were sent. */
      enqueued: DetailsQueueEnqueued | null
      /** `pasted-link-lookup.ready` envelopes, for the caller to publish after its transaction commits. */
      events: EventEnvelope[]
    }

/**
 * One settle tick, as the pipeline, over the oldest queued requests (at most 500). While the
 * module is off it writes nothing. Otherwise: requests whose listing is visible on
 * `app.v_listing_card` with its details become ready; requests older than the TTL, or whose
 * fetch the details queue has given up on, become failed; every other listing is put on the
 * shared details queue once, deduplicated, so the same link pasted by many users is one queue
 * item. Safe to run twice: only queued rows move, and `enqueue` is itself idempotent.
 */
export async function settle(
  q: Queryable,
  deps: { ports?: PastedLinkLookupPorts } = {},
): Promise<SettleReport> {
  if ((await state(q, MODULE)) === 'off') return { status: 'off' }
  const ports = deps.ports ?? defaultPorts

  const failed: string[] = []
  failed.push(
    ...(await markFailed(
      q,
      await selectExpired(
        q,
        PASTED_LINK_LOOKUP_REQUEST_TTL_DAYS,
        PASTED_LINK_LOOKUP_SETTLE_BATCH_SIZE,
      ),
      'expired',
    )),
  )

  const queued = await selectQueued(q, PASTED_LINK_LOOKUP_SETTLE_BATCH_SIZE)
  const links = [...new Set(queued.map((r) => canonicalLink('facebook', r.sourceListingId)))]
  const cards = new Map((await findCardsByLink(q, links)).map((card) => [card.link, card]))

  const toReady: { requestId: string; listingId: string }[] = []
  const toResolve: { requestId: string; listingId: string }[] = []
  const waiting: RequestRow[] = []
  for (const request of queued) {
    const card = cards.get(canonicalLink('facebook', request.sourceListingId))
    if (card && card.descriptionStatus !== null) {
      toReady.push({ requestId: request.id, listingId: card.listingId })
    } else {
      if (card) toResolve.push({ requestId: request.id, listingId: card.listingId })
      waiting.push(request)
    }
  }
  const readyIds = await markReady(q, toReady)
  await setListing(q, toResolve)

  const waitingIds = [...new Set(waiting.map((r) => r.sourceListingId))]
  const givenUp = new Set(
    (await ports.readQueue(q, waitingIds))
      .filter((item) => item.lane === 'text' && item.status === 'failed')
      .map((item) => item.sourceListingId),
  )
  failed.push(
    ...(await markFailed(
      q,
      waiting.filter((r) => givenUp.has(r.sourceListingId)).map((r) => r.id),
      'fetch-failed',
    )),
  )

  const toEnqueue = waitingIds.filter((id) => !givenUp.has(id))
  let enqueued: DetailsQueueEnqueued | null = null
  for (const batch of chunk(toEnqueue, 500)) {
    const result = await ports.enqueue(q, {
      source: 'facebook',
      sourceListingIds: batch,
      priority: 'shortlisted',
      lane: 'text',
      reason: 'pasted-link',
      requestedBy: MODULE,
    })
    enqueued = enqueued
      ? {
          queued: enqueued.queued + result.queued,
          alreadyQueued: enqueued.alreadyQueued + result.alreadyQueued,
          skipped: enqueued.skipped + result.skipped,
        }
      : result
  }

  return {
    status: 'settled',
    ready: readyIds.length,
    failed: failed.length,
    enqueued,
    events: readyEvents(readyIds),
  }
}

function readyEvents(requestIds: string[]): EventEnvelope[] {
  const ids = [...requestIds].sort()
  return chunk(ids, PASTED_LINK_LOOKUP_EVENT_BATCH_SIZE).map(
    (group) =>
      createEvent(
        events,
        'pasted-link-lookup.ready',
        1,
        { requestIds: group },
        { key: readyKey(group) },
      ) as EventEnvelope,
  )
}

export type { RequestRow }
