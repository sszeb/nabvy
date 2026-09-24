import { readdirSync, readFileSync } from 'node:fs'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitRun, watch } from '../../src'
import { ALL_ON, createTestDatabase, type TestDatabase } from '../support/database'
import { claim, loadRun, queueCollect, settleCost, start, store } from '../support/gateway'

// Stage "watch": a recorded run goes through the gateway (the Edge Function's SQL steps played
// from the recording) while the watcher ticks, on the real migrations in PGlite. Each case checks
// the events published, the rows the published views give, the cost-meter ledger, and that one
// more tick writes nothing. Modes: `collect` (a free re-download), `paid` (submitRun to
// run-settled), `start-failed` (synthetic: the start threw).

interface Input {
  run: string
  mode: 'collect' | 'paid' | 'start-failed'
  shape?: 'newest-check'
  tags?: { module: string; region: string; purpose: string }
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()
const RATE = 0.75 // synthetic: USD_GBP_RATE has no recorded value (cost-meter's tests do the same)

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
    const expected = read(new URL(`${id}/expected.json`, CASES))
    const recorded = loadRun(input.run)
    const publisher = createMemoryPublisher()
    const tick = () => watch(t.db, { publisher, usdGbpRate: RATE })
    const observed: Record<string, unknown> = {}

    if (input.mode === 'collect') {
      const jobId = await queueCollect(t, recorded.apifyRunId)
      expect(await claim(t)).toMatchObject({ id: jobId, kind: 'collect', status: 'running' })
      await tick()
      await store(t, jobId, recorded, null)
      await tick()
    } else {
      const submitted = await submitRun(t.db, {
        shape: input.shape ?? 'newest-check',
        input: recorded.input.actorInput,
        memoryMb: recorded.input.runOptions.memory as 1024,
        timeoutSecs: recorded.input.runOptions.timeout,
        tags: input.tags ?? { module: 'check-scheduler', region: 'test', purpose: 'test' },
      })
      if (!submitted.ok) throw new Error(submitted.error.message)
      observed.reserveUsd = submitted.value.reserveUsd
      const job = await claim(t)
      expect(job).toMatchObject({ id: submitted.value.jobId, kind: 'run', status: 'running' })
      if (input.mode === 'start-failed') {
        await t.sql(
          `update apify_gateway.jobs set status = 'failed', error = 'Apify POST /acts returned 402'
           where id = $1`,
          [submitted.value.jobId],
        )
        await tick()
      } else {
        await start(t, submitted.value.jobId, recorded)
        await tick() // meters the reservation
        await store(t, submitted.value.jobId, recorded, recorded.run.usageTotalUsd)
        await tick() // run-collected
        await settleCost(t, submitted.value.jobId, recorded)
        await tick() // settles in cost-meter, run-settled
      }
    }

    const replay = await tick()
    observed.events = publisher.published.map(({ type, key, payload }) => ({ type, key, payload }))
    const [rows] = await t.sql(
      `select count(*)::integer as total,
              count(*) filter (where record_type = 'listing')::integer as listings,
              count(*) filter (where item::text ~ '"(seller|marketplace_listing_seller)"')::integer
                as "withSellerKey"
       from apify_gateway.v_rows`,
    )
    observed.rows = rows
    const [presence] = await t.sql(
      'select count(*) filter (where present)::integer as n from apify_gateway.v_seller_presence',
    )
    observed.sellerPresent = presence?.n
    observed.costs = await t.sql(
      `select module, ref_id as "refId", reserved_micros as "reservedMicros",
              settled_micros as "settledMicros", status
       from cost_meter.v_costs order by ref_id`,
    )
    observed.replay = {
      metered: replay.metered,
      collected: replay.collected,
      settled: replay.settled,
    }
    expect(publisher.duplicates).toEqual([])
    expect(observed).toEqual(expected)
  })
})
