import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type DetailRouteRun,
  type RouteHealthState,
  recommendDetailRoute,
} from '../src/domain/route-health'

// Ported from fb-scrap-engine test/route-health.test.js (f177a44). Two of its tests exercise the
// actor's own internals (the in-run replay breaker and v3 input normalisation) and stay there.

let runCounter = 0
const run = (detailRequests: number, detailOk: number, extra: Partial<DetailRouteRun> = {}) => {
  runCounter += 1
  return {
    route: 'graphql' as const,
    detailRequests,
    detailOk,
    queryIds: ['q1'],
    runId: `run${runCounter}`,
    ...extra,
  }
}
const pageRun = (): DetailRouteRun => {
  runCounter += 1
  return { route: 'page', runId: `run${runCounter}` }
}
const probing = (): RouteHealthState => ({
  route: 'page',
  runsSinceSwitch: 10,
  switched: true,
  probing: true,
  probeRuns: 0,
  probeAttempts: 0,
  probeOk: 0,
})

// Replays the app's loop: one call before each run, then the run's summary joins the history.
function simulate(summaries: DetailRouteRun[], state: RouteHealthState | null = null) {
  const history: DetailRouteRun[] = []
  const decisions: ReturnType<typeof recommendDetailRoute>[] = []
  let current = state
  for (const summary of summaries) {
    history.push(summary)
    const decision = recommendDetailRoute([...history], current)
    decisions.push(decision)
    current = decision.state
  }
  return decisions
}

describe('recommendDetailRoute (ported from the actor)', () => {
  it('keeps the cheaper route while replays succeed and switches when they stop', () => {
    const healthy = recommendDetailRoute([run(100, 98), run(100, 97)])
    expect([healthy.route, healthy.reason, healthy.alert]).toEqual(['graphql', 'healthy', false])
    const low = recommendDetailRoute([run(100, 98), run(100, 60)])
    expect([low.route, low.reason, low.alert]).toEqual(['page', 'low-success', true])
    const tripped = recommendDetailRoute([run(30, 10, { circuitOpen: true })])
    expect([tripped.route, tripped.reason]).toEqual(['page', 'circuit-open'])
    expect(recommendDetailRoute([run(10, 5)]).reason).toBe('insufficient-data')
    // Session pages that never supply the template are a failure, not missing data.
    const broken = recommendDetailRoute([run(0, 0, { failedBootstraps: 3 })])
    expect([broken.route, broken.reason]).toEqual(['page', 'bootstrap-failing'])
  })

  it('probes the cheaper route after a switch and returns when it recovers', () => {
    // A failing run switches to page; the tenth run after that is a probe.
    const decisions = simulate([
      run(100, 40),
      ...Array.from({ length: 10 }, pageRun),
      run(100, 99),
      run(100, 98),
    ])
    expect(decisions.slice(0, 11).map(({ route }) => route)).toEqual([
      'page',
      ...Array(9).fill('page'),
      'graphql',
    ])
    // Recovery is judged on the probe run alone, although failed runs are still in the history.
    const recovered = decisions[11]
    expect([recovered?.route, recovered?.reason, recovered?.state.route]).toEqual([
      'graphql',
      'recovered',
      'graphql',
    ])
    // Old failures in the window do not switch it straight back.
    expect([decisions[12]?.route, decisions[12]?.reason]).toEqual(['graphql', 'healthy'])
  })

  it('returns the same decision for a repeated call and counts nothing twice', () => {
    const history = [run(12, 12)]
    const first = recommendDetailRoute(history, probing())
    expect([first.route, first.reason, first.attempts]).toEqual(['graphql', 'probe', 12])
    const again = recommendDetailRoute(history, first.state)
    expect([again.route, again.reason, again.attempts]).toEqual(['graphql', 'probe', 12])
    expect(again.state).toEqual(first.state)
    // A null state, as a database might store it, starts on the cheaper route.
    expect(recommendDetailRoute([], null).route).toBe('graphql')
  })

  it('returns to the page route after a failed probe and adds small probes together', () => {
    const failed = recommendDetailRoute([run(30, 20)], probing())
    expect([
      failed.route,
      failed.reason,
      failed.state.probing,
      failed.state.runsSinceSwitch,
    ]).toEqual(['page', 'probe-failed', undefined, 0])
    expect(recommendDetailRoute([run(20, 5, { circuitOpen: true })], probing()).reason).toBe(
      'probe-failed',
    )
    // A probe whose session pages never supplied the template has failed, not merely seen nothing.
    expect(recommendDetailRoute([run(0, 0, { failedBootstraps: 3 })], probing()).reason).toBe(
      'probe-failed',
    )
    const small = recommendDetailRoute([run(8, 8)], probing())
    expect([small.route, small.reason, small.state.probeAttempts]).toEqual(['graphql', 'probe', 8])
    const done = recommendDetailRoute([run(8, 8), run(12, 12)], small.state)
    expect([done.route, done.reason, done.attempts]).toEqual(['graphql', 'recovered', 20])
  })

  it('ends a probe that never gathers enough replays after probeEvery runs', () => {
    const decisions = simulate(
      Array.from({ length: 10 }, () => run(0, 0)),
      probing(),
    )
    expect(decisions.slice(0, 9).map(({ reason }) => reason)).toEqual(Array(9).fill('probe'))
    const last = decisions[9]
    expect([last?.route, last?.reason, last?.state.runsSinceSwitch]).toEqual([
      'page',
      'probe-inconclusive',
      0,
    ])
  })

  it('flags a new Facebook operation ID so the app can watch for a Facebook change', () => {
    const decision = recommendDetailRoute([run(100, 99), run(100, 99, { queryIds: ['q2'] })])
    expect(decision.newQueryIds).toEqual(['q2'])
    expect(decision.alert).toBe(true)
  })

  it('does not switch a healthy region for one templateless page (a sold or removed listing)', () => {
    const oneSold = run(0, 0, { bootstraps: 2, failedBootstraps: 1 })
    expect(recommendDetailRoute([oneSold]).route).toBe('graphql')
    const allFailed = run(0, 0, { bootstraps: 3, failedBootstraps: 3 })
    expect([
      recommendDetailRoute([allFailed]).route,
      recommendDetailRoute([allFailed]).reason,
    ]).toEqual(['page', 'bootstrap-failing'])
  })

  it('never deduplicates entries without a runId, so a trimmed history cannot freeze decisions', () => {
    const untagged = (requests: number, ok: number, extra: Partial<DetailRouteRun> = {}) => ({
      route: 'graphql' as const,
      detailRequests: requests,
      detailOk: ok,
      queryIds: ['q1'],
      ...extra,
    })
    const history = Array.from({ length: 11 }, () => untagged(100, 99))
    const state = recommendDetailRoute(history, null).state
    // The app keeps only the last 11 entries; the newest run tripped the breaker.
    const trimmed = [...history.slice(1), untagged(100, 20, { circuitOpen: true })]
    const decision = recommendDetailRoute(trimmed, state)
    expect([decision.route, decision.reason]).toEqual(['page', 'circuit-open'])
  })
})

describe('recommendDetailRoute (Nabvy)', () => {
  it('keeps the recorded run (19 of 19 replays) on graphql with too few attempts to judge', () => {
    const summary = JSON.parse(
      readFileSync(
        new URL(
          '../../../fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { detailRoute: DetailRouteRun }
    const decision = recommendDetailRoute([{ ...summary.detailRoute, runId: 'VkryjpwS6U2GBDh3k' }])
    expect([decision.route, decision.reason, decision.attempts, decision.successRate]).toEqual([
      'graphql',
      'insufficient-data',
      19,
      1,
    ])
    expect(decision.alert).toBe(false)
  })

  it('counts listings with no description as failed replays (behaviour pinned; see docs/questions.md)', () => {
    // The actor's 1.0.82 live check: 50 replays, 3 of them failed as description-missing
    // (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237,241-243). The ledger gives no detailOk; 47 is
    // computed as 50 - 3.
    // Unchanged from the actor, one such run moves the region to the dearer page route with an alert.
    const decision = recommendDetailRoute([run(50, 47)])
    expect([decision.route, decision.reason, decision.alert]).toEqual(['page', 'low-success', true])
  })

  it('never calls no replays low success, even with minAttempts 0 (Nabvy divergence, pinned)', () => {
    // fb-scrap-engine/app/route-health.js:54 evaluates `null < minSuccess` as true here and
    // returns page / low-success with an alert. Nabvy stays on graphql: see route-health.ts.
    for (const history of [[], [pageRun()], [run(0, 0)]]) {
      const decision = recommendDetailRoute(history, null, { minAttempts: 0 })
      expect([decision.route, decision.reason, decision.successRate, decision.alert]).toEqual([
        'graphql',
        'healthy',
        null,
        false,
      ])
    }
    // With replays, minAttempts 0 behaves like the actor: low success still switches.
    expect(recommendDetailRoute([run(10, 5)], null, { minAttempts: 0 }).reason).toBe('low-success')
  })
})
