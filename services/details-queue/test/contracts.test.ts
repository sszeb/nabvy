import { createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  DetailsQueueDeferredEvent,
  DetailsQueueEnqueueInput,
  DetailsQueueItem,
  events,
  module,
} from '@nabvy/contracts/modules/details-queue'
import { vQueue } from '@nabvy/db/schema/details-queue'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enqueue, readQueue, submitNext } from '../src'
import { ALL_ON, createTestDatabase, fakePorts, ids, type TestDatabase } from './support/database'

describe('details-queue contracts', () => {
  it('declares its module name under its own file', () => {
    expect(module).toBe('details-queue')
    expect(events.module).toBe('details-queue')
  })

  it('round-trips the details-queue.deferred event', () => {
    const envelope = createEvent(
      events,
      'details-queue.deferred',
      1,
      { source: 'facebook', sourceListingIds: ids(2), day: '2026-09-24' },
      { key: 'details-queue.deferred:2026-09-24:abc' },
    )
    expect(safeParseEvent(events, envelope)).toEqual({ success: true, data: envelope })
    expect(DetailsQueueDeferredEvent.safeParse({ ...envelope.payload, title: 'x' }).success).toBe(
      false,
    )
  })

  it('refuses an enqueue of more than 500 IDs, or of non-numeric IDs', () => {
    const base = {
      priority: 'sweep',
      lane: 'text',
      reason: 'first-seen',
      requestedBy: 'details-selector',
    }
    expect(
      DetailsQueueEnqueueInput.safeParse({ ...base, sourceListingIds: ids(501) }).success,
    ).toBe(false)
    expect(DetailsQueueEnqueueInput.safeParse({ ...base, sourceListingIds: ['12a'] }).success).toBe(
      false,
    )
    expect(DetailsQueueEnqueueInput.parse({ ...base, sourceListingIds: ids(1) })).toMatchObject({
      source: 'facebook',
      refresh: false,
    })
  })

  it('v_queue columns are exactly the contract row, with no seller-like column', () => {
    const columns = Object.keys(getViewConfig(vQueue).selectedFields)
    expect(columns.sort()).toEqual(Object.keys(DetailsQueueItem.shape).sort())
  })

  describe('against the database', () => {
    let t: TestDatabase
    beforeEach(async () => {
      t = await createTestDatabase()
      await t.switches(ALL_ON)
    })
    afterEach(() => t.close())

    it('every v_queue row parses as DetailsQueueItem', async () => {
      await t.db.transaction((q) =>
        enqueue(q, {
          sourceListingIds: ids(3),
          priority: 'new-listing',
          lane: 'text',
          reason: 'first-seen',
          requestedBy: 'details-selector',
          regionId: 'chichester',
        }),
      )
      await t.db.transaction((q) => submitNext(q, { ports: fakePorts() }))
      const rows = await readQueue(t.db)
      expect(rows).toHaveLength(3)
      for (const r of rows) expect(DetailsQueueItem.parse(r)).toEqual(r)
      const columns = await t.sql(
        `select column_name from information_schema.columns
         where table_schema = 'details_queue' and table_name = 'v_queue'`,
      )
      for (const { column_name } of columns) {
        expect(String(column_name)).not.toMatch(
          /seller|profile|^raw|_raw$|source_fields|title|description/,
        )
      }
    })
  })
})
