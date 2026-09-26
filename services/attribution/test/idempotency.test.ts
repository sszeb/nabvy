import { createEvent } from '@nabvy/contracts'
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import type { HandlerDeps } from '@nabvy/transport'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountDeletedHandler,
  captureAttribution,
  inMemoryPartnerClient,
  reverseSale,
  trackSale,
} from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000e1'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'attribution', 'on')
  await addUsers(db, U1)
}, 60_000)
afterAll(() => db.close())

const deps = () => ({ partnerClient: inMemoryPartnerClient() })
const count = async (table: string, userId: string) =>
  (
    await db.sql(`select count(*)::int as n from attribution.${table} where user_id = $1`, [userId])
  )[0]?.n

describe('idempotency', () => {
  it('captureAttribution, trackSale and reverseSale each write once when run twice', async () => {
    const input = { userId: U1, affiliateClickId: 'click_twice' }
    await db.as('nabvy_pipeline', (tx) => captureAttribution(tx, input, deps()))
    await db.as('nabvy_pipeline', (tx) => captureAttribution(tx, input, deps()))
    expect(await count('utm_attributions', U1)).toBe(1)
    expect(await count('partner_events', U1)).toBe(1) // one lead

    const sale = {
      userId: U1,
      invoiceId: 'in_twice',
      kind: 'subscription' as const,
      amountMinor: 900,
      currency: 'GBP' as const,
    }
    await db.as('nabvy_pipeline', (tx) => trackSale(tx, sale, deps()))
    await db.as('nabvy_pipeline', (tx) => trackSale(tx, sale, deps()))
    expect(await count('partner_events', U1)).toBe(2) // lead + sale, not two sales

    const reversal = { userId: U1, stripeEventId: 'dp_twice', reason: 'chargeback' as const }
    await db.as('nabvy_pipeline', (tx) => reverseSale(tx, reversal, deps()))
    await db.as('nabvy_pipeline', (tx) => reverseSale(tx, reversal, deps()))
    expect(await count('partner_events', U1)).toBe(3) // + one reversal, not two
  })

  it('account.deleted purges the user once; a redelivery finds nothing left', async () => {
    const handler = accountDeletedHandler({ transaction: (fn) => db.as('nabvy_pipeline', fn) })
    const publisher = createMemoryPublisher()
    const handlerDeps: HandlerDeps = { publisher, deadLetters: { record: async () => ({}) } }
    const envelope = createEvent(
      accountEvents,
      'account.deleted',
      1,
      { userId: U1 },
      { key: `x:${U1}` },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: new Date().toISOString() }
    expect((await handler.run(envelope, attempt, handlerDeps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, handlerDeps)).status).toBe('handled')
    expect(await count('utm_attributions', U1)).toBe(0)
    expect(await count('partner_events', U1)).toBe(0)
    const [codes] = await db.sql(
      `select count(*)::int as n from attribution.referral_codes where user_id = $1`,
      [U1],
    )
    expect(codes?.n).toBe(0)
  })
})
