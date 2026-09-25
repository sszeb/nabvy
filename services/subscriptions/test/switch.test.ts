import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getEntitlement, grantDueAllowances, processStripeEvent, startCheckout } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'
import { harness, stripeEvent, testLadder, USER } from './support/ladder'

// The switch (rule 11; card "When off"): off, no Checkout starts and the sweep writes nothing;
// entitlements already granted stay, and v_entitlements keeps its rows (rule 11 exempts it);
// v_billing_signals is empty. Stripe webhooks keep recording while off (README.md, "Decisions").

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on', 'usage-ledger')
  await addUsers(db, USER)
}, 60_000)
afterEach(() => db.close())

const count = async (sql: string) =>
  (await db.as('nabvy_pipeline', async (q) => (await q.execute(sql)).rows)).length

describe('switch', () => {
  it('off (the default, no row): no Checkout starts', async () => {
    const r = await db.as(
      'nabvy_app',
      (q) => startCheckout(q, USER, { plan: 'pro', startNow: true }, testLadder),
      USER,
    )
    expect(r).toMatchObject({ ok: false, error: { code: 'subscriptions.off' } })
  })

  it('shadow: still no Checkout (only on sells)', async () => {
    await setSwitch(db, 'shadow')
    const r = await db.as(
      'nabvy_app',
      (q) => startCheckout(q, USER, { plan: 'pro', startNow: true }, testLadder),
      USER,
    )
    expect(r).toMatchObject({ ok: false, error: { code: 'subscriptions.off' } })
  })

  it('off: webhooks still record, granted entitlements stay, v_entitlements keeps rows, signals hide', async () => {
    const h = harness(db)
    await setSwitch(db, 'on')
    await processStripeEvent(stripeEvent('customer-created') as never, h)
    await processStripeEvent(stripeEvent('sub-updated-active') as never, h)
    await processStripeEvent(stripeEvent('charge-succeeded') as never, h)
    await setSwitch(db, 'off')
    await processStripeEvent(stripeEvent('sub-updated-cancel-at-end') as never, h)
    expect(await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER, testLadder))).toMatchObject(
      {
        tier: 'pro',
        cancelAtPeriodEnd: true,
      },
    )
    expect(await count('select * from subscriptions.v_entitlements')).toBe(1)
    expect(await count('select * from subscriptions.v_billing_signals')).toBe(0)
    await setSwitch(db, 'shadow')
    expect(await count('select * from subscriptions.v_billing_signals')).toBe(1)
  })

  it('off: the allowance sweep writes nothing', async () => {
    const r = await db.as('nabvy_pipeline', (q) => grantDueAllowances(q))
    expect(r).toEqual({ granted: 0, unchanged: 0, refused: 0, next: null })
  })

  it('everyone without a subscription is Free, whatever the switch', async () => {
    const e = await db.as('nabvy_app', (q) => getEntitlement(q, USER, testLadder), USER)
    expect(e).toMatchObject({ tier: 'free', status: 'free', wants: 1 })
  })
})
