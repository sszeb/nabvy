import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { settle, submit } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  recordingPorts,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md. Off: pasting is unavailable, settle writes nothing
// and sends nothing to the details queue, and both views are empty. Shadow: submit still refuses
// (pasting is a user-facing feature; README "Decisions"), settle runs and writes, the internal
// view has rows, the user-facing view has none. On: the user sees their own requests.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const LINK = 'https://www.facebook.com/marketplace/item/12345678901234567/'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(async () => {
  await setSwitches(db, ALL_ON)
  await db.sql('delete from pasted_link_lookup.requests')
})

const rows = (result: unknown) => (result as { rows: unknown[] }).rows
const internalCounts = () =>
  db.as('nabvy_pipeline', (q) => q.execute('select * from pasted_link_lookup.v_request_counts'))
const userFacing = () =>
  db.as('nabvy_app', (q) => q.execute('select * from app.v_pasted_link_lookup_requests'), U1)
const seedQueued = () =>
  db.sql(
    `insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status)
     values ($1, 'facebook', '12345678901234567', 'queued')`,
    [U1],
  )

describe('switch', () => {
  it('off: refuses submit, settle writes and sends nothing, and both views are empty', async () => {
    await setSwitches(db, { 'pasted-link-lookup': 'off' })
    const outcome = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('pasted-link-lookup.off')
    await seedQueued()
    const ports = recordingPorts()
    const report = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    expect(report.status).toBe('off')
    expect(ports.enqueued).toEqual([])
    const [{ n }] = (await db.sql(
      `select count(*)::int as n from pasted_link_lookup.requests where status <> 'queued'`,
    )) as [{ n: number }]
    expect(n).toBe(0)
    expect(rows(await internalCounts())).toHaveLength(0)
    expect(rows(await userFacing())).toHaveLength(0)
  })

  it('shadow: submit refuses, settle runs, the internal view has rows, the user-facing view none', async () => {
    await setSwitches(db, { 'pasted-link-lookup': 'shadow' })
    const outcome = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('pasted-link-lookup.off')
    await seedQueued()
    const ports = recordingPorts()
    const report = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
    expect(report.status).toBe('settled')
    expect(ports.enqueued).toEqual([['12345678901234567']])
    expect(rows(await internalCounts())).toHaveLength(1)
    expect(rows(await userFacing())).toHaveLength(0)
  })

  it('on: the user sees their own request', async () => {
    const outcome = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    expect(outcome.ok).toBe(true)
    expect(rows(await userFacing())).toHaveLength(1)
    expect(rows(await internalCounts())).toHaveLength(1)
  })

  it('listing-suppression off: the user-facing view shows no request, even when on', async () => {
    await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    await setSwitches(db, { 'listing-suppression': 'off' })
    expect(rows(await userFacing())).toHaveLength(0)
  })
})
