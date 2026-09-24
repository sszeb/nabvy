// Port of fb-scrap-engine app/route-health.js (f177a44), kept behaviour-for-behaviour identical;
// its tests are ported in test/route-health.test.ts. Chooses the actor's `detailRoute` per region
// from recent runs' RUN_SUMMARY.detailRoute stats: stay on the cheaper replayed query (graphql)
// while it works, switch to the item page when it stops working, and probe graphql again now and
// then to recover. Known caveat, decision pending (docs/questions.md): a reply for a listing with
// no description counts as a failed replay.

export type DetailRoute = 'graphql' | 'page'

/** One run's `RUN_SUMMARY.detailRoute` object plus its Apify run ID; `{ runId, route: 'page' }` for a page-route run. */
export type DetailRouteRun = {
  runId?: string
  route: DetailRoute
  detailRequests?: number
  detailOk?: number
  circuitOpen?: boolean
  queryIds?: string[]
  bootstraps?: number
  failedBootstraps?: number
}

export type RouteReason =
  | 'healthy'
  | 'insufficient-data'
  | 'circuit-open'
  | 'bootstrap-failing'
  | 'low-success'
  | 'probe'
  | 'probe-failed'
  | 'probe-inconclusive'
  | 'recovered'
  | 'still-unhealthy'

export type RouteDecision = {
  route: DetailRoute
  reason: RouteReason
  successRate: number | null
  attempts: number
  newQueryIds: string[]
  alert: boolean
}

/** Kept per region between calls; start with null. */
export type RouteHealthState = {
  route: DetailRoute
  runsSinceSwitch: number
  switched?: boolean
  probing?: boolean
  probeRuns?: number
  probeAttempts?: number
  probeOk?: number
  runKey?: string | null
  lastDecision?: RouteDecision
}

export type RouteHealthOptions = {
  minSuccess: number
  minAttempts: number
  windowRuns: number
  probeEvery: number
  minProbeAttempts: number
  minFailedBootstraps: number
}

export const ROUTE_HEALTH_DEFAULTS: RouteHealthOptions = {
  minSuccess: 0.95,
  minAttempts: 50,
  windowRuns: 10,
  probeEvery: 10,
  minProbeAttempts: 20,
  minFailedBootstraps: 2,
}

type ReplayCounts = {
  attempts: number
  ok: number
  circuitOpen: boolean
  queryIds: string[]
  bootstrapFailing: boolean
}

const toCount = (value: unknown) => Number(value) || 0

function replayCounts(
  stats: DetailRouteRun | undefined,
  minFailedBootstraps: number,
): ReplayCounts {
  if (stats?.route !== 'graphql') {
    return { attempts: 0, ok: 0, circuitOpen: false, queryIds: [], bootstrapFailing: false }
  }
  const attempts = toCount(stats.detailRequests)
  return {
    attempts,
    ok: toCount(stats.detailOk),
    circuitOpen: stats.circuitOpen === true,
    queryIds: Array.isArray(stats.queryIds) ? stats.queryIds : [],
    // Every session page failed to supply the replay template, so nothing was replayed. One
    // templateless page is usually a sold or removed listing, so it takes minFailedBootstraps.
    bootstrapFailing:
      attempts === 0 &&
      toCount(stats.failedBootstraps) >= Math.max(minFailedBootstraps, toCount(stats.bootstraps)),
  }
}

/**
 * Call before each detail run for a region, with the summaries of the runs completed so far,
 * oldest first. A repeated call whose latest entry has the same `runId` returns the previous
 * decision unchanged, so a retried scheduler tick cannot count a run twice; entries without a
 * `runId` are never deduplicated.
 */
export function recommendDetailRoute(
  history: readonly DetailRouteRun[] = [],
  state: RouteHealthState | null = null,
  options: Partial<RouteHealthOptions> = {},
): RouteDecision & { state: RouteHealthState } {
  const { minSuccess, minAttempts, windowRuns, probeEvery, minProbeAttempts, minFailedBootstraps } =
    { ...ROUTE_HEALTH_DEFAULTS, ...options }
  const counts = (stats: DetailRouteRun | undefined) => replayCounts(stats, minFailedBootstraps)
  const previous: RouteHealthState = state ?? { route: 'graphql', runsSinceSwitch: 0 }
  const runKey = history.at(-1)?.runId ?? null
  if (runKey !== null && previous.lastDecision && previous.runKey === runKey) {
    return { ...previous.lastDecision, state: previous }
  }

  const runsSinceSwitch = (previous.runsSinceSwitch ?? 0) + 1
  // After a switch, only runs made since then count, so old failures cannot undo a recovery.
  const window = previous.switched ? Math.min(windowRuns, runsSinceSwitch) : windowRuns
  const recent = window > 0 ? history.slice(-window).map(counts) : []
  const attempts = recent.reduce((sum, run) => sum + run.attempts, 0)
  const ok = recent.reduce((sum, run) => sum + run.ok, 0)
  const successRate = attempts ? ok / attempts : null
  const tripped = recent.some((run) => run.circuitOpen)
  const bootstrapFailing = recent.some((run) => run.bootstrapFailing)
  const seen = new Set(
    history
      .slice(-windowRuns - 1, -1)
      .map(counts)
      .flatMap((run) => run.queryIds),
  )
  const newQueryIds = counts(history.at(-1)).queryIds.filter((id) => seen.size > 0 && !seen.has(id))
  const unhealthy =
    tripped ||
    bootstrapFailing ||
    (attempts >= minAttempts && successRate !== null && successRate < minSuccess)

  const decide = (
    route: DetailRoute,
    reason: RouteReason,
    alert: boolean,
    nextState: RouteHealthState,
    rate: number | null = successRate,
    count: number = attempts,
  ) => {
    const decision: RouteDecision = {
      route,
      reason,
      successRate: rate,
      attempts: count,
      newQueryIds,
      alert,
    }
    return { ...decision, state: { ...nextState, runKey, lastDecision: decision } }
  }
  const onPage = (
    fields: Partial<RouteHealthState> & { runsSinceSwitch: number },
  ): RouteHealthState => ({
    route: 'page',
    switched: true,
    ...fields,
  })

  if (previous.route === 'page') {
    if (previous.probing) {
      // Judge recovery on the probe runs alone, summed until they reach minProbeAttempts.
      const last = counts(history.at(-1))
      const probeRuns = (previous.probeRuns ?? 0) + 1
      const probeAttempts = (previous.probeAttempts ?? 0) + last.attempts
      const probeOk = (previous.probeOk ?? 0) + last.ok
      const probeRate = probeAttempts ? probeOk / probeAttempts : null
      const failuresAllowed = Math.floor(
        (1 - minSuccess) * Math.max(minProbeAttempts, probeAttempts),
      )
      // A failed probe waits a full probeEvery runs before the next one.
      if (last.circuitOpen || last.bootstrapFailing || probeAttempts - probeOk > failuresAllowed) {
        return decide(
          'page',
          'probe-failed',
          false,
          onPage({ runsSinceSwitch: 0 }),
          probeRate,
          probeAttempts,
        )
      }
      if (probeAttempts >= minProbeAttempts) {
        return decide(
          'graphql',
          'recovered',
          true,
          { route: 'graphql', runsSinceSwitch: 0, switched: true },
          probeRate,
          probeAttempts,
        )
      }
      if (probeRuns >= probeEvery) {
        return decide(
          'page',
          'probe-inconclusive',
          false,
          onPage({ runsSinceSwitch: 0 }),
          probeRate,
          probeAttempts,
        )
      }
      return decide(
        'graphql',
        'probe',
        false,
        onPage({ runsSinceSwitch, probing: true, probeRuns, probeAttempts, probeOk }),
        probeRate,
        probeAttempts,
      )
    }
    // After a switch, send every probeEvery-th run through the cheaper route to see if it recovered.
    if (runsSinceSwitch % probeEvery === 0) {
      return decide(
        'graphql',
        'probe',
        false,
        onPage({ runsSinceSwitch, probing: true, probeRuns: 0, probeAttempts: 0, probeOk: 0 }),
      )
    }
    return decide('page', 'still-unhealthy', false, onPage({ runsSinceSwitch }))
  }
  if (unhealthy) {
    const reason: RouteReason = tripped
      ? 'circuit-open'
      : bootstrapFailing
        ? 'bootstrap-failing'
        : 'low-success'
    return decide('page', reason, true, onPage({ runsSinceSwitch: 0 }))
  }
  return decide(
    'graphql',
    attempts >= minAttempts ? 'healthy' : 'insufficient-data',
    newQueryIds.length > 0,
    {
      route: 'graphql',
      runsSinceSwitch,
      ...(previous.switched ? { switched: true } : {}),
    },
  )
}
