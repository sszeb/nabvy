import { z } from 'zod'
import { defineEvents, IsoTimestamp, ModuleName, Source, Uuid } from '../index'

// Contracts of the listing-lifecycle module (docs/design/modules/listing-lifecycle.md): each
// listing's availability, read from its latest card and detail, and the rechecks other modules ask
// for. A disappearance is never a sale (docs/decisions.md, "Precedence", "Sale signals"). Import
// from '@nabvy/contracts/modules/listing-lifecycle'. The view row is written here as Zod, as the
// other acquisition modules do: drizzle-zod is not a dependency yet.

export const module = 'listing-lifecycle'

/**
 * A listing's availability. Only the seller's own flags make it `pending` or `marked-sold`;
 * `unresolved` is a detail fetch that could not identify the item (a removed ID), and
 * `not-seen-recently` is a listing missed by repeated sweeps. Neither of those two is a sale, and
 * nothing here is ever read as sold.
 */
export const LISTING_LIFECYCLE_STATUSES = [
  'live',
  'pending',
  'marked-sold',
  'unresolved',
  'not-seen-recently',
  'unknown',
] as const
export const ListingLifecycleStatusValue = z.enum(LISTING_LIFECYCLE_STATUSES)
export type ListingLifecycleStatusValue = z.infer<typeof ListingLifecycleStatusValue>

/** What the status rests on. */
export const ListingLifecycleBasis = z.enum([
  'search-card', //    the latest observation is a search card
  'detail', //         the latest observation is a detail fetch's card fields
  'unresolved-fetch', // a detail fetch newer than every observation could not identify the item
  'missed-sweeps', //  later sweeps of the same search did not return it
  'no-data', //        nothing observed yet
])
export type ListingLifecycleBasis = z.infer<typeof ListingLifecycleBasis>

/** One row of `listing_lifecycle.v_status` (internal). */
export const ListingLifecycleStatus = z.strictObject({
  listingId: Uuid,
  source: Source,
  sourceListingId: z.string().min(1).max(200),
  status: ListingLifecycleStatusValue,
  basis: ListingLifecycleBasis,
  /** The latest observation of the listing (search or detail), null when never observed. */
  lastSeenAt: IsoTimestamp.nullable(),
  /** The time of the evidence the status rests on. */
  observedAt: IsoTimestamp.nullable(),
  /** Later search runs of the listing's last search (same term and centre) that missed it. */
  missedSweeps: z.int().min(0),
  /** When this module last changed the status (its `doneAt`, rule 10). */
  changedAt: IsoTimestamp,
})
export type ListingLifecycleStatus = z.infer<typeof ListingLifecycleStatus>

/** Why a recheck is asked for; the schedule follows the reason (README.md, "Rules"). */
export const ListingLifecycleRecheckReason = z.enum([
  'alerted', //   a user was alerted about the listing: +6 h, +24 h, +72 h
  'candidate', // shortlisted as a candidate: +6 h, +24 h, +72 h
  'watched', //   a user watches it: the next daily batch of 20 or more
  'not-seen', //  this module: missed by repeated sweeps, so a detail fetch decides
])
export type ListingLifecycleRecheckReason = z.infer<typeof ListingLifecycleRecheckReason>

/**
 * `requestRecheck()` input: 1–500 listing UUIDs (listing-ingest's), the reason and the asking
 * module. No time: every due time comes from server time.
 */
export const ListingLifecycleRecheckRequest = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
  reason: ListingLifecycleRecheckReason.exclude(['not-seen']),
  requestedBy: ModuleName,
})
export type ListingLifecycleRecheckRequest = z.infer<typeof ListingLifecycleRecheckRequest>

/** What `requestRecheck()` did. */
export const ListingLifecycleRecheckRequested = z.strictObject({
  /** Listings given the reason's schedule (one row per step). */
  scheduled: z.int().nonnegative(),
  /** IDs with that reason's schedule already pending: nothing new is written. */
  alreadyScheduled: z.int().nonnegative(),
  /** IDs listing-ingest does not show (never ingested, erased, or listing-ingest off). */
  unknown: z.int().nonnegative(),
})
export type ListingLifecycleRecheckRequested = z.infer<typeof ListingLifecycleRecheckRequested>

/** Listings whose status changed. Identifiers only; readers load `v_status`. */
export const ListingLifecycleStatusChangedEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type ListingLifecycleStatusChangedEvent = z.infer<typeof ListingLifecycleStatusChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'listing-lifecycle.status-changed': { 1: ListingLifecycleStatusChangedEvent },
})

/** Error codes returned as values. */
export const ListingLifecycleErrorCode = z.enum([
  // an event named listings listing-ingest does not show yet (retried, then dead-lettered)
  'listing-lifecycle.listings_not_found',
])
export type ListingLifecycleErrorCode = z.infer<typeof ListingLifecycleErrorCode>
