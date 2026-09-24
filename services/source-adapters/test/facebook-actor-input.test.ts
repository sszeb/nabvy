import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  actorDefaultMaxRequests,
  catchUpCheck,
  detailBatch,
  FacebookActorInput,
  fullSweep,
  GATEWAY_MAX_REQUESTS,
  newestFirstCheck,
  PINNED_ACTOR_BUILD,
  parseFacebookActorRun,
} from '../src/domain/facebook-actor-input'

const CHICHESTER = '115935195086622'
const ids = (n: number) => Array.from({ length: n }, (_, i) => String(1_000_000_000_000_000 + i))

const recorded = JSON.parse(
  readFileSync(
    new URL(
      '../../../fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/input.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { actorInput: Record<string, unknown>; runOptions: { memory: number; timeout: number } }

const valid = recorded.actorInput
const rejects = (patch: Record<string, unknown>, remove: string[] = []) => {
  const input: Record<string, unknown> = { ...valid, ...patch }
  for (const key of remove) delete input[key]
  return !FacebookActorInput.safeParse(input).success
}

describe('FacebookActorInput', () => {
  it('accepts the input of the recorded run', () => {
    expect(FacebookActorInput.safeParse(valid).success).toBe(true)
    expect(() =>
      parseFacebookActorRun({
        input: FacebookActorInput.parse(valid),
        runOptions: { build: PINNED_ACTOR_BUILD, memory: 1024, timeout: 300 },
      }),
    ).not.toThrow()
  })

  it('rejects what the actor itself rejects', () => {
    expect(rejects({ minPrice: 50 })).toBe(true) // unknown v3 field
    expect(rejects({ daysSinceListed: 1 })).toBe(true)
    expect(rejects({ inputVersion: 2 })).toBe(true)
    expect(rejects({ searchTerms: Array.from({ length: 21 }, (_, i) => `term ${i}`) })).toBe(true)
    expect(rejects({ searchTerms: ['   '] })).toBe(true)
    expect(rejects({ searchTerms: ['x'.repeat(81)] })).toBe(true)
    expect(rejects({ cityId: 115935195086622 })).toBe(true) // a number, not a string
    expect(rejects({ cityId: '1234' })).toBe(true)
    expect(rejects({}, ['cityId'])).toBe(true) // searchTerms require cityId
    expect(rejects({ radiusKm: 0 })).toBe(true)
    expect(rejects({ radiusKm: 12.5 })).toBe(true)
    expect(rejects({ sort: 'price' })).toBe(true)
    expect(rejects({ detailRoute: 'browser' })).toBe(true)
    expect(rejects({ includeDetails: false, maxDetails: 5 })).toBe(true)
    expect(rejects({ maxPagesPerSearch: 101 })).toBe(true)
    expect(rejects({ maxListings: 5001 })).toBe(true)
    expect(rejects({ maxRunSeconds: 5 })).toBe(true)
    expect(rejects({ detailConcurrency: 9 })).toBe(true)
    expect(rejects({ maxRequests: '60' })).toBe(true) // integers must be JSON integers
    expect(
      rejects({ listingIds: ['123'], sort: undefined }, ['searchTerms', 'cityId', 'sort']),
    ).toBe(false)
    expect(rejects({ radiusKm: 30 }, ['searchTerms', 'cityId', 'sort'])).toBe(true) // needs searchTerms
    expect(rejects({}, ['searchTerms', 'cityId', 'sort'])).toBe(true) // no source at all
  })

  it('adds the gateway rules and Nabvy rules on top', () => {
    expect(rejects({ startUrls: ['https://www.facebook.com/marketplace/'] })).toBe(true)
    expect(rejects({ browserFallback: true })).toBe(true)
    expect(rejects({ useDetailCache: true })).toBe(true)
    expect(rejects({ sourceDiagnostics: false })).toBe(true)
    expect(rejects({ maxRequests: GATEWAY_MAX_REQUESTS + 1 })).toBe(true)
    expect(rejects({}, ['maxRequests'])).toBe(true)
    expect(rejects({}, ['maxRunSeconds'])).toBe(true)
    expect(
      rejects({ proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } }),
    ).toBe(true)
    expect(rejects({ listingIds: ['123'] })).toBe(true) // searches and a detail batch in one run
    expect(rejects({ searchTerms: ['Gaming PC', 'gaming  pc'] })).toBe(true) // the same term twice
    expect(rejects({ listingIds: ['1', '1'] }, ['searchTerms', 'cityId', 'sort'])).toBe(true)
  })

  it('checks the run timeout against maxRunSeconds and the allowed memory sizes', () => {
    const input = FacebookActorInput.parse(valid)
    expect(() =>
      parseFacebookActorRun({
        input,
        runOptions: { build: PINNED_ACTOR_BUILD, memory: 1024, timeout: 200 },
      }),
    ).toThrow(/maxRunSeconds/)
    expect(() =>
      parseFacebookActorRun({
        input,
        runOptions: { build: PINNED_ACTOR_BUILD, memory: 3000 as 1024, timeout: 300 },
      }),
    ).toThrow()
  })
})

describe('actorDefaultMaxRequests', () => {
  it("matches the actor's own worked examples", () => {
    // Three newest-first terms, page 1, details off, fallback off.
    expect(
      actorDefaultMaxRequests({
        searchTerms: ['a', 'b', 'c'],
        maxPagesPerSearch: 1,
        includeDetails: false,
        browserFallback: false,
      }),
    ).toBe(12)
    // Two terms, 60 pages, maxListings 1,000, details on (the actor's test/gateway-input.test.js).
    expect(
      actorDefaultMaxRequests({
        searchTerms: ['a', 'b'],
        maxPagesPerSearch: 60,
        maxListings: 1000,
      }),
    ).toBe(1226)
    // 200 listing IDs on graphql, fallback off.
    expect(actorDefaultMaxRequests({ listingIds: ids(200), browserFallback: false })).toBe(950)
  })

  it('counts duplicate terms once, as the actor does', () => {
    expect(
      actorDefaultMaxRequests({
        searchTerms: ['Gaming PC', 'gaming  pc'],
        maxPagesPerSearch: 1,
        includeDetails: false,
        browserFallback: false,
      }),
    ).toBe(4)
  })
})

describe('presets', () => {
  const plan = { cityId: CHICHESTER, terms: ['gaming pc', 'rtx 3080', 'graphics card'] }

  it('builds a newest-first check within the gateway limits', () => {
    const { input, runOptions } = newestFirstCheck(plan)
    expect(input).toMatchObject({
      sort: 'newest',
      maxPagesPerSearch: 1,
      includeDetails: false,
      maxRequests: 12,
    })
    expect(runOptions).toEqual({ build: PINNED_ACTOR_BUILD, memory: 512, timeout: 240 })
  })

  it('builds a catch-up check in default order over pages 1–4', () => {
    const { input } = catchUpCheck(plan)
    expect(input.sort).toBeUndefined()
    expect(input).toMatchObject({ maxPagesPerSearch: 4, maxRequests: 21, maxRunSeconds: 300 })
  })

  it('builds a full sweep of up to three terms and refuses more', () => {
    const { input, runOptions } = fullSweep(plan)
    expect(input).toMatchObject({ maxPagesPerSearch: 60, maxListings: 4200, maxRequests: 189 })
    expect(runOptions.timeout).toBeGreaterThan(input.maxRunSeconds)
    expect(() => fullSweep({ ...plan, terms: [...plan.terms, 'rtx 4090'] })).toThrow(
      /at most 3 terms/,
    )
  })

  it('cleans and deduplicates terms like the actor', () => {
    const { input } = newestFirstCheck({
      cityId: CHICHESTER,
      terms: ['  Gaming   PC ', 'gaming pc'],
    })
    expect(input.searchTerms).toEqual(['Gaming PC'])
    expect(input.maxRequests).toBe(4)
  })

  it('sizes detail batches to the gateway cap', () => {
    const { input } = detailBatch(ids(200), 'graphql')
    expect(input).toMatchObject({ includeDetails: true, detailRoute: 'graphql', maxRequests: 950 })
    expect(detailBatch(ids(225), 'graphql').input.maxRequests).toBe(1000)
    expect(() => detailBatch(ids(226), 'graphql')).toThrow(/gateway allows 1000/)
    // The page route reserves one request per ID, so larger batches fit.
    expect(detailBatch(ids(450), 'page').input.maxRequests).toBe(1000)
  })

  it('always pins the build and sends the safe fixed settings', () => {
    for (const { input, runOptions } of [newestFirstCheck(plan), detailBatch(ids(10), 'page')]) {
      expect(runOptions.build).toBe(PINNED_ACTOR_BUILD)
      expect(input).toMatchObject({
        inputVersion: 3,
        browserFallback: false,
        useDetailCache: false,
        sourceDiagnostics: true,
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL'],
          apifyProxyCountry: 'GB',
        },
      })
      expect(runOptions.timeout).toBeGreaterThan(input.maxRunSeconds)
    }
  })
})
