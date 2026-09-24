import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeBatch, enqueue, erase, readQueue, submitNext } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  fakePorts,
  ids,
  row,
  type TestDatabase,
} from './support/database'

// Rule 11: off (the default) sends nothing and empties v_queue, but enqueue still records and
// queued work waits, visible again once the switch is back; shadow runs (no user-facing view);
// the global pipeline pause stops submission too. details-queue has no readers built yet, so
// "a reader's fixtures pass with this module off" waits for details-selector (task 1.4b).

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(() => t.close())

const input = (sourceListingIds: string[]) => ({
  sourceListingIds,
  priority: 'new-listing' as const,
  lane: 'text' as const,
  reason: 'first-seen' as const,
  requestedBy: 'details-selector',
})

describe('switch', () => {
  it('off by default: nothing is sent, enqueue still records, v_queue is empty', async () => {
    const ports = fakePorts()
    expect(await t.db.transaction((q) => enqueue(q, input(ids(3))))).toMatchObject({ queued: 3 })
    expect(await t.db.transaction((q) => submitNext(q, { ports }))).toEqual({ status: 'off' })
    expect(ports.calls).toEqual([])
    expect(await readQueue(t.db)).toEqual([])
    expect(await t.sql('select status from details_queue.items')).toHaveLength(3)
    // Switched on, the same work is there, never dropped.
    await t.switches(ALL_ON)
    expect(await readQueue(t.db)).toHaveLength(3)
  })

  it('the global pipeline pause stops submission', async () => {
    const ports = fakePorts()
    await t.switches({ 'details-queue': 'on', pipeline: 'off' })
    await t.db.transaction((q) => enqueue(q, input(ids(3))))
    expect(await t.db.transaction((q) => submitNext(q, { ports }))).toEqual({ status: 'off' })
    expect(ports.calls).toEqual([])
  })

  it('shadow runs and writes like on (no user-facing view)', async () => {
    const ports = fakePorts()
    await t.switches({ 'details-queue': 'shadow', pipeline: 'on' })
    await t.db.transaction((q) => enqueue(q, input(ids(3))))
    expect(await t.db.transaction((q) => submitNext(q, { ports }))).toMatchObject({
      status: 'submitted',
    })
    expect(await readQueue(t.db)).toHaveLength(3)
  })

  it('a batch in flight when the module is switched off still closes', async () => {
    const ports = fakePorts()
    const two = ids(2)
    await t.switches(ALL_ON)
    await t.db.transaction((q) => enqueue(q, input(two)))
    await t.db.transaction((q) => submitNext(q, { ports }))
    await t.switches({ 'details-queue': 'off' })
    await t.rows(
      1,
      two.map((id) => row(id)),
    )
    expect(await t.db.transaction((q) => closeBatch(q, 1))).toBe(true)
    expect(await t.sql('select status from details_queue.items')).toEqual([
      { status: 'done' },
      { status: 'done' },
    ])
  })

  it('erase runs whatever the switch says and drops the IDs from the batch record', async () => {
    const ports = fakePorts()
    const two = ids(2)
    await t.switches(ALL_ON)
    await t.db.transaction((q) => enqueue(q, input(two)))
    await t.db.transaction((q) => submitNext(q, { ports }))
    await t.switches({ 'details-queue': 'off' })
    expect(await t.db.transaction((q) => erase(q, [two[0] as string]))).toBe(1)
    expect(await t.sql('select source_listing_id from details_queue.items')).toEqual([
      { source_listing_id: two[1] },
    ])
    expect(await t.sql('select source_listing_id from details_queue.leases')).toEqual([
      { source_listing_id: two[1] },
    ])
    expect(await t.sql('select size, source_listing_ids from details_queue.batches')).toEqual([
      { size: 2, source_listing_ids: [two[1]] },
    ])
  })
})
