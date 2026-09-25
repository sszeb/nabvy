import { createEvent } from '@nabvy/contracts'
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { createMemoryPublisher, type HandlerDeps } from '@nabvy/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accountDeletedHandler, purge, retirePolicy, setPolicy } from '../src'
import {
  ADMIN,
  addUsers,
  auditRows,
  createTestDatabase,
  setSwitch,
  type TestDatabase,
  USER_A,
} from './support/database'

// Everything safe to run twice: the same change writes one version and one audit row; a
// retirement once; the account-deletion purge and its handler find nothing the second time.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await addUsers(db, ADMIN, USER_A)
  await setSwitch(db, 'pricing-console', 'on')
}, 60_000)
afterAll(() => db.close())

const admin = <T>(fn: (q: Queryable) => Promise<T>) => db.as('nabvy_pipeline', fn)

describe('idempotency', () => {
  it('writes a change once', async () => {
    const change = {
      actorUserId: ADMIN,
      kind: 'price' as const,
      key: 'export',
      value: { unit: 'each' as const, credits: 45, costBasis: null, costUnits: 1 },
    }
    const first = await admin((q) => setPolicy(q, change))
    const second = await admin((q) => setPolicy(q, change))
    expect(first.ok && first.value).toMatchObject({ changed: true, row: { version: 2 } })
    expect(second.ok && second.value).toMatchObject({ changed: false, row: { version: 2 } })
    expect(await auditRows(db, 'policy:price/export')).toHaveLength(1)
  })

  it('retires once', async () => {
    const retire = { actorUserId: ADMIN, kind: 'price' as const, key: 'boost-7d' }
    const first = await admin((q) => retirePolicy(q, retire))
    const second = await admin((q) => retirePolicy(q, retire))
    expect(first.ok && first.value.changed).toBe(true)
    expect(second.ok && second.value.changed).toBe(false)
    expect(await auditRows(db, 'policy:price/boost-7d')).toHaveLength(1)
  })

  it('purges a deleted account’s offers once, through the handler too', async () => {
    const offer = {
      userId: USER_A,
      segment: null,
      item: 'price:export' as const,
      discountBps: 1000,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    }
    const make = (key: string) =>
      admin((q) => setPolicy(q, { actorUserId: ADMIN, kind: 'offer', key, value: offer }))
    await make('for-a')
    expect(await admin((q) => purge(q, [USER_A]))).toBe(1)
    expect(await admin((q) => purge(q, [USER_A]))).toBe(0)

    await make('for-a-again')
    const handler = accountDeletedHandler({ transaction: (fn) => admin(fn) })
    const deps: HandlerDeps = {
      publisher: createMemoryPublisher(),
      deadLetters: { record: async () => ({}) },
    }
    const envelope = createEvent(
      accountEvents,
      'account.deleted',
      1,
      { userId: USER_A },
      { key: `x:${USER_A}` },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: new Date().toISOString() }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    const [left] = await db.sql(
      `select count(*)::int as n from pricing_console.policy_rows where kind = 'offer'`,
    )
    expect(left?.n).toBe(0)
  })
})
