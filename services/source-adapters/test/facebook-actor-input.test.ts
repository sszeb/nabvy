import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  catchUpCheck,
  detailBatch,
  FacebookActorInput,
  fullSweep,
  GATEWAY_MAX_REQUESTS,
  MAX_DETAIL_BATCH,
  newestFirstCheck,
  PINNED_ACTOR_BUILD,
  parseFacebookActorRun,
  requestBudget,
  TIMEOUT_MARGIN_SECONDS,
} from '../src/domain/facebook-actor-input'

// Tests Nabvy's own rules for what it sends the actor. None of these claim the actor itself
// refuses an input; see the comments in src/domain/facebook-actor-input.ts for each rule's kind.

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
) as { actorInput: Record<string, unknown>; runOptions: { memory: 1024; timeout: number } }

const valid = recorded.actorInput
const detailOnly = ['searchTerms', 'cityId', 'sort']
const rejects = (patch: Record<string, unknown>, remove: string[] = []) => {
  const input: Record<string, unknown> = { ...valid, ...patch }
  for (const key of remove) delete input[key]
  return !FacebookActorInput.safeParse(input).success
}

describe('FacebookActorInput', () => {
  it('accepts the input of the recorded run with its run options', () => {
    expect(FacebookActorInput.safeParse(valid).success).toBe(true)
    expect(() =>
      parseFacebookActorRun({
        input: FacebookActorInput.parse(valid),
        runOptions: { build: PINNED_ACTOR_BUILD, ...recorded.runOptions },
      }),
    ).not.toThrow()
  })

  it('refuses what the schema does not allow', () => {
    expect(rejects({ minPrice: 50 })).toBe(true) // not a schema property
    expect(rejects({ daysSinceListed: 1 })).toBe(true)
    expect(rejects({ inputVersion: 2 })).toBe(true)
    expect(rejects({ searchTerms: Array.from({ length: 21 }, (_, i) => `term ${i}`) })).toBe(true)
    expect(rejects({ cityId: 115935195086622 })).toBe(true) // a number, not a string
    expect(rejects({ cityId: '1159x5' })).toBe(true)
    expect(rejects({ radiusKm: 0 })).toBe(true)
    expect(rejects({ radiusKm: 12.5 })).toBe(true)
    expect(rejects({ sort: 'price' })).toBe(true)
    expect(rejects({ detailRoute: 'browser' })).toBe(true)
    expect(rejects({ maxPagesPerSearch: 101 })).toBe(true)
    expect(rejects({ maxListings: 5001 })).toBe(true)
    expect(rejects({ maxRunSeconds: 5 })).toBe(true)
    expect(rejects({ detailConcurrency: 9 })).toBe(true)
    expect(rejects({ maxRequests: '60' })).toBe(true) // integers are JSON numbers
    expect(rejects({ listingIds: ['12a'] }, detailOnly)).toBe(true)
  })

  it('accepts any digit string as a city or listing ID', () => {
    expect(rejects({ cityId: '1' })).toBe(false)
    expect(rejects({ listingIds: ['1'] }, detailOnly)).toBe(false)
    expect(rejects({ listingIds: ['28242423458759790'] }, detailOnly)).toBe(false)
  })

  it('adds the gateway rules', () => {
    expect(rejects({ startUrls: ['https://www.facebook.com/marketplace/'] })).toBe(true)
    expect(rejects({ browserFallback: true })).toBe(true)
    expect(rejects({ useDetailCache: true })).toBe(true)
    expect(rejects({ maxRequests: GATEWAY_MAX_REQUESTS + 1 })).toBe(true)
    expect(rejects({}, ['maxRequests'])).toBe(true)
    expect(rejects({}, ['maxRunSeconds'])).toBe(true)
    expect(
      rejects({ proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } }),
    ).toBe(true)
    expect(
      rejects({
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ['DATACENTER'],
          apifyProxyCountry: 'GB',
        },
      }),
    ).toBe(true)
    expect(rejects({ listingIds: ['123'] })).toBe(true) // searches and a detail batch in one run
  })

  it("adds Nabvy's own rules", () => {
    expect(rejects({ sourceDiagnostics: false })).toBe(true)
    expect(rejects({}, ['maxListings'])).toBe(true)
    expect(rejects({ searchTerms: ['   '] })).toBe(true)
    expect(rejects({ searchTerms: ['x'.repeat(81)] })).toBe(true)
    expect(rejects({}, ['cityId'])).toBe(true)
    expect(rejects({ radiusKm: 30, listingIds: ['1'] }, detailOnly)).toBe(true)
    expect(rejects({ cityId: CHICHESTER, listingIds: ['1'] }, ['searchTerms', 'sort'])).toBe(true)
    expect(rejects({}, detailOnly)).toBe(true) // no source at all
    expect(rejects({ includeDetails: false, maxDetails: 5 })).toBe(true)
    expect(rejects({ searchTerms: ['Gaming PC', 'gaming  pc'] })).toBe(true)
    expect(rejects({ listingIds: ['1', '1'] }, detailOnly)).toBe(true)
  })

  it(`requires the timeout to exceed maxRunSeconds by ${TIMEOUT_MARGIN_SECONDS} s`, () => {
    const input = FacebookActorInput.parse(valid) // maxRunSeconds 240
    const withTimeout = (timeout: number) => () =>
      parseFacebookActorRun({
        input,
        runOptions: { build: PINNED_ACTOR_BUILD, memory: 1024, timeout },
      })
    expect(withTimeout(240)).toThrow(/timeout/)
    expect(withTimeout(299)).toThrow(/timeout/)
    expect(withTimeout(300)).not.toThrow()
    expect(() =>
      parseFacebookActorRun({
        input,
        runOptions: { build: PINNED_ACTOR_BUILD, memory: 3000 as 1024, timeout: 300 },
      }),
    ).toThrow()
  })
})

describe('requestBudget', () => {
  it('gives each search a bootstrap, its pages and one spare', () => {
    expect(
      requestBudget({ searches: 1, pagesPerSearch: 1, details: 0, detailRoute: 'graphql' }),
    ).toBe(3)
    expect(
      requestBudget({ searches: 3, pagesPerSearch: 60, details: 0, detailRoute: 'page' }),
    ).toBe(186)
  })

  it('gives each detail 2 requests on graphql or 1 on page, plus 10%, rounded up', () => {
    expect(
      requestBudget({ searches: 0, pagesPerSearch: 0, details: 200, detailRoute: 'graphql' }),
    ).toBe(440)
    expect(
      requestBudget({ searches: 0, pagesPerSearch: 0, details: 200, detailRoute: 'page' }),
    ).toBe(220)
    expect(
      requestBudget({ searches: 0, pagesPerSearch: 0, details: 1, detailRoute: 'graphql' }),
    ).toBe(3)
  })

  it('covers what the recorded run used', () => {
    // 1 search of 1 page and 20 graphql details used 22 requests (run-summary.json).
    expect(
      requestBudget({ searches: 1, pagesPerSearch: 1, details: 20, detailRoute: 'graphql' }),
    ).toBeGreaterThanOrEqual(22)
  })
})

describe('presets', () => {
  const plan = { cityId: CHICHESTER, terms: ['gaming pc', 'rtx 3080', 'graphics card'] }
  const all = [
    newestFirstCheck(plan),
    catchUpCheck(plan),
    fullSweep(plan),
    detailBatch(ids(MAX_DETAIL_BATCH), 'graphql'),
    detailBatch(ids(10), 'page'),
  ]

  it('builds a newest-first check of page 1', () => {
    const { input } = newestFirstCheck(plan)
    expect(input).toMatchObject({
      sort: 'newest',
      maxPagesPerSearch: 1,
      includeDetails: false,
      maxListings: 75,
      maxRequests: 9,
    })
  })

  it('builds a catch-up check in explicit default order over pages 1–4', () => {
    const { input } = catchUpCheck(plan)
    expect(input).toMatchObject({ sort: 'default', maxPagesPerSearch: 4, maxRequests: 18 })
  })

  it('builds a full sweep of up to three terms and refuses more', () => {
    const { input } = fullSweep(plan)
    expect(input).toMatchObject({ maxPagesPerSearch: 60, maxListings: 4500, maxRequests: 186 })
    expect(() => fullSweep({ ...plan, terms: [...plan.terms, 'rtx 4090'] })).toThrow(/maxListings/)
  })

  it('cleans and deduplicates terms', () => {
    const { input } = newestFirstCheck({
      cityId: CHICHESTER,
      terms: ['  Gaming   PC ', 'gaming pc'],
    })
    expect(input.searchTerms).toEqual(['Gaming PC'])
    expect(input.maxRequests).toBe(3)
  })

  it('caps detail batches at 200 IDs', () => {
    const { input } = detailBatch(ids(200), 'graphql')
    expect(input).toMatchObject({ maxListings: 200, maxDetails: 220, maxRequests: 440 })
    expect(detailBatch([...ids(200), ...ids(200)], 'graphql').input.listingIds).toHaveLength(200)
    expect(() => detailBatch(ids(201), 'graphql')).toThrow(/at most 200/)
    expect(() => detailBatch(ids(201), 'page')).toThrow(/at most 200/)
  })

  it('keeps every preset within the gateway and the timeout margin', () => {
    for (const { input, runOptions } of all) {
      expect(input.maxRequests).toBeLessThanOrEqual(GATEWAY_MAX_REQUESTS)
      expect(input.maxRequests).toBeGreaterThanOrEqual(
        requestBudget({
          searches: input.searchTerms?.length ?? 0,
          pagesPerSearch: input.maxPagesPerSearch ?? 0,
          details: input.listingIds?.length ?? 0,
          detailRoute: input.detailRoute ?? 'graphql',
        }),
      )
      expect(runOptions.timeout).toBeGreaterThanOrEqual(
        input.maxRunSeconds + TIMEOUT_MARGIN_SECONDS,
      )
      expect(runOptions.timeout).toBeLessThanOrEqual(1800)
    }
  })

  it('always pins the build and sends the fixed safe settings', () => {
    for (const { input, runOptions } of all) {
      expect(runOptions).toMatchObject({ build: PINNED_ACTOR_BUILD, memory: 1024 })
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
      expect(typeof input.maxListings).toBe('number')
    }
  })
})
