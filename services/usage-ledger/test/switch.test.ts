import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chargeUsage, expireBuckets, getBalance, grant, reverseCharge } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000f1'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await addUsers(db, U1)
}, 60_000)
afterAll(() => db.close())

const charge = (refId: string, credits = 5) =>
  db.as(
    'nabvy_app',
    (tx) => chargeUsage(tx, { userId: U1, action: 'scan_live', credits, refId }),
    U1,
  )
const balances = () =>
  db.as('nabvy_pipeline', (tx) => tx.execute('select * from usage_ledger.v_balances'))

describe('usage-ledger off (no seed row: the switch reads off)', () => {
  it('refuses a metered action with a clear message and writes nothing', async () => {
    const result = await charge('scan:off')
    expect(result).toMatchObject({ ok: false, error: { code: 'usage-ledger.off' } })
    expect(!result.ok && result.error.message).toMatch(/Nothing was charged/)
    expect(await db.sql('select * from usage_ledger.entries where kind = $1', ['charge'])).toEqual(
      [],
    )
  })

  it('still records a paid grant, so a top-up is never dropped', async () => {
    const r = await db.as('nabvy_pipeline', (tx) =>
      grant(tx, { userId: U1, kind: 'topup', credits: 20, refId: 'pi_off', cashMinor: 200 }),
    )
    expect(r.ok).toBe(true)
  })

  it('v_balances is empty, getBalance refuses, the sweep writes nothing', async () => {
    expect((await balances()).rows).toEqual([])
    expect(await db.as('nabvy_app', (tx) => getBalance(tx, U1), U1)).toMatchObject({
      ok: false,
      error: { code: 'usage-ledger.off' },
    })
    expect(await db.as('nabvy_pipeline', (tx) => expireBuckets(tx))).toEqual({ expired: 0 })
  })
})

describe('shadow and on', () => {
  it('shadow refuses charges and shows the user nothing; v_balances has rows', async () => {
    await setSwitch(db, 'shadow')
    expect(await charge('scan:shadow')).toMatchObject({
      ok: false,
      error: { code: 'usage-ledger.off' },
    })
    expect((await balances()).rows).toMatchObject([{ user_id: U1, credits: 20 }])
    expect((await db.as('nabvy_app', (tx) => getBalance(tx, U1), U1)).ok).toBe(false)
  })

  it('on shows the user their balance; a charge taken while on can be reversed after off', async () => {
    await setSwitch(db, 'on')
    expect(await db.as('nabvy_app', (tx) => getBalance(tx, U1), U1)).toEqual({
      ok: true,
      value: {
        userId: U1,
        credits: 20,
        allowanceCredits: 0,
        tasteReferralCredits: 0,
        topupCredits: 20,
        nextExpiryAt: null,
      },
    })
    expect((await charge('scan:on')).ok).toBe(true)
    await setSwitch(db, 'off')
    const r = await db.as(
      'nabvy_app',
      (tx) => reverseCharge(tx, { userId: U1, refId: 'scan:on' }),
      U1,
    )
    expect(r.ok && r.value.changed).toBe(true)
  })
})
