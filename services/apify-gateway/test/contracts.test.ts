import { readFileSync } from 'node:fs'
import { parseEvent } from '@nabvy/contracts'
import {
  ApifyGatewayJob,
  ApifyGatewayRow,
  ApifyGatewayRunSummary,
  events,
} from '@nabvy/contracts/modules/apify-gateway'
import { vJobs } from '@nabvy/db/schema/apify-gateway'
import { createMemoryPublisher } from '@nabvy/transport'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJobs, watch } from '../src'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'
import { claim, loadRun, queueCollect, store } from './support/gateway'

// Events and view rows parse with @nabvy/contracts/modules/apify-gateway. The repository has no
// drizzle-zod, so v_jobs's columns are checked against ApifyGatewayJob's keys instead of derived
// (as cost-meter does for v_costs).

const recorded = loadRun('facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('contracts', () => {
  it('every recorded row and the RUN_SUMMARY parse, unknown fields kept', () => {
    for (const row of recorded.dataset) {
      expect(ApifyGatewayRow.parse(row)).toEqual(row)
    }
    expect(ApifyGatewayRunSummary.parse(recorded.runSummary)).toEqual(recorded.runSummary)
  })

  it('v_jobs has exactly the columns of ApifyGatewayJob', () => {
    const columns = Object.keys(getViewConfig(vJobs).selectedFields)
    expect(columns.sort()).toEqual(Object.keys(ApifyGatewayJob.shape).sort())
  })

  it('the events the watcher publishes and the v_jobs rows it reads parse', async () => {
    const jobId = await queueCollect(t, recorded.apifyRunId)
    await claim(t)
    await store(t, jobId, recorded, null)
    const publisher = createMemoryPublisher()
    await watch(t.db, { publisher, usdGbpRate: 0.75 })
    const [event] = publisher.published
    expect(parseEvent(events, event)).toMatchObject({
      type: 'apify-gateway.run-collected',
      payload: { jobId, apifyRunId: 'VkryjpwS6U2GBDh3k', kind: 'search' },
    })
    const [job] = await readJobs(t.db, [jobId])
    expect(job).toMatchObject({
      id: jobId,
      kind: 'collect',
      runKind: 'search',
      status: 'succeeded',
      itemCount: 21,
      startedAt: recorded.run.startedAt,
      finishedAt: recorded.run.finishedAt,
    })
    expect(job?.announcedAt).not.toBeNull()
  })

  it('v_rows rows parse as rows and never carry a seller key', async () => {
    const jobId = await queueCollect(t, recorded.apifyRunId)
    await claim(t)
    await store(t, jobId, recorded, null)
    const rows = await t.sql('select item from apify_gateway.v_rows order by seq')
    expect(rows).toHaveLength(21)
    for (const { item } of rows) {
      ApifyGatewayRow.parse(item)
      expect(JSON.stringify(item)).not.toMatch(/"(seller|marketplace_listing_seller)"/)
    }
    const raw = readFileSync(
      new URL(
        '../../../fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json',
        import.meta.url,
      ),
      'utf8',
    )
    expect(raw).toMatch(/"seller"/) // the recording does carry (placeholder) sellers
  })
})
