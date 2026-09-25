import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watch } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  type JobStep,
  loadRun,
  runJob,
  type TestDatabase,
  watchedSince,
} from '../support/database'

// Stage "watch": recorded rows (or synthetic rows built from them, re-collected at a later time)
// stored as a collected gateway job and ingested by listing-ingest on the real migrations in
// PGlite. Each case watches one listing (optionally after some of its steps, with the watch's
// start pinned to a fixture time), replays the case's job steps through
// listing-ingest.card-changed and price-drop-watch's own applyEvent, and checks what was
// announced and what price_drop_watch.drops recorded. Prices come only from listing-ingest's own
// observed sightings; the seller's displayed "previous price" is never read as history (README.md,
// "Rules").

interface Input {
  run: string
  listingSourceId: string
  /** How many of `steps` run before the user watches (default 0: all run after). */
  stepsBeforeWatch?: number
  /** The watch's `created_at` (default: the first job's collection time, the recorded run's). */
  watchedAt?: string
  steps: JobStep[]
}

interface ExpectedDrop {
  fromMinor: number
  toMinor: number
  currency: string
}

interface Expected {
  announcedCount: number
  drops: ExpectedDrop[]
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES)
  .filter((id) => id.startsWith('watch-'))
  .sort()

const USER_ID = '00000000-0000-4000-8000-000000000001'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('watch', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as Input
    const expected = read(new URL(`${id}/expected.json`, CASES)) as Expected
    const recorded = loadRun(input.run)

    // A first job establishes the listing (T1) before it is watched, as a real watch always
    // starts after a listing already exists.
    await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
    const [located] = await t.asPipeline(
      'select id from listing_ingest.v_listings where source_listing_id = $1',
      [input.listingSourceId],
    )
    const listingId = located?.id as string
    const before = input.steps.slice(0, input.stepsBeforeWatch ?? 0)
    for (const step of before) await runJob(t, recorded, step)
    const watched = await t.asApp(USER_ID, (tx) => watch(tx, { userId: USER_ID, listingId }))
    if (!watched.ok) throw new Error(watched.error.message)
    await watchedSince(t, watched.value.id, input.watchedAt ?? (recorded.run.startedAt as string))

    let announced: string[] = []
    for (const step of input.steps.slice(before.length)) {
      announced = [...announced, ...(await runJob(t, recorded, step))]
    }

    expect(announced.length).toBe(expected.announcedCount)
    if (expected.announcedCount > 0) expect(announced).toEqual([watched.value.id])

    const drops = await t.asPipeline(
      'select from_minor, to_minor, currency from price_drop_watch.drops where watch_id = $1 order by observed_at',
      [watched.value.id],
    )
    expect(
      drops.map((d) => ({
        fromMinor: Number(d.from_minor),
        toMinor: Number(d.to_minor),
        currency: d.currency,
      })),
    ).toEqual(expected.drops)
  })
})
