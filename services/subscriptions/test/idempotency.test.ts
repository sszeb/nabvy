import { createEvent } from '@nabvy/contracts'
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import type { HandlerDeps } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accountDeletedHandler, processStripeEvent } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'
import { harness, stripeEvent, USER } from './support/ladder'

// Every handler twice on the same input: the second run writes nothing (CLAUDE.md, "Idempotent
// handlers"; key = the Stripe event ID).

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await setSwitch(db, 'on', 'usage-ledger')
  await addUsers(db, USER)
}, 60_000)
afterEach(() => db.close())

const snapshot = async () => ({
  billing: await db.sql('select * from subscriptions.billing_events order by stripe_event_id'),
  entitlements: await db.sql('select * from subscriptions.entitlements'),
  ledger: await db.sql('select kind, ref_id, credits from usage_ledger.entries order by ref_id'),
})

describe('idempotency', () => {
  it.each([
    'customer-created',
    'sub-created-trialing',
    'sub-created-incomplete',
    'charge-succeeded',
    'checkout-subscription',
    'checkout-topup',
    'unhandled-type',
  ])('%s twice writes once', async (name) => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('customer-created') as never, h)
    await processStripeEvent(stripeEvent(name) as never, h)
    const first = await snapshot()
    const again = await processStripeEvent(stripeEvent(name) as never, h)
    expect(again).toMatchObject({ changed: false, outcome: 'replayed', events: [] })
    expect(await snapshot()).toEqual(first)
  })

  it('account.deleted twice purges the entitlement once and keeps the consent', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('sub-updated-active') as never, h)
    await processStripeEvent(stripeEvent('checkout-subscription') as never, h)
    const handler = accountDeletedHandler({ transaction: h.transaction })
    const event = createEvent(
      accountEvents,
      'account.deleted',
      1,
      { userId: USER },
      { key: `account.deleted:${USER}` },
    )
    const deps: HandlerDeps = { publisher: h.publisher, deadLetters: { record: async () => ({}) } }
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: new Date().toISOString() }
    expect((await handler.run(event, attempt, deps)).status).toBe('handled')
    expect((await handler.run(event, attempt, deps)).status).toBe('handled')
    expect(await db.sql('select * from subscriptions.entitlements')).toEqual([])
    expect(
      await db.sql(
        'select count(*)::int as n from subscriptions.billing_events where consent_start_now',
      ),
    ).toEqual([{ n: 1 }])
  })
})
