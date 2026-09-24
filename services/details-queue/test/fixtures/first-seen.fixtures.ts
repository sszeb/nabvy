import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { closeBatch, handleFirstSeen, submitNext } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  fakePorts,
  loadDataset,
  row,
  type TestDatabase,
} from '../support/database'

// Stage `first-seen`: `listing-ingest.first-seen` batches, replayed in any order, go to the queue
// once per listing and are sent to Apify once. Each case is a list of steps: a first-seen batch,
// a scheduler tick, or closing every open batch with full descriptions. Expected: each batch's
// enqueue result, every run submitted (its IDs), and each item's final status.

const Listing = z.strictObject({
  id: z.uuid(),
  sourceListingId: z.string(),
  jobId: z.int().positive(),
  kind: z.enum(['search', 'detail']),
})
const Step = z.union([
  z.strictObject({ firstSeen: z.union([z.literal('all'), z.array(z.uuid()).min(1)]) }),
  z.strictObject({ submit: z.literal(true) }),
  z.strictObject({ closeAll: z.literal('full_verified') }),
])
const Input = z.union([
  z.strictObject({
    synthetic: z.literal(true),
    source: z.string().min(1),
    jobTags: z.record(z.string(), z.record(z.string(), z.string())),
    listings: z.array(Listing).min(1),
    steps: z.array(Step).min(1),
  }),
  z.strictObject({
    run: z.string().min(1),
    source: z.string().min(1),
    jobTags: z.record(z.string(), z.string()),
    steps: z.array(Step).min(1),
  }),
])
const Expected = z.strictObject({
  results: z.array(z.strictObject({ queued: z.int(), alreadyQueued: z.int(), skipped: z.int() })),
  submitted: z.array(z.array(z.string())),
  items: z.record(z.string(), z.string()),
})

const casesDir = new URL('./cases/first-seen/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

describe('first-seen', () => {
  let t: TestDatabase
  beforeEach(async () => {
    t = await createTestDatabase()
    await t.switches(ALL_ON)
  })
  afterEach(() => t.close())

  it.each(cases)('$id', async ({ input, expected }) => {
    const ports = fakePorts()
    let listingIds: string[]
    if ('run' in input) {
      // The recorded run as a collected search job (job 1000, clear of the fake gateway's IDs).
      const dataset = loadDataset(input.run)
      await t.rows(1000, dataset)
      const listings = dataset.filter((r) => r.recordType === 'listing')
      listingIds = listings.map(
        (_, i) => `01930000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
      )
      for (const [i, r] of listings.entries()) {
        await t.listing({
          id: listingIds[i] as string,
          sourceListingId: r.listingId as string,
          jobId: 1000,
          kind: 'search',
          tags: input.jobTags,
        })
      }
    } else {
      for (const l of input.listings) {
        await t.listing({ ...l, tags: input.jobTags[String(l.jobId)] })
      }
      listingIds = input.listings.map((l) => l.id)
    }

    const results: unknown[] = []
    for (const step of input.steps) {
      if ('firstSeen' in step) {
        const batch = step.firstSeen === 'all' ? listingIds : step.firstSeen
        const result = await t.db.transaction((q) => handleFirstSeen(q, batch))
        expect(result.ok).toBe(true)
        if (result.ok) results.push(result.value)
      } else if ('submit' in step) {
        await t.db.transaction((q) => submitNext(q, { ports }))
      } else {
        const open = await t.sql(
          'select job_id, source_listing_ids from details_queue.batches where closed_at is null',
        )
        for (const b of open) {
          await t.rows(
            Number(b.job_id),
            (b.source_listing_ids as string[]).map((id) => row(id)),
          )
          await t.db.transaction((q) => closeBatch(q, Number(b.job_id)))
        }
      }
    }

    expect(results).toEqual(expected.results)
    expect(ports.submitted.map((s) => s.input.listingIds)).toEqual(expected.submitted)
    const items = await t.sql('select source_listing_id, status from details_queue.items')
    expect(Object.fromEntries(items.map((r) => [r.source_listing_id, r.status]))).toEqual(
      expected.items,
    )
  })
})
