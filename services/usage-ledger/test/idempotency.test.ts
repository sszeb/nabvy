import { createEvent } from '@nabvy/contracts'
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import type { HandlerDeps } from '@nabvy/transport'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accountDeletedHandler, chargeUsage, expireBuckets, grant, reverseCharge } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000e1'
const U2 = '00000000-0000-4000-8000-0000000000e2'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await addUsers(db, U1, U2)
}, 60_000)
afterAll(() => db.close())

const count = async (userId: string) =>
  (
    await db.sql(`select count(*)::int as n from usage_ledger.entries where user_id = $1`, [userId])
  )[0]?.n

describe('idempotency', () => {
  it('grant, charge and reverse each write once when run twice', async () => {
    const g = {
      userId: U1,
      kind: 'topup' as const,
      credits: 100,
      refId: 'pi_twice',
      cashMinor: 500,
    }
    await db.as('nabvy_pipeline', (tx) => grant(tx, g))
    await db.as('nabvy_pipeline', (tx) => grant(tx, g))
    const c = { userId: U1, action: 'scan_live', credits: 7, refId: 'scan:twice' }
    const first = await db.as('nabvy_app', (tx) => chargeUsage(tx, c), U1)
    const second = await db.as('nabvy_app', (tx) => chargeUsage(tx, c), U1)
    expect(first.ok && first.value.changed).toBe(true)
    expect(second.ok && !second.value.changed && second.value.balance).toBe(93)
    await db.as('nabvy_app', (tx) => reverseCharge(tx, { userId: U1, refId: 'scan:twice' }), U1)
    await db.as('nabvy_app', (tx) => reverseCharge(tx, { userId: U1, refId: 'scan:twice' }), U1)
    expect(await count(U1)).toBe(3)
    const [bucket] = await db.sql(`select remaining from usage_ledger.buckets where user_id = $1`, [
      U1,
    ])
    expect(bucket?.remaining).toBe(100)
  })

  it('the expiry sweep closes an expired bucket once', async () => {
    await db.as('nabvy_pipeline', (tx) =>
      grant(tx, {
        userId: U2,
        kind: 'allowance',
        credits: 40,
        refId: 'allowance:expired',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    )
    expect(await db.as('nabvy_pipeline', (tx) => expireBuckets(tx))).toEqual({ expired: 1 })
    expect(await db.as('nabvy_pipeline', (tx) => expireBuckets(tx))).toEqual({ expired: 0 })
    const rows = await db.sql(
      `select kind, credits from usage_ledger.entries where user_id = $1 order by at, kind`,
      [U2],
    )
    expect(rows).toEqual([
      { kind: 'allowance', credits: 40 },
      { kind: 'expiry', credits: -40 },
    ])
  })

  it('account.deleted purges the user once; a redelivery finds nothing', async () => {
    const handler = accountDeletedHandler({ transaction: (fn) => db.as('nabvy_pipeline', fn) })
    const publisher = createMemoryPublisher()
    const deps: HandlerDeps = {
      publisher,
      deadLetters: { record: async () => ({}) },
    }
    const envelope = createEvent(
      accountEvents,
      'account.deleted',
      1,
      { userId: U1 },
      { key: `x:${U1}` },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: new Date().toISOString() }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(await count(U1)).toBe(0)
    const left = await db.sql(
      `select (select count(*) from usage_ledger.buckets where user_id = $1)::int as b,
              (select count(*) from usage_ledger.allocations where user_id = $1)::int as a`,
      [U1],
    )
    expect(left).toEqual([{ b: 0, a: 0 }])
    expect(await count(U2)).toBe(2)
  })
})
