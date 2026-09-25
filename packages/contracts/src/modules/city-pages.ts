import { z } from 'zod'
import { Currency, defineEvents, IsoTimestamp } from '../index'

// Contracts of the city-pages module (docs/design/modules/city-pages.md): Facebook's city pages,
// which of them are verified search centres, and each centre's country and currency. Import from
// '@nabvy/contracts/modules/city-pages'. Keys on the numeric Facebook city-page ID, kept as text
// (it does not fit a 32-bit integer and is never arithmetic); this module never parses names or
// town slugs (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-38).

export const module = 'city-pages'

/** A Facebook city-page ID, as reported on a card or a search control. Never validated as numeric. */
export const CityPageId = z.string().min(1).max(64)
export type CityPageId = z.infer<typeof CityPageId>

/** Where a city page's coordinate came from. `seed`: the seed file. `card`: added with no coordinate. */
export const CityPagesCoordSource = z.enum(['seed', 'card'])
export type CityPagesCoordSource = z.infer<typeof CityPagesCoordSource>

/** Great Britain and Northern Ireland (GBP), or Ireland (EUR, inactive while the beta is UK only). */
export const CityPagesCountry = z.enum(['GB', 'IE'])
export type CityPagesCountry = z.infer<typeof CityPagesCountry>

const Latitude = z.number().min(-90).max(90)
const Longitude = z.number().min(-180).max(180)

/** One row of `city_pages.v_city_pages` (internal): a Facebook city page, known or seen. */
export const CityPagesCityPage = z.strictObject({
  cityPageId: CityPageId,
  name: z.string().min(1),
  /** Raw town labels this ID has been seen under (listing-ingest's `town_label`), earliest first. */
  towns: z.array(z.string().min(1)),
  /** Town-level approximation from the seed; null for a card-added page or a verified centre. */
  lat: Latitude.nullable(),
  lng: Longitude.nullable(),
  coordSource: CityPagesCoordSource,
  firstSeenAt: IsoTimestamp,
})
export type CityPagesCityPage = z.infer<typeof CityPagesCityPage>

/** One row of `city_pages.v_centres` (internal): a candidate or verified search centre. */
export const CityPagesCentre = z.strictObject({
  cityPageId: CityPageId,
  /** Chosen for the national grid (rule 14: 80–100 km apart), or added on demand for a hunt. */
  active: z.boolean(),
  /** True only after a qualifying newest-first page-1 run bound it (docs/decisions.md:137). */
  verified: z.boolean(),
  /** The run-coverage job whose search bound this centre; null until verified. */
  verifiedByJob: z.int().positive().nullable(),
  country: CityPagesCountry,
  currency: Currency,
  /** Facebook's own reported centre from `run_coverage.v_search_controls`; null until verified. */
  reportedLat: Latitude.nullable(),
  reportedLng: Longitude.nullable(),
  /** Radius in which a city page counts as in this centre's area. */
  areaKm: z.number().positive(),
})
export type CityPagesCentre = z.infer<typeof CityPagesCentre>

/** One row of `city_pages.v_area_membership` (internal): a city page's nearest active centre. */
export const CityPagesAreaMembership = z.strictObject({
  cityPageId: CityPageId,
  /** Null when no active centre has a known coordinate to measure from. */
  centreId: CityPageId.nullable(),
  distanceKm: z.number().min(0).nullable(),
  /** True when `distanceKm` is within the nearest centre's `areaKm`. Always false if null. */
  inArea: z.boolean(),
})
export type CityPagesAreaMembership = z.infer<typeof CityPagesAreaMembership>

/** City pages added or changed (new page, or a centre's verified/active state changed). */
export const CityPagesChangedEvent = z.strictObject({
  cityPageIds: z.array(CityPageId).min(1).max(500),
})
export type CityPagesChangedEvent = z.infer<typeof CityPagesChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'city-pages.changed': { 1: CityPagesChangedEvent },
})

/** Error codes the module returns as values. */
export const CityPagesErrorCode = z.enum([
  'city-pages.unknown_centre', // verifying a city page with no centre row (not a grid candidate)
  'city-pages.already_verified', // the centre is already verified; verify() is not a re-run
  'city-pages.no_qualifying_search', // the job has no newest-first, non-degraded search for this centre
])
export type CityPagesErrorCode = z.infer<typeof CityPagesErrorCode>
