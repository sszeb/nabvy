import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Checks the recorded actor run against the task 1.0 mapping in README.md: every field the mapping
// relies on is present with the expected type, the fixture carries no seller identity, and the
// recorded input obeys the actor's v3 rules and the gateway's limits.

type Row = Record<string, unknown>

const RUNS = new URL('../../../fixtures/listings/facebook/runs/', import.meta.url)
const readJson = (run: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${run}/${file}`, RUNS), 'utf8'))
const runs = readdirSync(RUNS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const V3_INPUT_KEYS = [
  'inputVersion',
  'searchTerms',
  'cityId',
  'radiusKm',
  'sort',
  'listingIds',
  'startUrls',
  'includeDetails',
  'detailRoute',
  'browserFallback',
  'detailSessionSize',
  'maxListings',
  'maxPagesPerSearch',
  'maxDetails',
  'maxRequests',
  'maxRunSeconds',
  'detailConcurrency',
  'useDetailCache',
  'detailCacheTtlHours',
  'detailCacheRetryMinutes',
  'sourceDiagnostics',
  'responseInventory',
  'proxyConfiguration',
]

const isObject = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nullableBoolean = (value: unknown) => value === null || typeof value === 'boolean'

it('has at least one recorded run', () => {
  expect(runs.length).toBeGreaterThan(0)
})

describe.each(runs)('recorded run %s', (run) => {
  const dataset = readJson(run, 'dataset.json') as Row[]
  const summary = readJson(run, 'run-summary.json') as Row
  const { actorInput, runOptions } = readJson(run, 'input.json') as {
    actorInput: Row
    runOptions: { memory: number; timeout: number }
  }
  const listings = dataset.filter((row) => row.recordType === 'listing')
  const outcomes = dataset.filter((row) => row.recordType === 'sourceOutcome')

  it('holds only listing and sourceOutcome rows', () => {
    expect(listings.length + outcomes.length).toBe(dataset.length)
    expect(listings.length).toBeGreaterThan(0)
    expect(outcomes.length).toBeGreaterThan(0)
  })

  it('gives every listing the fields the stub mapping needs', () => {
    for (const row of listings) {
      expect(row.platform).toBe('facebook')
      expect(row.listingId).toMatch(/^\d{1,30}$/)
      expect(row.listingUrl).toBe(`https://www.facebook.com/marketplace/item/${row.listingId}/`)
      expect(row.url).toBe(row.listingUrl)
      expect(typeof row.title).toBe('string')
      expect(typeof row.location).toBe('string')
      expect(Number.isInteger(row.listedAt)).toBe(true)
      expect(row.listedAt).toBeGreaterThan(1_000_000_000)
      expect(row.listedAt).toBeLessThan(10_000_000_000)
      expect(typeof row.imageUrl).toBe('string')
      expect(Array.isArray(row.deliveryTypes)).toBe(true)
      expect(['string', 'number']).toContain(typeof row.categoryId)
      expect(Array.isArray(row.foundBySearchTerms)).toBe(true)
      expect(isObject(row.sourceBindings)).toBe(true)

      const money = row.money as Row
      expect(['fixed', 'free', 'unknown', 'ambiguous']).toContain(money.kind)
      if (money.kind === 'fixed') expect(Number.isInteger(money.amountMinor)).toBe(true)
      expect(row.currency).toBe(money.currency)

      const availability = row.availability as Row
      expect(Object.keys(availability).sort()).toEqual(['hidden', 'live', 'pending', 'sold'])
      expect(Object.values(availability).every(nullableBoolean)).toBe(true)
    }
  })

  it('gives detailed listings the fields the detail mapping needs', () => {
    for (const row of listings.filter((r) => r.detailOutcome === 'collected')) {
      expect(['full_verified', 'partial', 'missing']).toContain(row.descriptionStatus)
      expect(row.descriptionComplete).toBe(row.descriptionStatus === 'full_verified')
      if (row.descriptionStatus !== 'missing') expect(typeof row.description).toBe('string')
      expect(row.attributes === null || Array.isArray(row.attributes)).toBe(true)
      expect(row.photoUrls === null || Array.isArray(row.photoUrls)).toBe(true)

      const coordinates = row.locationCoordinates as Row
      expect(typeof coordinates.latitude).toBe('number')
      expect(typeof coordinates.longitude).toBe('number')
      expect(coordinates.precision).toBe('coarse')
    }
  })

  it('carries no seller identity, Facebook media links or contact details', () => {
    const text = JSON.stringify(dataset)
    expect(text).not.toMatch(/fbcdn\.net|fbsbx\.com|cdninstagram\.com/i)
    expect(text).not.toMatch(/facebook\.com\/(?!marketplace\/)/i)
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(text).not.toMatch(/(\+44\s?|\b0)7\d{3}\s?\d{3}\s?\d{3}\b/)

    const sellers: Row[] = []
    const collect = (value: unknown, key?: string): void => {
      if (Array.isArray(value)) {
        for (const item of value) collect(item, key)
      } else if (isObject(value)) {
        if (key === 'seller' || key === 'marketplace_listing_seller') sellers.push(value)
        for (const [k, v] of Object.entries(value)) collect(v, k)
      }
    }
    collect(dataset)
    for (const seller of sellers) {
      expect(seller.id).toMatch(/^(9\d+|redacted-token-\d+)$/)
      if ('name' in seller) expect(seller.name).toBe('[redacted]')
      if (isObject(seller.profile_picture)) {
        const picture = seller.profile_picture
        expect(picture.uri ?? picture.url).toMatch(/^https:\/\/redacted\.invalid\//)
      }
    }
  })

  it('reports source outcomes and a summary that agree with the rows', () => {
    for (const row of outcomes) {
      expect([
        'complete',
        'verified-empty',
        'truncated',
        'partial',
        'blocked',
        'extraction-error',
      ]).toContain(row.sourceStatus)
      expect(['verified', 'unverified']).toContain(row.sourceBinding)
    }
    expect(summary.inputVersion).toBe(3)
    expect(summary.listingsFound).toBe(listings.length)
    expect(summary.candidateIds).toEqual(listings.map((row) => row.listingId))
    expect(typeof summary.requests).toBe('number')
    const statuses = summary.descriptionStatuses as Record<string, number>
    expect(statuses.full_verified).toBe(
      listings.filter((row) => row.descriptionStatus === 'full_verified').length,
    )
  })

  it('was recorded with an input the actor and the gateway both accept', () => {
    expect(Object.keys(actorInput).every((key) => V3_INPUT_KEYS.includes(key))).toBe(true)
    expect(actorInput.inputVersion).toBe(3)
    expect(actorInput.cityId).toMatch(/^\d{5,30}$/)
    expect(actorInput.browserFallback).toBe(false)
    expect(actorInput.useDetailCache).toBe(false)
    expect(actorInput).not.toHaveProperty('startUrls')
    expect(actorInput.maxRequests).toBeGreaterThanOrEqual(1)
    expect(actorInput.maxRequests).toBeLessThanOrEqual(1000)
    expect(actorInput.maxRunSeconds).toBeLessThanOrEqual(runOptions.timeout)
    expect([512, 1024, 2048]).toContain(runOptions.memory)
    expect(actorInput.proxyConfiguration).toEqual({
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
      apifyProxyCountry: 'GB',
    })
  })
})
