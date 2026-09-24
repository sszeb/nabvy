import type { EventEnvelope } from '@nabvy/contracts'
import { createMemoryPublisher, type Publisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitRun, watch } from '../src'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'
import { claim, loadRun, queueCollect, settleCost, start, store } from './support/gateway'

// The watcher is safe to run twice, and safe to crash between publishing and marking: every
// announcement is keyed by its job ID, so the retry publishes the same key and the transport drops
// it. Cost-meter writes are idempotent on (provider, refId).

const recorded = loadRun('facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

/** A batch of finished jobs: two free re-downloads and one paid run, settled. */
async function finishedBatch(): Promise<number[]> {
  const ids: number[] = []
  for (let n = 0; n < 2; n++) {
    const id = await queueCollect(t, recorded.apifyRunId)
    await claim(t)
    await store(t, id, recorded, null)
    ids.push(id)
  }
  const submitted = await submitRun(t.db, {
    shape: 'newest-check',
    input: recorded.input.actorInput,
    memoryMb: 1024,
    timeoutSecs: 300,
    tags: { module: 'check-scheduler', region: 'chichester', purpose: 'idempotency test' },
  })
  if (!submitted.ok) throw new Error(submitted.error.message)
  await claim(t)
  await start(t, submitted.value.jobId, recorded)
  await store(t, submitted.value.jobId, recorded, recorded.run.usageTotalUsd)
  await settleCost(t, submitted.value.jobId, recorded)
  ids.push(submitted.value.jobId)
  return ids
}

const snapshot = () =>
  t.sql(
    `select id, metered_at, announced_at, settle_announced_at from apify_gateway.jobs order by id`,
  )
const ledger = () =>
  t.sql('select ref_id, reserved_micros, settled_micros, settled_at from cost_meter.provider_calls')

describe('watch', () => {
  it('writes and publishes nothing the second time', async () => {
    const ids = await finishedBatch()
    const publisher = createMemoryPublisher()
    const first = await watch(t.db, { publisher, usdGbpRate: 0.75 })
    expect(first.collected).toEqual(ids)
    expect(first.metered).toEqual([ids[2]])
    expect(first.settled).toEqual([ids[2]])
    const jobs = await snapshot()
    const costs = await ledger()
    const published = publisher.published.length

    const second = await watch(t.db, { publisher, usdGbpRate: 0.75 })
    expect(second).toMatchObject({ metered: [], collected: [], settled: [], deferred: [] })
    expect(await snapshot()).toEqual(jobs)
    expect(await ledger()).toEqual(costs)
    expect(publisher.published).toHaveLength(published)
    expect(publisher.duplicates).toEqual([])
  })

  it('a tick that fails after publishing announces each job once when retried', async () => {
    const ids = await finishedBatch()
    const memory = createMemoryPublisher()
    let failNext = true
    const flaky: Publisher = {
      async publish(envelopes: readonly EventEnvelope[]) {
        await memory.publish(envelopes)
        if (failNext) {
          failNext = false
          throw new Error('lost acknowledgement')
        }
      },
    }
    await expect(watch(t.db, { publisher: flaky, usdGbpRate: 0.75 })).rejects.toThrow(
      'lost acknowledgement',
    )
    const [unmarked] = await t.sql(
      'select count(announced_at)::integer as n from apify_gateway.jobs',
    )
    expect(unmarked?.n).toBe(0)

    await watch(t.db, { publisher: flaky, usdGbpRate: 0.75 })
    expect(memory.ofType('apify-gateway.run-collected').map((e) => e.key)).toEqual(
      ids.map((id) => `apify-gateway.run-collected:${id}`),
    )
    expect(memory.duplicates.map((e) => e.key)).toEqual(
      ids.map((id) => `apify-gateway.run-collected:${id}`),
    )
    expect(memory.ofType('apify-gateway.run-settled')).toHaveLength(1)
  })
})

describe('submitRun', () => {
  it('queues one job per call; a refused input queues nothing and leaves the transaction usable', async () => {
    const refused = await submitRun(t.db, {
      shape: 'newest-check',
      input: { ...recorded.input.actorInput, useDetailCache: true },
      memoryMb: 1024,
      timeoutSecs: 300,
      tags: { module: 'check-scheduler', region: 'chichester', purpose: 'refusal' },
    })
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'apify-gateway.refused', message: 'input.useDetailCache must be false' },
    })
    const [row] = await t.sql('select count(*)::integer as n from apify_gateway.jobs')
    expect(row?.n).toBe(0)
  })
})
