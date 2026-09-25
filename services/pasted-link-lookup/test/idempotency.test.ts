import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { settle, submit } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  recordingPorts,
  seedDetail,
  seedListing,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md. The same link pasted twice by one user is one request
// and one queue item; a settle tick run twice moves nothing the second time and publishes no
// second event for the same set; an out-of-order replay (settle before the card exists, then
// after) still ends in exactly one ready row and one event.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'
const ID = '12345678901234567'
const LINK = `https://www.facebook.com/marketplace/item/${ID}/`

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(async () => {
  await setSwitches(db, ALL_ON)
  await db.sql('delete from pasted_link_lookup.requests')
  await db.sql('delete from detail_evidence.fetches')
  await db.sql('delete from detail_evidence.evidence')
  await db.sql('delete from listing_ingest.listings')
})

const count = async (where = 'true') => {
  const [row] = (await db.sql(
    `select count(*)::int as n from pasted_link_lookup.requests where ${where}`,
  )) as [{ n: number }]
  return row.n
}

describe('idempotency', () => {
  it('the same link pasted twice writes one row; a second user makes one queue item too', async () => {
    const first = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    const again = await db.as(
      'nabvy_app',
      (q) => submit(q, { userId: U1, url: `${LINK}?ref=share` }),
      U1,
    )
    if (!first.ok || !again.ok) throw new Error('submit failed')
    expect(first.value.created).toBe(true)
    expect(again.value.created).toBe(false)
    expect(again.value.requestId).toBe(first.value.requestId)
    expect(await count()).toBe(1)

    await db.as('nabvy_app', (q) => submit(q, { userId: U2, url: LINK }), U2)
    expect(await count()).toBe(2)
    const ports = recordingPorts()
    const report = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    expect(report.status).toBe('settled')
    expect(ports.enqueued).toEqual([[ID]])
  })

  it('settle twice: the second run moves nothing and publishes nothing', async () => {
    await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    const listingId = await seedListing(db, { sourceListingId: ID })
    await seedDetail(db, { listingId, sourceListingId: ID })
    const ports = recordingPorts()
    const first = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    const second = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    if (first.status !== 'settled' || second.status !== 'settled') throw new Error('off')
    expect(first.ready).toBe(1)
    expect(first.events).toHaveLength(1)
    expect(second.ready).toBe(0)
    expect(second.events).toHaveLength(0)
    expect(ports.enqueued).toEqual([])
    expect(await count(`status = 'ready' and listing_id = '${listingId}'`)).toBe(1)
  })

  it('out of order: settle before the card exists, then after, ends in one ready row', async () => {
    await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    const ports = recordingPorts()
    const before = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    if (before.status !== 'settled') throw new Error('off')
    expect(before.ready).toBe(0)
    expect(ports.enqueued).toEqual([[ID]])
    expect(await count(`status = 'queued' and listing_id is null`)).toBe(1)

    const listingId = await seedListing(db, { sourceListingId: ID })
    const visible = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    if (visible.status !== 'settled') throw new Error('off')
    expect(visible.ready).toBe(0)
    expect(await count(`status = 'queued' and listing_id = '${listingId}'`)).toBe(1)
    expect(ports.enqueued).toEqual([[ID], [ID]])

    await seedDetail(db, { listingId, sourceListingId: ID })
    const after = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    if (after.status !== 'settled') throw new Error('off')
    expect(after.ready).toBe(1)
    expect(after.events[0]?.key).toMatch(/^pasted-link-lookup\.ready:/)
    expect(await count(`status = 'ready'`)).toBe(1)
    expect(await count()).toBe(1)
  })

  it('a failed fetch closes the request once; a replay changes nothing', async () => {
    await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    const ports = recordingPorts([{ sourceListingId: ID, lane: 'text', status: 'failed' }])
    const first = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    const second = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    if (first.status !== 'settled' || second.status !== 'settled') throw new Error('off')
    expect(first.failed).toBe(1)
    expect(second.failed).toBe(0)
    expect(ports.enqueued).toEqual([])
    expect(await count(`status = 'failed' and outcome = 'fetch-failed'`)).toBe(1)
  })
})
