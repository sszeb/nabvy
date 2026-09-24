import { z } from 'zod'

// What Nabvy sends to the Facebook actor (build 1.0.82), so a bad input is refused here instead of
// costing a failed run. Every rule is one of three kinds, and says which:
// - schema: a type, range or enum from the actor's `.actor/input_schema.json` (a listed file);
// - gateway: a rule `apify_gateway.enqueue_run` also enforces (supabase/migrations, supabase/README.md);
// - Nabvy: Nabvy's own conservative rule. It is never a claim about what the actor accepts.
// The actor's own validation code is not on the owner's reading list (docs/fb-actor-sources.md), so
// nothing here mirrors it. Reference: docs/fb-actor-reference.md §2; docs/fb-actor-scope-report.md.

/** Nabvy: pin the build the recorded run resolved `latest` to (fixtures/.../run.json:12,16). */
export const PINNED_ACTOR_BUILD = '1.0.82'

/** Gateway: a run may reserve at most this many Facebook requests. */
export const GATEWAY_MAX_REQUESTS = 1000

/**
 * Nabvy: the Apify timeout must exceed `maxRunSeconds` by at least this much. The actor writes its
 * rows and RUN_SUMMARY only at the end, so a run the timeout aborts returns nothing
 * (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310). 60 s is the margin the recorded run had
 * (240 s against 300 s) and finished within. The gateway enforces the same margin.
 */
export const TIMEOUT_MARGIN_SECONDS = 60

// Schema: up to 20 terms and 1,000 listing IDs (fb-scrap-engine/.actor/input_schema.json:18,77).
const MAX_TERMS = 20
const MAX_LISTING_IDS = 1000
// Nabvy: a term length limit of its own; the listed files set none.
const MAX_TERM_LENGTH = 80
// Nabvy: detail batches of up to about 200 IDs (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68).
export const MAX_DETAIL_BATCH = 200
// Nabvy: listings per page allowed for when sizing maxListings. A page holds "roughly 22"
// (fb-scrap-engine/.actor/input_schema.json:69); newest-first page 1 held 24 in the 1.0.82 check
// (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239); 25 stays above both.
const LISTINGS_PER_PAGE = 25
// Schema: maxListings is at most 5,000, run-wide (fb-scrap-engine/.actor/input_schema.json:61-63).
const MAX_LISTINGS = 5000

/**
 * Nabvy's term key for de-duplication: trimmed, whitespace collapsed, NFKC, en-GB lower case. The
 * schema says only that "duplicates are ignored regardless of case" (input_schema.json:18).
 */
export const termKey = (term: string) =>
  term.trim().replace(/\s+/gu, ' ').normalize('NFKC').toLocaleLowerCase('en-GB')

const cleanTerm = (term: string) => term.trim().replace(/\s+/gu, ' ')

// Schema types are integer (input_schema.json), so a JSON string such as "60" is refused.
const count = (min: number, max: number) => z.number().int().min(min).max(max)
const digits = /^\d+$/

// Nabvy (and the gateway): residential GB only. "Residential proxy in the city's country is the
// reliable choice"; the v3 default sets no country; datacenter IPs returned no listing data
// (fb-scrap-engine/.actor/input_schema.json:171-183; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-80,333-336).
const proxyConfiguration = () => ({
  useApifyProxy: true as const,
  apifyProxyGroups: ['RESIDENTIAL'] as ['RESIDENTIAL'],
  apifyProxyCountry: 'GB' as const,
})

// Keys are exactly the schema's 23 properties (input_schema.json:8-183); unknown fields are
// rejected (fb-scrap-engine/README.md:95-96). Ranges and enums cite input_schema.json lines.
export const FacebookActorInput = z
  .strictObject({
    inputVersion: z.literal(3), // :8-14; the gateway requires 3
    searchTerms: z
      .array(
        z
          .string()
          .refine((term) => term.trim().length > 0 && term.trim().length <= MAX_TERM_LENGTH, {
            message: `each search term must be 1–${MAX_TERM_LENGTH} characters (Nabvy limit)`,
          }),
      )
      .max(MAX_TERMS) // :15-23
      .optional(),
    cityId: z.string().regex(digits, 'cityId must be a numeric string').optional(), // :24-30
    radiusKm: count(1, 500).optional(), // :31-38
    sort: z.enum(['default', 'newest']).optional(), // :39-52
    listingIds: z
      .array(z.string().regex(digits, 'listing IDs are numeric strings'))
      .max(MAX_LISTING_IDS) // :74-81
      .optional(),
    startUrls: z.never().optional(), // gateway: refused
    includeDetails: z.boolean().optional(), // :53-57
    detailRoute: z.enum(['graphql', 'page']).optional(), // :116-129
    browserFallback: z.literal(false), // gateway: must be false (README.md:84-85)
    detailSessionSize: count(5, 100).optional(), // :130-136
    maxListings: count(1, MAX_LISTINGS), // :58-65; Nabvy: always sent
    maxPagesPerSearch: count(1, 100).optional(), // :66-73
    maxDetails: count(0, 6000).optional(), // :88-94
    maxRequests: count(1, GATEWAY_MAX_REQUESTS), // :95-101 allows 20,000; gateway: 1,000
    maxRunSeconds: count(10, 3600), // :102-108; gateway: required
    detailConcurrency: count(1, 8).optional(), // :109-115
    useDetailCache: z.literal(false), // gateway: no second copy in Apify (HANDOFF.md:220-221)
    detailCacheTtlHours: count(1, 168).optional(), // :147-153
    detailCacheRetryMinutes: count(5, 1440).optional(), // :154-160
    sourceDiagnostics: z.literal(true), // Nabvy: keep on (:161-165)
    responseInventory: z.boolean().optional(), // :166-170
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

    // Nabvy rules. The listed files do not say which combinations the actor refuses
    // (docs/fb-actor-reference.md §2.2, rules 13-14), so Nabvy sends only unambiguous inputs.
    if (terms.length && !input.cityId) issue('searchTerms require cityId', 'cityId')
    if (input.cityId && !terms.length) issue('cityId is sent only with searchTerms', 'cityId')
    if ((input.radiusKm !== undefined || input.sort !== undefined) && !terms.length) {
      issue('radiusKm and sort are sent only with searchTerms', 'searchTerms')
    }
    if (!terms.length && !ids.length) {
      issue('send searchTerms with cityId, or listingIds', 'searchTerms')
    }
    // Searches that fill maxListings could crowd IDs out: IDs run after searches, within the
    // result limit (fb-scrap-engine/README.md:73-74). The gateway enforces this too.
    if (terms.length && ids.length) {
      issue('a run is either searches or a detail batch, not both', 'listingIds')
    }
    if (new Set(terms.map(termKey)).size !== terms.length) {
      issue('search terms must be distinct', 'searchTerms')
    }
    if (new Set(ids).size !== ids.length) issue('listing IDs must be distinct', 'listingIds')
    if (input.includeDetails === false && input.maxDetails !== undefined) {
      issue('maxDetails is sent only with includeDetails', 'maxDetails')
    }
  })

export type FacebookActorInput = z.infer<typeof FacebookActorInput>

// Gateway: memory 512, 1,024 or 2,048 MB and a timeout of 60-1,800 s. Whether the actor honours
// 512 MB is disputed (fb-scrap-engine/README.md:86-87 against EVIDENCE_LEDGER.md:337-338), so the
// presets use 1,024 MB.
export const ApifyRunOptions = z.strictObject({
  build: z.string().min(1),
  memory: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
  timeout: count(60, 1800),
})

export type ApifyRunOptions = z.infer<typeof ApifyRunOptions>

export type FacebookActorRun = { input: FacebookActorInput; runOptions: ApifyRunOptions }

/** Validates an input with its run options, including the timeout margin. */
export function parseFacebookActorRun(run: FacebookActorRun): FacebookActorRun {
  const input = FacebookActorInput.parse(run.input)
  const runOptions = ApifyRunOptions.parse(run.runOptions)
  if (runOptions.timeout < input.maxRunSeconds + TIMEOUT_MARGIN_SECONDS) {
    throw new Error(
      `the Apify timeout must be at least maxRunSeconds + ${TIMEOUT_MARGIN_SECONDS} s`,
    )
  }
  return { input, runOptions }
}

/**
 * Nabvy's own request budget; never the actor's default, which the listed files do not state.
 * - Per search: 1 bootstrap + its pages + 1 spare for the documented bootstrap retry
 *   (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:107-110). The recorded run used 2 for 1 page.
 * - Per detail: 2 requests on graphql, 1 on the page route, plus 10% for a retry, rounded up
 *   (fb-scrap-engine/.actor/input_schema.json:91).
 * `maxRequests` is a hard cap "never exceeded" (fb-scrap-engine/README.md:78), so a generous budget
 * only raises the gateway's reservation; details it cuts come back unattempted and are requeued.
 */
export function requestBudget(plan: {
  searches: number
  pagesPerSearch: number
  details: number
  detailRoute: 'graphql' | 'page'
}): number {
  const perDetail = plan.detailRoute === 'graphql' ? 2 : 1
  return (
    plan.searches * (1 + plan.pagesPerSearch + 1) + Math.ceil((plan.details * perDetail * 11) / 10)
  )
}

function withinGateway(needed: number, what: string): number {
  if (needed > GATEWAY_MAX_REQUESTS) {
    throw new Error(`${what} needs ${needed} requests; the gateway allows ${GATEWAY_MAX_REQUESTS}`)
  }
  return needed
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

const runOptions = (maxRunSeconds: number): ApifyRunOptions => ({
  build: PINNED_ACTOR_BUILD,
  memory: 1024,
  timeout: maxRunSeconds + TIMEOUT_MARGIN_SECONDS,
})

function searchRun(
  plan: SearchPlan,
  shape: { sort: 'default' | 'newest'; pages: number; maxRunSeconds: number },
): FacebookActorRun {
  const searchTerms = uniqueTerms(plan.terms)
  const maxListings = searchTerms.length * shape.pages * LISTINGS_PER_PAGE
  if (maxListings > MAX_LISTINGS) {
    throw new Error(
      `${searchTerms.length} terms × ${shape.pages} pages need maxListings ${maxListings}; the schema allows ${MAX_LISTINGS}`,
    )
  }
  const maxRequests = withinGateway(
    requestBudget({
      searches: searchTerms.length,
      pagesPerSearch: shape.pages,
      details: 0,
      detailRoute: 'graphql',
    }),
    'this search plan',
  )
  return parseFacebookActorRun({
    input: {
      inputVersion: 3,
      searchTerms,
      cityId: plan.cityId,
      // Sent explicitly: the schema states no default for sort (input_schema.json:39-52).
      sort: shape.sort,
      includeDetails: false,
      maxListings,
      maxPagesPerSearch: shape.pages,
      maxRequests,
      maxRunSeconds: shape.maxRunSeconds,
      browserFallback: false,
      useDetailCache: false,
      sourceDiagnostics: true,
      proxyConfiguration: proxyConfiguration(),
    },
    runOptions: runOptions(shape.maxRunSeconds),
  })
}

// The presets follow the call patterns in fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:63-68.
// Their time limits are Nabvy's choices: 3 page-1 terms took 26 s in the 1.0.82 check
// (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239), and the actor's own maxRunSeconds default is 900 s.

/** Preset A: frequent newest-first check, page 1 of each term. */
export const newestFirstCheck = (plan: SearchPlan) =>
  searchRun(plan, { sort: 'newest', pages: 1, maxRunSeconds: 120 })

/** Preset B: default-order catch-up, pages 1–4 of each term. */
export const catchUpCheck = (plan: SearchPlan) =>
  searchRun(plan, { sort: 'default', pages: 4, maxRunSeconds: 300 })

/**
 * Preset C: daily full sweep, 60 pages per term (a full read is about 60 pages:
 * fb-scrap-engine/docs/EVIDENCE_LEDGER.md:302-304). At 25 listings a page that is 1,500 per term,
 * so at most 3 terms fit under maxListings 5,000.
 */
export const fullSweep = (plan: SearchPlan) =>
  searchRun(plan, { sort: 'default', pages: 60, maxRunSeconds: 900 })

/** Preset D: detail batch of up to 200 listing IDs, on the route chosen by route health. */
export function detailBatch(listingIds: readonly string[], detailRoute: 'graphql' | 'page') {
  const ids = [...new Set(listingIds)]
  if (ids.length > MAX_DETAIL_BATCH) {
    throw new Error(`a detail batch holds at most ${MAX_DETAIL_BATCH} IDs, not ${ids.length}`)
  }
  const maxRequests = withinGateway(
    requestBudget({ searches: 0, pagesPerSearch: 0, details: ids.length, detailRoute }),
    'this detail batch',
  )
  const maxRunSeconds = 900
  return parseFacebookActorRun({
    input: {
      inputVersion: 3,
      listingIds: ids,
      includeDetails: true,
      detailRoute,
      maxListings: Math.max(1, ids.length),
      // The schema's described default, sent explicitly: maxListings plus 10%, so the last
      // listing is not left unattempted on graphql (input_schema.json:88-94).
      maxDetails: Math.min(6000, Math.ceil((ids.length * 11) / 10)),
      maxRequests,
      maxRunSeconds,
      detailConcurrency: 4,
      browserFallback: false,
      useDetailCache: false,
      sourceDiagnostics: true,
      proxyConfiguration: proxyConfiguration(),
    },
    runOptions: runOptions(maxRunSeconds),
  })
}
