import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJobs, submitRun, watch } from '../src'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'
import { claim, loadRun, queueCollect, store } from './support/gateway'

// Rule 11 of docs/design/modules/_rules.md, with the gateway's fail-closed reading: while the
// module, the `apify` provider or the pipeline is off, no run is queued or claimed and the watcher
// writes and publishes nothing; while the cost meter is off, no paid run is queued. No other
// module reads the gateway yet, so "a reader's fixtures pass with this module off" waits for
// listing-ingest (task 1.3a).

const recorded = loadRun('facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k')
const request = {
  shape: 'newest-check',
  input: recorded.input.actorInput,
  memoryMb: 1024,
  timeoutSecs: 300,
  tags: { module: 'check-scheduler', region: 'chichester', purpose: 'switch test' },
} as const

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

const jobCount = async () =>
  Number((await t.sql('select count(*) as n from apify_gateway.jobs'))[0]?.n)

describe('off', () => {
  it.each([
    ['nothing switched on (the default)', {}],
    ['module off', { ...ALL_ON, 'apify-gateway': 'off' }],
    ['provider apify off', { ...ALL_ON, apify: 'off' }],
    ['pipeline paused', { ...ALL_ON, pipeline: 'off' }],
  ] as const)('%s: no run is queued', async (_, states) => {
    await t.switches(states)
    const result = await submitRun(t.db, request)
    expect(result).toMatchObject({ ok: false, error: { code: 'apify-gateway.off' } })
    expect(await jobCount()).toBe(0)
  })

  it('module off: nothing is claimed, the watcher writes nothing, the views are empty', async () => {
    await t.switches(ALL_ON)
    const jobId = await queueCollect(t, recorded.apifyRunId)
    await claim(t)
    await store(t, jobId, recorded, null)
    await t.switches({ 'apify-gateway': 'off' })
    await queueCollect(t, recorded.apifyRunId)
    expect(await claim(t)).toBeUndefined()

    const publisher = createMemoryPublisher()
    const report = await watch(t.db, { publisher, usdGbpRate: 0.75 })
    expect(report).toMatchObject({ open: false, collected: [], invoked: false })
    expect(publisher.published).toEqual([])
    const [announced] = await t.sql(
      'select count(announced_at)::integer as n from apify_gateway.jobs',
    )
    expect(announced?.n).toBe(0)
    expect(await readJobs(t.db, [jobId])).toEqual([])
  })

  it('an unknown or unreadable switch reads off', async () => {
    await t.switches(ALL_ON)
    await t.sql(`delete from switches.switches where name = 'apify-gateway'`)
    expect(await submitRun(t.db, request)).toMatchObject({ error: { code: 'apify-gateway.off' } })
  })
})

describe('cost meter off', () => {
  it('no paid run is queued', async () => {
    await t.switches({ ...ALL_ON, 'cost-meter': 'off' })
    const result = await submitRun(t.db, request)
    expect(result).toMatchObject({ ok: false, error: { code: 'apify-gateway.cost_meter_off' } })
    expect(await jobCount()).toBe(0)
  })

  it('a run already queued is not claimed until it is back on', async () => {
    await t.switches(ALL_ON)
    const submitted = await submitRun(t.db, request)
    if (!submitted.ok) throw new Error(submitted.error.message)
    await t.switches({ 'cost-meter': 'off' })
    expect(await claim(t)).toBeUndefined()
    await t.switches({ 'cost-meter': 'on' })
    expect(await claim(t)).toMatchObject({ id: submitted.value.jobId, status: 'running' })
  })

  it('the watcher still announces rows but leaves metering for later', async () => {
    await t.switches(ALL_ON)
    const submitted = await submitRun(t.db, request)
    if (!submitted.ok) throw new Error(submitted.error.message)
    await claim(t)
    await t.sql(`update apify_gateway.jobs set apify_run_id = $1 where id = $2`, [
      recorded.apifyRunId,
      submitted.value.jobId,
    ])
    await store(t, submitted.value.jobId, recorded, 0.0003)
    await t.switches({ 'cost-meter': 'off' })
    const publisher = createMemoryPublisher()
    const report = await watch(t.db, { publisher, usdGbpRate: 0.75 })
    expect(report.metered).toEqual([])
    expect(report.deferred).toEqual([{ jobId: submitted.value.jobId, reason: 'cost-meter.off' }])
    expect(report.collected).toEqual([submitted.value.jobId])

    await t.switches({ 'cost-meter': 'on' })
    const later = await watch(t.db, { publisher, usdGbpRate: 0.75 })
    expect(later.metered).toEqual([submitted.value.jobId])
  })
})

describe('shadow', () => {
  it('runs and writes like on (the gateway has no user-facing output)', async () => {
    await t.switches({ ...ALL_ON, 'apify-gateway': 'shadow' })
    const result = await submitRun(t.db, request)
    expect(result.ok).toBe(true)
    expect(await claim(t)).toMatchObject({ kind: 'run', status: 'running' })
  })
})
