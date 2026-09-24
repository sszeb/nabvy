import { z } from 'zod'

// What Nabvy sends to the Facebook actor (build 1.0.82). It mirrors the actor's own v3 validation
// (fb-scrap-engine src/gateway-input.js at f177a44) and adds the apify-gateway's stricter rules
// (supabase/migrations/20260924020000_apify_gateway.sql), so a bad input is rejected here instead
// of costing a failed run. Reference: docs/fb-actor-reference.md §2.

export const PINNED_ACTOR_BUILD = '1.0.82'

/** The gateway refuses a run with more than this many Facebook requests. */
export const GATEWAY_MAX_REQUESTS = 1000

const MAX_TERMS = 20
const MAX_TERM_LENGTH = 80
const MAX_LISTING_IDS = 1000

// The actor's term key: trimmed, whitespace collapsed, NFKC, en-GB lower case.
export const termKey = (term: string) =>
  term.trim().replace(/\s+/gu, ' ').normalize('NFKC').toLocaleLowerCase('en-GB')

const cleanTerm = (term: string) => term.trim().replace(/\s+/gu, ' ')

const count = (min: number, max: number) => z.number().int().min(min).max(max)

// Residential GB only: datacenter IPs returned no listing data (reference §6).
const proxyConfiguration = (): FacebookActorInput['proxyConfiguration'] => ({
  useApifyProxy: true,
  apifyProxyGroups: ['RESIDENTIAL'],
  apifyProxyCountry: 'GB',
})

export const FacebookActorInput = z
  .strictObject({
    inputVersion: z.literal(3),
    searchTerms: z
      .array(
        z
          .string()
          .refine((term) => term.trim().length > 0 && term.trim().length <= MAX_TERM_LENGTH, {
            message: `each search term must be 1–${MAX_TERM_LENGTH} characters`,
          }),
      )
      .max(MAX_TERMS)
      .optional(),
    cityId: z
      .string()
      .regex(/^\d{5,30}$/, 'cityId must be a numeric city-page ID string')
      .optional(),
    radiusKm: count(1, 500).optional(),
    sort: z.enum(['default', 'newest']).optional(),
    listingIds: z
      .array(z.string().regex(/^\d{1,30}$/, 'listing IDs are digit strings'))
      .max(MAX_LISTING_IDS)
      .optional(),
    includeDetails: z.boolean().optional(),
    detailRoute: z.enum(['graphql', 'page']).optional(),
    browserFallback: z.literal(false),
    detailSessionSize: count(5, 100).optional(),
    maxListings: count(1, 5000).optional(),
    maxPagesPerSearch: count(1, 100).optional(),
    maxDetails: count(0, 6000).optional(),
    maxRequests: count(1, GATEWAY_MAX_REQUESTS),
    maxRunSeconds: count(10, 3600),
    detailConcurrency: count(1, 8).optional(),
    useDetailCache: z.literal(false),
    sourceDiagnostics: z.literal(true),
    responseInventory: z.boolean().optional(),
    proxyConfiguration: z.strictObject({
      useApifyProxy: z.literal(true),
      apifyProxyGroups: z.tuple([z.literal('RESIDENTIAL')]),
      apifyProxyCountry: z.literal('GB'),
    }),
  })
  .superRefine((input, ctx) => {
    const terms = input.searchTerms ?? []
    const ids = input.listingIds ?? []
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] })

    if (terms.length && !input.cityId) issue('searchTerms require cityId', 'cityId')
    if (input.cityId && !terms.length) issue('cityId is used only with searchTerms', 'cityId')
    if ((input.radiusKm !== undefined || input.sort !== undefined) && !terms.length) {
      issue('radiusKm and sort apply only to searchTerms', 'searchTerms')
    }
    if (!terms.length && !ids.length)
      issue('provide searchTerms with cityId, or listingIds', 'searchTerms')
    // Nabvy rule: searches that fill maxListings would crowd the IDs out (reference §2.5).
    if (terms.length && ids.length)
      issue('a run is either searches or a detail batch, not both', 'listingIds')
    if (new Set(terms.map(termKey)).size !== terms.length)
      issue('search terms must be distinct', 'searchTerms')
    if (new Set(ids).size !== ids.length) issue('listing IDs must be distinct', 'listingIds')
    if (input.includeDetails === false && input.maxDetails) {
      issue('maxDetails requires includeDetails', 'maxDetails')
    }
  })

export type FacebookActorInput = z.infer<typeof FacebookActorInput>

export const ApifyRunOptions = z.strictObject({
  build: z.string().min(1),
  memory: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
  timeout: count(60, 1800),
})

export type ApifyRunOptions = z.infer<typeof ApifyRunOptions>

export type FacebookActorRun = { input: FacebookActorInput; runOptions: ApifyRunOptions }

/** Validates an input with its run options, including the gateway's timeout rule. */
export function parseFacebookActorRun(run: FacebookActorRun): FacebookActorRun {
  const input = FacebookActorInput.parse(run.input)
  const runOptions = ApifyRunOptions.parse(run.runOptions)
  if (input.maxRunSeconds > runOptions.timeout) {
    throw new Error('maxRunSeconds must not exceed the Apify run timeout')
  }
  return { input, runOptions }
}

/**
 * The actor's own default `maxRequests` for an input (src/gateway-input.js:103-118): each search
 * reserves its pages plus 3, each listing ID its item reserve, plus the detail allowance.
 */
export function actorDefaultMaxRequests(input: {
  searchTerms?: readonly string[] | undefined
  listingIds?: readonly string[] | undefined
  includeDetails?: boolean | undefined
  detailRoute?: 'graphql' | 'page' | undefined
  browserFallback?: boolean | undefined
  useDetailCache?: boolean | undefined
  maxListings?: number | undefined
  maxPagesPerSearch?: number | undefined
  maxDetails?: number | undefined
}): number {
  const feeds = new Set((input.searchTerms ?? []).map(termKey)).size
  const items = new Set(input.listingIds ?? []).size
  const includeDetails = input.includeDetails ?? true
  const detailRoute = input.detailRoute ?? (input.useDetailCache === true ? 'page' : 'graphql')
  const maxListings = input.maxListings ?? Math.max(500, (input.listingIds ?? []).length)
  const maxPagesPerSearch = input.maxPagesPerSearch ?? 20
  const maxDetails = includeDetails
    ? (input.maxDetails ?? Math.min(6000, maxListings + Math.ceil(maxListings / 10)))
    : 0
  const itemReserve =
    (detailRoute === 'graphql' ? 2 : 1) + ((input.browserFallback ?? true) ? 1 : 0)
  return Math.min(20_000, feeds * (maxPagesPerSearch + 3) + items * itemReserve + maxDetails)
}

type SearchPlan = { cityId: string; terms: readonly string[] }

function uniqueTerms(terms: readonly string[]): string[] {
  const byKey = new Map<string, string>()
  for (const term of terms) {
    const key = termKey(term)
    if (!byKey.has(key)) byKey.set(key, cleanTerm(term))
  }
  return [...byKey.values()]
}

function searchRun(
  plan: SearchPlan,
  shape: { sort?: 'newest'; pages: number; maxListings?: number; maxRunSeconds: number },
  runOptions: Omit<ApifyRunOptions, 'build'>,
): FacebookActorRun {
  const searchTerms = uniqueTerms(plan.terms)
  const base = {
    inputVersion: 3 as const,
    searchTerms,
    cityId: plan.cityId,
    ...(shape.sort ? { sort: shape.sort } : {}),
    includeDetails: false,
    maxPagesPerSearch: shape.pages,
    ...(shape.maxListings ? { maxListings: shape.maxListings } : {}),
    browserFallback: false as const,
    useDetailCache: false as const,
    sourceDiagnostics: true as const,
    maxRunSeconds: shape.maxRunSeconds,
    proxyConfiguration: proxyConfiguration(),
  }
  const maxRequests = actorDefaultMaxRequests(base)
  if (maxRequests > GATEWAY_MAX_REQUESTS) {
    throw new Error(
      `this plan needs ${maxRequests} requests; the gateway allows ${GATEWAY_MAX_REQUESTS}`,
    )
  }
  return parseFacebookActorRun({
    input: { ...base, maxRequests },
    runOptions: { build: PINNED_ACTOR_BUILD, ...runOptions },
  })
}

/** Preset A: frequent newest-first check, page 1 of each term (reference §2.5). */
export const newestFirstCheck = (plan: SearchPlan) =>
  searchRun(plan, { sort: 'newest', pages: 1, maxRunSeconds: 120 }, { memory: 512, timeout: 240 })

/** Preset B: default-order catch-up, pages 1–4 of each term. */
export const catchUpCheck = (plan: SearchPlan) =>
  searchRun(plan, { pages: 4, maxRunSeconds: 300 }, { memory: 512, timeout: 420 })

/** Preset C: daily full sweep, up to 60 pages per term; at most 3 terms (about 1,400 listings each). */
export function fullSweep(plan: SearchPlan) {
  const terms = uniqueTerms(plan.terms)
  if (terms.length > 3)
    throw new Error('a full sweep covers at most 3 terms per run (maxListings 5,000)')
  return searchRun(
    { ...plan, terms },
    { pages: 60, maxListings: 1400 * terms.length, maxRunSeconds: 900 },
    { memory: 1024, timeout: 1100 },
  )
}

/** Preset D: detail batch by listing ID, on the route chosen by route health. */
export function detailBatch(listingIds: readonly string[], detailRoute: 'graphql' | 'page') {
  const ids = [...new Set(listingIds)]
  const base = {
    inputVersion: 3 as const,
    listingIds: ids,
    includeDetails: true,
    detailRoute,
    detailConcurrency: 4,
    browserFallback: false as const,
    useDetailCache: false as const,
    sourceDiagnostics: true as const,
    maxRunSeconds: 900,
    proxyConfiguration: proxyConfiguration(),
  }
  const maxRequests = actorDefaultMaxRequests(base)
  if (maxRequests > GATEWAY_MAX_REQUESTS) {
    throw new Error(
      `${ids.length} IDs on the ${detailRoute} route need ${maxRequests} requests; the gateway allows ${GATEWAY_MAX_REQUESTS}`,
    )
  }
  return parseFacebookActorRun({
    input: { ...base, maxRequests },
    runOptions: { build: PINNED_ACTOR_BUILD, memory: 1024, timeout: 1100 },
  })
}
