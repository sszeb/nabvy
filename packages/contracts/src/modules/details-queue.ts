import { z } from 'zod'
import { defineEvents, IsoTimestamp, ModuleName } from '../index'

// Contracts of the details-queue module (docs/design/modules/details-queue.md): one shared,
// deduplicated queue of listings that need a paid detail fetch, sent to the actor in batches
// through apify-gateway. Import from '@nabvy/contracts/modules/details-queue'.

export const module = 'details-queue'

/** Facebook's numeric listing ID, kept as a string (one recorded ID has 17 digits). */
export const DetailsQueueSourceListingId = z.string().regex(/^\d{1,30}$/)
export type DetailsQueueSourceListingId = z.infer<typeof DetailsQueueSourceListingId>

/** Only Facebook is fetched through the queue today; the column keeps the idempotency key whole. */
export const DetailsQueueSource = z.enum(['facebook'])
export type DetailsQueueSource = z.infer<typeof DetailsQueueSource>

/**
 * What kind of fetch an item needs. `text` uses the region's route from route-health; `photo`
 * always uses `page`, because graphql returns no gallery (card; `EVIDENCE_LEDGER.md:217-219`).
 */
export const DetailsQueueLane = z.enum(['text', 'photo'])
export type DetailsQueueLane = z.infer<typeof DetailsQueueLane>

/**
 * Priority, highest first: follow-ups of frequent (newest) checks, shortlisted refreshes
 * (alerted, watched, pasted links), photo captures, then sweep follow-ups
 * (`CONTAINER_LISTINGS.md:194-196`). The order of this list is the order of service.
 */
export const DETAILS_QUEUE_PRIORITIES = [
  'new-listing',
  'shortlisted',
  'photo-capture',
  'sweep',
] as const
export const DetailsQueuePriority = z.enum(DETAILS_QUEUE_PRIORITIES)
export type DetailsQueuePriority = z.infer<typeof DetailsQueuePriority>

/** Why a caller asked. Stored for the record; never read as an instruction. */
export const DetailsQueueReason = z.enum([
  'first-seen', //          a hunt's search found a listing that has no details yet
  'recheck', //             listing-lifecycle: an alerted or watched listing is refreshed
  'collision-candidate', // copy-advert: a description is needed to confirm a copy
  'photo-capture', //       photo-review: the text leaves a wanted part unstated
  'partial-text', //        parts-ai: the description was partial or missing
  'pasted-link', //         pasted-link-lookup: a user pasted a link
])
export type DetailsQueueReason = z.infer<typeof DetailsQueueReason>

export const DetailsQueueStatus = z.enum(['queued', 'leased', 'done', 'deferred', 'failed'])
export type DetailsQueueStatus = z.infer<typeof DetailsQueueStatus>

/** A Facebook acquisition region, as tagged on an apify-gateway job (`ApifyGatewayTags.region`). */
export const DetailsQueueRegionId = z.string().min(1).max(100)
export type DetailsQueueRegionId = z.infer<typeof DetailsQueueRegionId>

/**
 * `enqueue()` input: a batch of source listing IDs (1–500, `CLAUDE.md`, "Batches, not items").
 * A listing already fetched is sent again only with `refresh: true`, because every ID sent forces
 * a paid fetch (`EVIDENCE_LEDGER.md:250-253`).
 */
export const DetailsQueueEnqueueInput = z.strictObject({
  source: DetailsQueueSource.default('facebook'),
  sourceListingIds: z.array(DetailsQueueSourceListingId).min(1).max(500),
  priority: DetailsQueuePriority,
  lane: DetailsQueueLane,
  reason: DetailsQueueReason,
  requestedBy: ModuleName,
  regionId: DetailsQueueRegionId.optional(),
  refresh: z.boolean().default(false),
})
export type DetailsQueueEnqueueInput = z.input<typeof DetailsQueueEnqueueInput>

/** What `enqueue()` did with each ID of the batch. */
export const DetailsQueueEnqueued = z.strictObject({
  /** New items, or finished items a refresh put back in the queue. */
  queued: z.int().nonnegative(),
  /** Already waiting or in flight: kept once (a higher priority is taken over). */
  alreadyQueued: z.int().nonnegative(),
  /** Already fetched and no refresh asked: nothing is sent again. */
  skipped: z.int().nonnegative(),
})
export type DetailsQueueEnqueued = z.infer<typeof DetailsQueueEnqueued>

/** One row of `details_queue.v_queue`. */
export const DetailsQueueItem = z.strictObject({
  source: DetailsQueueSource,
  sourceListingId: DetailsQueueSourceListingId,
  lane: DetailsQueueLane,
  priority: DetailsQueuePriority,
  status: DetailsQueueStatus,
  reason: DetailsQueueReason,
  requestedBy: ModuleName,
  regionId: DetailsQueueRegionId.nullable(),
  attempts: z.int().nonnegative(),
  requeues: z.int().nonnegative(),
  lastOutcome: z.string().nullable(),
  jobId: z.int().positive().nullable(),
  leaseExpiresAt: IsoTimestamp.nullable(),
  deferredOn: z.iso.date().nullable(),
  doneAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type DetailsQueueItem = z.infer<typeof DetailsQueueItem>

/**
 * Work past the daily cap waits with a visible status; nothing ages out silently
 * (`CONTAINER_LISTINGS.md:172-173`). Carries the IDs deferred on a London calendar day.
 */
export const DetailsQueueDeferredEvent = z.strictObject({
  source: DetailsQueueSource,
  sourceListingIds: z.array(DetailsQueueSourceListingId).min(1).max(500),
  day: z.iso.date(),
})
export type DetailsQueueDeferredEvent = z.infer<typeof DetailsQueueDeferredEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'details-queue.deferred': { 1: DetailsQueueDeferredEvent },
})

/** Error codes returned as values (docs/engineering.md, "Errors"). */
export const DetailsQueueErrorCode = z.enum([
  // `first-seen` named listings listing-ingest does not show (not yet visible, or switched off)
  'details-queue.listings_not_found',
])
export type DetailsQueueErrorCode = z.infer<typeof DetailsQueueErrorCode>
