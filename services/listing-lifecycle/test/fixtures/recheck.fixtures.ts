import { readdirSync, readFileSync } from 'node:fs'
import type { ListingLifecycleRecheckReason } from '@nabvy/contracts/modules/listing-lifecycle'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requestRecheck, tick } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  type JobStep,
  listingIdsBySource,
  loadRun,
  runJob,
  type TestDatabase,
} from '../support/database'

// Stage "recheck": listings from the recorded run, rechecks asked for by other modules through
// `requestRecheck`, and ticks at hours after the case starts (due times are the database's clock,
// so tick times are relative to it). Each case checks what every request and tick did and what
// details-queue received.

interface Step {
  job?: JobStep
  /** `requestRecheck` for these source listing IDs (or the first `first` recorded listings). */
  request?: {
    reason: Exclude<ListingLifecycleRecheckReason, 'not-seen'>
    ids?: string[]
    first?: number
    skip?: number
    /** Extra listing UUIDs listing-ingest never stored. */
    unknown?: string[]
  }
  /** Runs one tick this many hours after the case started. */
  tickAfterHours?: number
}

interface Input {
  run: string
  steps: Step[]
}

interface Expected {
  requests: { scheduled: number; alreadyScheduled: number; unknown: number }[]
  ticks: { queued: number; skipped: number; waiting: number }[]
  /** details-queue items this module asked for, by priority. */
  queuedByPriority: Record<string, number>
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES)
  .filter((id) => id.startsWith('recheck-'))
  .sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('recheck', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as Input
    const expected = read(new URL(`${id}/expected.json`, CASES)) as Expected
    const recorded = loadRun(input.run)
    const [clock] = await t.sql('select now() as now')
    const start = new Date(clock?.now as string).getTime()
    const order = recorded.dataset
      .filter((row) => row.recordType === 'listing')
      .map((row) => String(row.listingId))
    const requests: Expected['requests'] = []
    const ticks: Expected['ticks'] = []

    for (const step of input.steps) {
      if (step.job) await runJob(t, recorded, step.job)
      if (step.request) {
        const bySource = await listingIdsBySource(t)
        const skip = step.request.skip ?? 0
        const sourceIds =
          step.request.ids ?? order.slice(skip, skip + (step.request.first ?? order.length))
        const listingIds = [
          ...sourceIds.map((s) => bySource.get(s) as string),
          ...(step.request.unknown ?? []),
        ]
        requests.push(
          await requestRecheck(t.db, {
            listingIds,
            reason: step.request.reason,
            requestedBy: 'notifier',
          }),
        )
      }
      if (step.tickAfterHours !== undefined) {
        const report = await tick(t.db, {
          now: new Date(start + step.tickAfterHours * 3_600_000 + 1_000),
        })
        ticks.push({
          queued: report.rechecksQueued,
          skipped: report.rechecksSkipped,
          waiting: report.rechecksWaiting,
        })
      }
    }

    expect(requests).toEqual(expected.requests)
    expect(ticks).toEqual(expected.ticks)
    const queue = await t.sql(
      `select priority, count(*)::int as n from details_queue.items
       where requested_by = 'listing-lifecycle' group by priority`,
    )
    expect(Object.fromEntries(queue.map((q) => [q.priority, q.n]))).toEqual(
      expected.queuedByPriority,
    )
  })
})
