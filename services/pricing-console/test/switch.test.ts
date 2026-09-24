import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { priceFor, setPolicy, usageLedgerPolicy } from '../src'
import {
  ADMIN,
  addUsers,
  createTestDatabase,
  setSwitch,
  type TestDatabase,
  USER_A,
} from './support/database'

// The module's switch (README.md, "Switch and priority"). Off: policy writes refused, list prices
// apply, no offers, v_offers empty; the ladder, prices and free policy still publish, and the
// ledger policy still answers. Shadow: writes run, users get list prices, v_offers stays empty
// (it shows only offers that apply). On: offers apply and v_offers shows them.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await addUsers(db, ADMIN, USER_A)
  await setSwitch(db, 'pricing-console', 'shadow')
  const offer = {
    userId: null,
    segment: 'all',
    item: 'price:export' as const,
    discountBps: 5000,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  }
  const r = await db.as('nabvy_pipeline', (q) =>
    setPolicy(q, { actorUserId: ADMIN, kind: 'offer', key: 'half', value: offer }),
  )
  if (!r.ok) throw new Error(r.error.code)
}, 60_000)
afterAll(() => db.close())

const exportPrice = () =>
  db.as('nabvy_app', (q) => priceFor(q, { userId: USER_A, item: 'price:export' }), USER_A)
const offers = async () => (await db.sql('select offer from pricing_console.v_offers')).length
const count = async (view: string) =>
  ((await db.sql(`select count(*)::int as n from pricing_console.${view}`))[0]?.n as number) ?? 0

describe('switch', () => {
  it('off: writes refused, list prices, no offers; ladder and ledger policy still answer', async () => {
    await setSwitch(db, 'pricing-console', 'off')
    const r = await db.as('nabvy_pipeline', (q) =>
      setPolicy(q, { actorUserId: ADMIN, kind: 'setting', key: 'vat-bps', value: { value: 2100 } }),
    )
    expect(r.ok ? null : r.error).toMatchObject({
      code: 'pricing-console.off',
      message: 'Pricing changes are paused while the pricing console is off.',
    })
    expect((await exportPrice()).ok && (await exportPrice())).toMatchObject({
      value: { amount: 50, offer: null },
    })
    expect(await offers()).toBe(0)
    expect(await count('v_ladder')).toBe(4)
    expect(await count('v_prices')).toBe(11)
    expect(await count('v_free_policy')).toBe(1)
    expect(await db.as('nabvy_pipeline', (q) => usageLedgerPolicy.bundleCredits(q, 'max'))).toEqual(
      {
        credits: 24000,
        policyVersion: 'pricing-console:tier/max@1',
      },
    )
  })

  it('shadow: users still pay list, and v_offers shows no offer that does not apply', async () => {
    await setSwitch(db, 'pricing-console', 'shadow')
    expect(await offers()).toBe(0)
    expect(await exportPrice()).toMatchObject({ value: { amount: 50, offer: null } })
  })

  it('on: the offer applies', async () => {
    await setSwitch(db, 'pricing-console', 'on')
    expect(await exportPrice()).toMatchObject({ value: { amount: 25, offer: 'half' } })
    expect(await offers()).toBe(1)
  })
})
