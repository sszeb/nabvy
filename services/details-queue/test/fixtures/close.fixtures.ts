import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { closeBatch, enqueue, submitNext } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  fakePorts,
  loadDataset,
  type TestDatabase,
} from '../support/database'

// Stage `close`: the requeue table of actor-integration.md 2.10. Each case leases a batch of
// items with given counters, stores the run's rows (a recorded run's dataset, or synthetic rows
// built from the actor's documented outcomes) and closes the batch. Expected: each item's state.

const Item = z.strictObject({
  id: z.string(),
  attempts: z.int().nonnegative(),
  requeues: z.int().nonnegative(),
})
const Input = z.union([
  z.strictObject({
    synthetic: z.literal(true),
    source: z.string().min(1),
    items: z.array(Item).min(1),
    rows: z.array(z.record(z.string(), z.unknown())),
  }),
  z.strictObject({
    run: z.string().min(1),
    source: z.string().min(1),
    items: z.array(Item).min(1),
  }),
])
const Expected = z.strictObject({
  items: z.record(
    z.string(),
    z.strictObject({
      status: z.string(),
      attempts: z.int(),
      requeues: z.int(),
      lastOutcome: z.string(),
    }),
  ),
})

const casesDir = new URL('./cases/close/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

describe('close', () => {
  let t: TestDatabase
  beforeEach(async () => {
    t = await createTestDatabase()
    await t.switches(ALL_ON)
  })
  afterEach(() => t.close())

  it.each(cases)('$id', async ({ input, expected }) => {
    const ports = fakePorts()
    await enqueue(t.db, {
      sourceListingIds: input.items.map((i) => i.id),
      priority: 'new-listing',
      lane: 'text',
      reason: 'first-seen',
      requestedBy: 'details-selector',
      regionId: 'chichester',
    })
    for (const item of input.items) {
      await t.sql(
        'update details_queue.items set attempts = $2, requeues = $3 where source_listing_id = $1',
        [item.id, item.attempts, item.requeues],
      )
    }
    const report = await t.db.transaction((q) => submitNext(q, { ports }))
    expect(report).toMatchObject({ status: 'submitted', size: input.items.length })
    const jobId = (report as { jobId: number }).jobId
    await t.rows(jobId, 'run' in input ? loadDataset(input.run) : input.rows)

    expect(await t.db.transaction((q) => closeBatch(q, jobId))).toBe(true)
    const rows = await t.sql(
      'select source_listing_id, status, attempts, requeues, last_outcome from details_queue.items',
    )
    const actual = Object.fromEntries(
      rows.map((r) => [
        r.source_listing_id,
        {
          status: r.status,
          attempts: r.attempts,
          requeues: r.requeues,
          lastOutcome: r.last_outcome,
        },
      ]),
    )
    expect(actual).toEqual(expected.items)
    expect(await t.sql('select 1 from details_queue.leases')).toHaveLength(0)
  })
})
