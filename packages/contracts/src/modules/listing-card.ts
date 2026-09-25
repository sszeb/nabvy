import { z } from 'zod'
import { Currency, defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceDescriptionStatus } from './detail-evidence'
import { ListingIngestAvailability } from './listing-ingest'

// Contracts of the listing-card module (docs/design/modules/listing-card.md): the row shape of
// its one output, app.v_listing_card. No tables, no events (module card, "Owns: none" /
// "Outputs: its view"). Availability and description status are read straight from
// listing-ingest's and detail-evidence's own contracts, never retyped (CLAUDE.md, "Never type the
// same thing twice; derive").

export const module = 'listing-card'

/** Events this module publishes: none. Kept for the shape every module's contract file has. */
export const events = defineEvents(module, {})

/**
 * One row of `app.v_listing_card`: everything a user may see about a listing, and nothing else
 * (docs/decisions.md, "Actor data kept in full" — no seller field; "Location precision" — a town
 * label only, never coordinates). `title` is already masked by `quote_redaction.redact()` in the
 * view, so it carries no email, link, handle, phone or postcode. `link` and `condition` are null
 * only when their source row does not exist yet (a non-Facebook source, or no detail fetch yet).
 */
export const ListingCard = z.strictObject({
  listingId: Uuid,
  link: z.url({ protocol: /^https$/ }).nullable(),
  title: z.string().nullable(),
  priceMinor: z.int().min(0).nullable(),
  currency: Currency.nullable(),
  /** T0: the card's `listedAt`. */
  listedAt: IsoTimestamp.nullable(),
  townLabel: z.string().nullable(),
  /** The machine value of the Condition attribute; null until a detail fetch exists. */
  condition: z.string().nullable(),
  availability: ListingIngestAvailability,
  descriptionStatus: DetailEvidenceDescriptionStatus.nullable(),
  /** True when the current detail text is a stale fallback (module card, "possibly outdated"). */
  possiblyOutdated: z.boolean(),
})
export type ListingCard = z.infer<typeof ListingCard>
