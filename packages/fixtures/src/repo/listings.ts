import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Reads the shared `fixtures/` tree (layout in fixtures/README.md). Suites use these helpers
// instead of relative paths, so a suite file can move without breaking.

export const FIXTURES_DIR = resolve(import.meta.dirname, '../../../../fixtures')

/** Folder names under `listings/<source>/` that are not single-listing fixtures. */
export const RESERVED_LISTING_DIRS: ReadonlySet<string> = new Set(['runs'])

export const LISTING_FILES = {
  required: ['stub.json', 'detail.json', 'expected.json'],
  optional: ['raw.json', 'photos'],
} as const

export interface ListingFixture {
  source: string
  id: string
  dir: string
}

const subdirs = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : []

export const fixturePath = (...parts: string[]): string => join(FIXTURES_DIR, ...parts)

export const readFixtureJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(fixturePath(...parts), 'utf8'))

/** Every `listings/<source>/<id>/` folder, optionally for one source. */
export const listListingFixtures = (source?: string): ListingFixture[] =>
  (source ? [source] : subdirs(fixturePath('listings'))).flatMap((src) =>
    subdirs(fixturePath('listings', src))
      .filter((id) => !RESERVED_LISTING_DIRS.has(id))
      .map((id) => ({ source: src, id, dir: fixturePath('listings', src, id) })),
  )

/** Every recorded provider run under `listings/<source>/runs/`. */
export const listRecordedRuns = (source: string): string[] =>
  subdirs(fixturePath('listings', source, 'runs'))
