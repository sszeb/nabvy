import { z } from 'zod'
import { Currency, defineEvents, IsoTimestamp, Source, Uuid } from '../index'

// Contracts of the listing-ingest module (docs/design/modules/listing-ingest.md): one listing
// identity per source listing ID, one sighting per card per run, and the events that tell the
// pipeline which listings are new or changed. Import from '@nabvy/contracts/modules/listing-ingest'.
// The view rows are written here as Zod, as apify-gateway's `ApifyGatewayJob` is: drizzle-zod is
// not a dependency yet (services/listing-ingest/README.md, "Decisions").

export const module = 'listing-ingest'

/** A source listing ID, kept as text: recorded Facebook IDs reach 17 digits. */
export const ListingIngestSourceListingId = z.string().regex(/^[0-9A-Za-z_-]{1,200}$/)

/**
 * The card hash (rule 8 of docs/design/modules/_rules.md): SHA-256, lowercase hex, of the
 * normalised title, `priceMinor`, currency, availability and primary photo ID. The idempotency
 * key of a card stage is `source + sourceListingId + cardHash`.
 */
export const ListingIngestCardHash = z.string().regex(/^[0-9a-f]{64}$/)
export type ListingIngestCardHash = z.infer<typeof ListingIngestCardHash>

/** The card's availability, folded from the actor's `availability` flags. */
export const ListingIngestAvailability = z.enum(['live', 'pending', 'sold', 'hidden', 'unknown'])
export type ListingIngestAvailability = z.infer<typeof ListingIngestAvailability>

/** `search`: the card appeared in a feed. `detail`: a paid details refresh, never a feed sighting. */
export const ListingIngestSightingKind = z.enum(['search', 'detail'])
export type ListingIngestSightingKind = z.infer<typeof ListingIngestSightingKind>

const MinorAmount = z.int().min(0)
const JobId = z.int().positive()

/** One row of `listing_ingest.v_listings` (internal; no seller fields). */
export const ListingIngestListing = z.strictObject({
  id: Uuid,
  source: Source,
  sourceListingId: ListingIngestSourceListingId,
  cardHash: ListingIngestCardHash,
  /** Set only for a `fixed` ask in GBP or EUR; null otherwise. */
  priceMinor: MinorAmount.nullable(),
  currency: Currency.nullable(),
  /** `money.kind` as the actor gave it (`fixed` in the recorded run); null when absent. */
  moneyKind: z.string().min(1).max(50).nullable(),
  title: z.string(),
  /** T0: the card's `listedAt`. */
  listedAt: IsoTimestamp.nullable(),
  /** T1: collection time of the run that first returned the listing. */
  firstFetchedAt: IsoTimestamp,
  lastSeenAt: IsoTimestamp,
  cityPageId: z.string().nullable(),
  townLabel: z.string().nullable(),
  availability: ListingIngestAvailability,
  categoryId: z.string().nullable(),
  deliveryTypes: z.array(z.string()),
  primaryPhotoId: z.string().nullable(),
  /** The seller's displayed previous price: a raw fact, never a reference price. */
  displayedPreviousMinor: MinorAmount.nullable(),
  binding: z.string().nullable(),
  foundByTerms: z.array(z.string()),
  itemJobId: JobId,
  itemSeq: z.int().min(0),
})
export type ListingIngestListing = z.infer<typeof ListingIngestListing>

/** One row of `listing_ingest.v_sightings`. */
export const ListingIngestSighting = z.strictObject({
  id: Uuid,
  listingId: Uuid,
  jobId: JobId,
  seq: z.int().min(0),
  kind: ListingIngestSightingKind,
  /** The first found-by search term; null for a detail observation. */
  term: z.string().nullable(),
  /** The Facebook city page the search was centred on; null for a detail observation. */
  centreId: z.string().nullable(),
  /** 1-based row order within the search that returned the card; null for a detail observation. */
  rank: z.int().min(1).nullable(),
  cardHash: ListingIngestCardHash,
  priceMinor: MinorAmount.nullable(),
  currency: Currency.nullable(),
  availability: ListingIngestAvailability,
  seenAt: IsoTimestamp,
})
export type ListingIngestSighting = z.infer<typeof ListingIngestSighting>

/** One row of `listing_ingest.v_price_changes`: two consecutive observations at different prices. */
export const ListingIngestPriceChange = z.strictObject({
  listingId: Uuid,
  sightingId: Uuid,
  kind: ListingIngestSightingKind,
  previousMinor: MinorAmount,
  priceMinor: MinorAmount,
  currency: Currency,
  previousSeenAt: IsoTimestamp,
  seenAt: IsoTimestamp,
})
export type ListingIngestPriceChange = z.infer<typeof ListingIngestPriceChange>

const ListingIds = z.array(Uuid).min(1).max(500)

/** New listing IDs: listings this module had never seen before. */
export const ListingIngestFirstSeenEvent = z.strictObject({ listingIds: ListingIds })
export type ListingIngestFirstSeenEvent = z.infer<typeof ListingIngestFirstSeenEvent>

/** Listings whose price, currency, title, availability or primary photo changed. */
export const ListingIngestCardChangedEvent = z.strictObject({ listingIds: ListingIds })
export type ListingIngestCardChangedEvent = z.infer<typeof ListingIngestCardChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'listing-ingest.first-seen': { 1: ListingIngestFirstSeenEvent },
  'listing-ingest.card-changed': { 1: ListingIngestCardChangedEvent },
})

/** Error codes the module returns as values. */
export const ListingIngestErrorCode = z.enum([
  'listing-ingest.job_not_found', // the job is not in apify_gateway.v_jobs (or the gateway is off)
])
export type ListingIngestErrorCode = z.infer<typeof ListingIngestErrorCode>
