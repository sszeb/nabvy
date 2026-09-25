import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tick } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  type JobStep,
  listingIdsBySource,
  loadRun,
  runJob,
  type TestDatabase,
} from '../support/database'

// Stage "status": recorded rows (or synthetic rows built from them) stored as collected gateway
// jobs, ingested by listing-ingest and recorded by detail-evidence on the real migrations in
// PGlite. Their `card-changed` and `unresolved` events are applied as the handlers would, and
// ticks run at the case's times. Each case checks the statuses v_status publishes, the listings
// announced, and the rechecks handed to details-queue.

interface Step {
  job?: JobStep
  /** Runs one tick at this time. */
  tick?: string
}

interface Input {
  run: string
  steps: Step[]
}

interface Expected {
  counts: Record<string, number>
  listings: Record<string, { status: string; basis: string; missedSweeps: number }>
  /** Listing IDs announced as `status-changed`, summed over the case. */
  announced: number
  /** details-queue items by source listing ID (priority and reason), exactly. */
  queued: Record<string, { priority: string; reason: string }>
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES)
  .filter((id) => id.startsWith('status-'))
  .sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('status', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as Input
    const expected = read(new URL(`${id}/expected.json`, CASES)) as Expected
    const recorded = loadRun(input.run)
    let announced = 0

    for (const step of input.steps) {
      if (step.job) announced += await runJob(t, recorded, step.job)
      if (step.tick) {
        const report = await tick(t.db, { now: new Date(step.tick) })
        announced += report.changed.length
      }
    }

    const bySource = await listingIdsBySource(t)
    const sourceOf = new Map([...bySource].map(([s, l]) => [l, s]))
    const rows = await t.asPipeline(
      'select listing_id, status, basis, missed_sweeps from listing_lifecycle.v_status',
    )
    const counts: Record<string, number> = {}
    for (const row of rows) counts[row.status as string] = (counts[row.status as string] ?? 0) + 1
    expect(counts).toEqual(expected.counts)
    for (const [sourceId, want] of Object.entries(expected.listings)) {
      const row = rows.find((r) => sourceOf.get(r.listing_id as string) === sourceId)
      expect(
        { status: row?.status, basis: row?.basis, missedSweeps: row?.missed_sweeps },
        sourceId,
      ).toEqual(want)
    }
    expect(announced).toBe(expected.announced)
    const queue = await t.sql(
      `select source_listing_id, priority, reason from details_queue.items
       where requested_by = 'listing-lifecycle' order by source_listing_id`,
    )
    expect(
      Object.fromEntries(
        queue.map((q) => [q.source_listing_id, { priority: q.priority, reason: q.reason }]),
      ),
    ).toEqual(expected.queued)
  })
})
