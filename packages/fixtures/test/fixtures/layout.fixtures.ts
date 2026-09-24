import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fixturePath,
  LISTING_FILES,
  listingExpectedSchema,
  listListingFixtures,
  listRecordedRuns,
  readFixtureJson,
} from '../../src/index.ts'

// Stage "layout": the fixtures/ tree follows docs/fixtures.md. One case per listing fixture and per
// recorded run, so a malformed fixture shows up by name in the report.

const TOP_LEVEL = ['README.md', 'contracts', 'listings', 'scans', 'series']
const RUN_FILES = ['README.md', 'dataset.json', 'input.json', 'run-summary.json', 'run.json']
const isObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const listings = listListingFixtures()
const sources = readdirSync(fixturePath('listings'))

it('has only the documented top-level folders', () => {
  expect(readdirSync(fixturePath()).filter((name) => !TOP_LEVEL.includes(name))).toEqual([])
})

it('has at least one listing fixture', () => {
  expect(listings.length).toBeGreaterThan(0)
})

describe.each(listings.map((f) => [`${f.source}/${f.id}`, f] as const))('listing %s', (_, f) => {
  it('holds the required files and nothing unknown', () => {
    const entries = readdirSync(f.dir)
    for (const file of LISTING_FILES.required) expect(entries).toContain(file)
    const known: string[] = [...LISTING_FILES.required, ...LISTING_FILES.optional]
    expect(entries.filter((entry) => !known.includes(entry))).toEqual([])
  })

  it('has JSON objects in stub.json, detail.json and raw.json', () => {
    for (const file of ['stub.json', 'detail.json', 'raw.json']) {
      if (existsSync(join(f.dir, file))) {
        expect(isObject(readFixtureJson('listings', f.source, f.id, file))).toBe(true)
      }
    }
  })

  it('has a valid expected.json', () => {
    const parsed = listingExpectedSchema.safeParse(
      readFixtureJson('listings', f.source, f.id, 'expected.json'),
    )
    expect(parsed.error?.issues ?? []).toEqual([])
  })
})

const runs = sources.flatMap((source) => listRecordedRuns(source).map((run) => [source, run]))

describe.each(runs)('recorded run %s/%s', (source, run) => {
  it('holds a whole run and nothing else', () => {
    expect(readdirSync(fixturePath('listings', source, 'runs', run)).sort()).toEqual(RUN_FILES)
    expect(run).toMatch(/^\d{4}-\d{2}-\d{2}-[A-Za-z0-9]+$/)
  })
})

it('keeps series and scans in their documented shape', () => {
  for (const entry of readdirSync(fixturePath('series'))) {
    if (entry === 'README.md') continue
    expect(entry).toMatch(/\.json$/)
    expect(isObject(readFixtureJson('series', entry))).toBe(true)
  }
  for (const entry of readdirSync(fixturePath('scans'))) {
    if (entry === 'README.md') continue
    expect(statSync(fixturePath('scans', entry)).isDirectory()).toBe(true)
    expect(existsSync(fixturePath('scans', entry, 'photo.jpg'))).toBe(true)
    expect(existsSync(fixturePath('scans', entry, 'expected.json'))).toBe(true)
  }
})
