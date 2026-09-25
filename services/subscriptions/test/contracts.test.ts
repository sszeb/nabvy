import { readdirSync } from 'node:fs'
import { EventEnvelope } from '@nabvy/contracts'
import {
  events,
  SubscriptionsCheckoutInput,
  SubscriptionsEntitlement,
  SubscriptionsLadderPlan,
  SubscriptionsPlan,
  SubscriptionsStripeEvent,
  SubscriptionsWebhookFailedEvent,
} from '@nabvy/contracts/modules/subscriptions'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEntitlement, processStripeEvent } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'
import { harness, stripeEvent, TEST_LADDER, testLadder, USER } from './support/ladder'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await addUsers(db, USER)
}, 60_000)
afterAll(() => db.close())

describe('contracts', () => {
  it('declares its two events under its own name', () => {
    expect(events.module).toBe('subscriptions')
    expect(Object.keys(events.definitions).sort()).toEqual([
      'subscriptions.entitlement-changed',
      'subscriptions.webhook-failed',
    ])
  })

  it('every recorded Stripe event parses as a Stripe event', () => {
    const dir = new URL('./fixtures/stripe/', import.meta.url)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      expect(
        SubscriptionsStripeEvent.safeParse(stripeEvent(file.replace('.json', ''))).success,
      ).toBe(true)
    }
  })

  it('published events and entitlements parse; payloads carry identifiers only', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('sub-updated-active') as never, h)
    await expect(processStripeEvent(stripeEvent('sub-unknown-plan') as never, h)).rejects.toThrow()
    for (const envelope of h.publisher.published) {
      EventEnvelope.parse(envelope)
      expect(
        Object.keys(envelope.payload).every((k) =>
          ['userId', 'stripeEventId', 'reason'].includes(k),
        ),
      ).toBe(true)
    }
    SubscriptionsEntitlement.parse(
      await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER, testLadder)),
    )
  })

  it('a webhook failure may carry no event ID (unverified), only a reason code', () => {
    expect(
      SubscriptionsWebhookFailedEvent.parse({ stripeEventId: null, reason: 'signature' }),
    ).toBeTruthy()
    expect(
      SubscriptionsWebhookFailedEvent.safeParse({ stripeEventId: 'x', reason: 'signature' })
        .success,
    ).toBe(false)
  })

  it('the Checkout input requires the tick to be exactly true', () => {
    expect(SubscriptionsCheckoutInput.safeParse({ plan: 'pro', startNow: true }).success).toBe(true)
    expect(SubscriptionsCheckoutInput.safeParse({ plan: 'pro', startNow: 'true' }).success).toBe(
      false,
    )
    expect(SubscriptionsCheckoutInput.safeParse({ plan: 'pro' }).success).toBe(false)
  })

  it('the ladder rows parse, and the user-facing plan has no internal fields', () => {
    for (const row of TEST_LADDER) SubscriptionsLadderPlan.parse(row)
    expect(Object.keys(SubscriptionsPlan.shape)).not.toContain('policyVersion')
    expect(Object.keys(SubscriptionsPlan.shape)).not.toContain('userId')
  })
})
