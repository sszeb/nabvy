import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailsQueueSource, DetailsQueueSourceListingId } from './details-queue'

// Contracts of the pasted-link-lookup module (services/pasted-link-lookup, docs/design/modules/
// pasted-link-lookup.md): a user pastes a Marketplace listing link, the module takes the listing
// ID from it and answers from the shared pipeline, never with a fetch of its own. Import from
// '@nabvy/contracts/modules/pasted-link-lookup'. The source and listing-ID shapes are
// details-queue's own, never retyped (CLAUDE.md, "Never type the same thing twice; derive").

export const module = 'pasted-link-lookup'

/** Only Facebook Marketplace links are accepted today (module card, "Does / does not"). */
export const PastedLinkLookupSource = DetailsQueueSource
export type PastedLinkLookupSource = z.infer<typeof PastedLinkLookupSource>

/** The numeric listing ID, kept as text: digits are never parsed into a number. */
export const PastedLinkLookupSourceListingId = DetailsQueueSourceListingId
export type PastedLinkLookupSourceListingId = z.infer<typeof PastedLinkLookupSourceListingId>

/**
 * A request's state. `queued`: waiting for the shared details queue; `ready`: the listing's card
 * is visible with its details; `failed`: the fetch failed or the request expired unanswered.
 */
export const PastedLinkLookupStatus = z.enum(['queued', 'ready', 'failed'])
export type PastedLinkLookupStatus = z.infer<typeof PastedLinkLookupStatus>

/** The longest link the form accepts: a Marketplace item link is well under 200 characters. */
export const PASTED_LINK_LOOKUP_MAX_URL_LENGTH = 2048

/**
 * The web form: the signed-in user and the pasted text. No client time and no listing ID: the
 * server takes the ID from the link and stamps `requestedAt` itself, so rate-limit windows are
 * never picked by the caller.
 */
export const PastedLinkLookupSubmitInput = z.strictObject({
  userId: Uuid,
  url: z.string().min(1).max(PASTED_LINK_LOOKUP_MAX_URL_LENGTH),
})
export type PastedLinkLookupSubmitInput = z.infer<typeof PastedLinkLookupSubmitInput>

/**
 * One row of the user-facing view `app.v_pasted_link_lookup_requests`: the caller's own request.
 * `listingId` is set once the listing is visible on `app.v_listing_card`; the card itself is read
 * through listing-card, never copied here. No seller field, no listing text.
 */
export const PastedLinkLookupRequest = z.strictObject({
  requestId: Uuid,
  source: PastedLinkLookupSource,
  sourceListingId: PastedLinkLookupSourceListingId,
  listingId: Uuid.nullable(),
  status: PastedLinkLookupStatus,
  requestedAt: IsoTimestamp,
  readyAt: IsoTimestamp.nullable(),
})
export type PastedLinkLookupRequest = z.infer<typeof PastedLinkLookupRequest>

/**
 * One row of the internal view `pasted_link_lookup.v_request_counts`: requests per user per UTC
 * day, for `account-integrity`. Carries a user ID; never granted to `nabvy_app`.
 */
export const PastedLinkLookupRequestCount = z.strictObject({
  userId: Uuid,
  day: z.iso.date(),
  n: z.int().nonnegative(),
})
export type PastedLinkLookupRequestCount = z.infer<typeof PastedLinkLookupRequestCount>

/** Error codes returned as values (rule 3 of docs/design/modules/_rules.md). */
export const PastedLinkLookupErrorCode = z.enum([
  'pasted-link-lookup.off', //                the module is not on: pasting is unavailable
  'pasted-link-lookup.invalid_input', //      the form failed its schema
  'pasted-link-lookup.invalid_link', //       not a facebook.com/marketplace/item/<id>/ link
  'pasted-link-lookup.account_restricted', // the account is suspended or banned
  'pasted-link-lookup.rate_limited', //       the user's daily allowance of lookups is used up
])
export type PastedLinkLookupErrorCode = z.infer<typeof PastedLinkLookupErrorCode>

export const PastedLinkLookupError = z.strictObject({
  code: PastedLinkLookupErrorCode,
  message: z.string().min(1),
})
export type PastedLinkLookupError = z.infer<typeof PastedLinkLookupError>

/** The payload of `pasted-link-lookup.ready`: request IDs only (rule 7), 1-500 per envelope. */
export const PastedLinkLookupReadyEvent = z.strictObject({
  requestIds: z.array(Uuid).min(1).max(500),
})
export type PastedLinkLookupReadyEvent = z.infer<typeof PastedLinkLookupReadyEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  /** Requests whose listing card is now visible with its details. */
  'pasted-link-lookup.ready': { 1: PastedLinkLookupReadyEvent },
})
