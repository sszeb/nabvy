// Pure rules of run-coverage: read each search of a run from RUN_SUMMARY.searches[] (or the
// sourceOutcome rows when the summary has none), and judge it complete, capped or degraded.
// No I/O here.
import {
  RUN_COVERAGE_SHORT_FEED_MAX_PAGES,
  RUN_COVERAGE_SHORT_FEED_MIN_LISTINGS,
} from '@nabvy/config/modules/run-coverage'
import {
  type RunCoverageBaselineBasis,
  type RunCoverageFeedType,
  type RunCoverageKind,
  type RunCoverageReason,
  RunCoverageRoute,
  type RunCoverageStatus,
  RunCoverageStopReason,
} from '@nabvy/contracts/modules/run-coverage'

type Json = Record<string, unknown>

/** One search of a run as the actor reported it. */
export interface SearchReport {
  searchIndex: number
  centreId: string | null
  term: string | null
  kind: RunCoverageKind
  route: RunCoverageRoute
  stopReason: RunCoverageStopReason
  reportedRoute: string | null
  reportedStopReason: string | null
  pages: number | null
  listings: number
  binding: string | null
  controls: {
    latitude: number | null
    longitude: number | null
    radiusKm: number | null
    sort: string | null
  }
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function parseUrl(url: string | null): URL | null {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** The city page a Marketplace search URL is centred on (`/marketplace/<id>/search/`). */
export function centreOf(url: string | null): string | null {
  const path = parseUrl(url)?.pathname ?? ''
  return /^\/marketplace\/([0-9A-Za-z_-]{1,200})\/search\/?$/.exec(path)?.[1] ?? null
}

const NEWEST = 'creation_time_descend'

/**
 * Check kind from the order: Facebook's reported sort first, then the URL's `sortBy`, then the
 * run's `searchSort`. A default-order search is a sweep. Anything contradictory reads `unknown`.
 */
export function kindOf(
  controlSort: string | null,
  url: string | null,
  searchSort: string | null,
): RunCoverageKind {
  const urlSort = parseUrl(url)?.searchParams.get('sortBy') ?? null
  const reported = (controlSort ?? urlSort)?.toLowerCase() ?? null
  if (reported === NEWEST) return 'newest'
  if (reported === null && searchSort === 'newest') return 'newest'
  if (urlSort === null && searchSort === 'default') return 'sweep'
  return 'unknown'
}

function controlsOf(value: unknown): SearchReport['controls'] {
  const c = isObject(value) ? value : {}
  return {
    latitude: num(c.latitude),
    longitude: num(c.longitude),
    radiusKm: num(c.radiusKm),
    sort: str(c.sort),
  }
}

function report(
  searchIndex: number,
  fields: {
    url: string | null
    term: string | null
    route: unknown
    stopReason: unknown
    pages: unknown
    listings: unknown
    binding: unknown
    controls: unknown
  },
  searchSort: string | null,
): SearchReport {
  const controls = controlsOf(fields.controls)
  const reportedRoute = str(fields.route)
  const reportedStopReason = str(fields.stopReason)
  return {
    searchIndex,
    centreId: centreOf(fields.url),
    term: fields.term ?? parseUrl(fields.url)?.searchParams.get('query') ?? null,
    kind: kindOf(controls.sort, fields.url, searchSort),
    route: RunCoverageRoute.parse(reportedRoute),
    stopReason: RunCoverageStopReason.parse(reportedStopReason),
    reportedRoute,
    reportedStopReason,
    pages: count(fields.pages),
    listings: count(fields.listings) ?? 0,
    binding: str(fields.binding),
    controls,
  }
}

/**
 * Every search of a run. `RUN_SUMMARY.searches[]` when it has any; otherwise the run's
 * `sourceOutcome` rows (a URL-sourced search reports only there), whose route vocabulary differs
 * and so reads `unknown`; otherwise, for a run that failed before reporting, one empty search per
 * term of the actor input, so the failure is still recorded per scope.
 */
export function searchesOf(
  summary: Json | null,
  sourceOutcomes: Json[],
  actorInput: Json | null,
): SearchReport[] {
  const searchSort = str(summary?.searchSort) ?? str(actorInput?.sort)
  const listed = Array.isArray(summary?.searches) ? summary.searches.filter(isObject) : []
  if (listed.length > 0) {
    return listed.map((s, i) =>
      report(
        i,
        {
          url: str(s.url),
          term: str(s.term),
          route: s.route,
          stopReason: s.stopReason,
          pages: s.pages,
          listings: s.listings,
          binding: s.sourceBinding,
          controls: s.searchControls,
        },
        searchSort,
      ),
    )
  }
  if (sourceOutcomes.length > 0) {
    return sourceOutcomes.map((o, i) =>
      report(
        count(o.sourceIndex) ?? i,
        {
          url: str(o.sourceUrl) ?? str(o.url),
          term: null,
          route: o.sourceRoute,
          stopReason: o.sourceStopReason,
          pages: o.sourcePages,
          listings: o.sourceRows,
          binding: o.sourceBinding,
          controls: null,
        },
        searchSort,
      ),
    )
  }
  const terms = Array.isArray(actorInput?.searchTerms)
    ? actorInput.searchTerms.filter((t): t is string => typeof t === 'string')
    : []
  const cityId = str(actorInput?.cityId)
  return terms.map((term, i) =>
    report(
      i,
      {
        url: cityId
          ? `https://www.facebook.com/marketplace/${cityId}/search/?query=${encodeURIComponent(term)}${searchSort === 'newest' ? '&sortBy=creation_time_descend' : ''}`
          : null,
        term,
        route: null,
        stopReason: null,
        pages: null,
        listings: 0,
        binding: null,
        controls: null,
      },
      searchSort,
    ),
  )
}

/** What the gap check found: listings on page 1 shared with the previous healthy read. */
export type Overlap = { checked: true; shared: number } | { checked: false; skipped: boolean }

export interface Judgement {
  status: RunCoverageStatus
  reasons: RunCoverageReason[]
  feedType: RunCoverageFeedType | null
}

/**
 * The status of one search (CONTAINER_LISTINGS.md:189-192; README.md:101-108; the card):
 * degraded on a failed run, a `browser-fallback`, `failed` or unknown route, an unknown stop
 * reason, an empty search, or no page-1 overlap with the previous check; else complete when
 * Facebook's feed ran out, capped when our own cap stopped it. `overlap.skipped` means
 * listing-ingest is off and the gap check could not run: noted, not degraded.
 */
export function judge(search: SearchReport, runFailed: boolean, overlap: Overlap): Judgement {
  const reasons: RunCoverageReason[] = []
  if (runFailed) reasons.push('run-failed')
  if (search.route === 'browser-fallback') reasons.push('route-browser-fallback')
  if (search.route === 'failed') reasons.push('route-failed')
  if (search.route === 'unknown') reasons.push('route-unknown')
  if (search.stopReason === 'unknown') reasons.push('stop-unknown')
  if (search.listings === 0) reasons.push('empty')
  if (overlap.checked && overlap.shared === 0) reasons.push('no-page-one-overlap')
  const degraded = reasons.length > 0
  if (!overlap.checked && overlap.skipped) reasons.push('overlap-unchecked')
  if (search.binding !== 'verified') reasons.push('binding-unverified')
  if (degraded) return { status: 'degraded', reasons, feedType: null }
  const status = search.stopReason === 'source-no-new-listings' ? 'complete' : 'capped'
  return { status, reasons, feedType: status === 'complete' ? feedTypeOf(search) : null }
}

/**
 * A complete default-order read is a short feed when it ends at 6 pages or fewer, or holds under
 * 150 listings (starting values, @nabvy/config/modules/run-coverage). Null for a newest check.
 */
export function feedTypeOf(search: SearchReport): RunCoverageFeedType | null {
  if (search.kind !== 'sweep') return null
  const shortByPages = search.pages !== null && search.pages <= RUN_COVERAGE_SHORT_FEED_MAX_PAGES
  return shortByPages || search.listings < RUN_COVERAGE_SHORT_FEED_MIN_LISTINGS ? 'short' : 'long'
}

/**
 * The baseline a judged search may set: a complete scan sets `complete`, a healthy capped read
 * `bounded`. Degraded reads, unverified bindings and scopes without a centre, term or known kind
 * set none (actor-integration.md 2.9).
 */
export function baselineBasis(
  search: SearchReport,
  judgement: Judgement,
): RunCoverageBaselineBasis | null {
  if (judgement.status === 'degraded') return null
  if (search.binding !== 'verified') return null
  if (!search.centreId || !search.term || search.kind === 'unknown') return null
  return judgement.status === 'complete' ? 'complete' : 'bounded'
}

/** Splits a list into batches of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
