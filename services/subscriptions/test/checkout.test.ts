import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  pendingPricingConsoleLadder,
  processStripeEvent,
  startCheckout,
  startTopup,
  stripePluginOptions,
} from '../src'
import { toStripePlans } from '../src/handlers/plugin'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'
import {
  fakeStripe,
  harness,
  stripeEvent,
  TEST_LADDER,
  testLadder,
  testUsagePolicy,
  USER,
} from './support/ladder'

// Checkout: the gate (switch, standing, tick), plans from the ladder policy only, the top-up
// Checkout, and the plugin options (docs/billing.md, "Flows"; docs/decisions.md, "No refunds").

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await addUsers(db, USER)
}, 60_000)
afterEach(() => db.close())

describe('startCheckout', () => {
  it('returns the plugin body with the tick time; prices never leave the ladder', async () => {
    const now = new Date('2030-10-01T00:00:00Z')
    const r = await db.as(
      'nabvy_app',
      (q) => startCheckout(q, USER, { plan: 'pro', annual: true, startNow: true }, testLadder, now),
      USER,
    )
    expect(r).toEqual({
      ok: true,
      value: {
        plan: 'pro',
        annual: true,
        metadata: { nabvy_start_now_at: '2030-10-01T00:00:00.000Z' },
      },
    })
  })

  it('refuses a plan the ladder does not sell, an annual price it lacks, and Free', async () => {
    for (const input of [
      { plan: 'max', startNow: true },
      { plan: 'starter', annual: true, startNow: true },
      { plan: 'free', startNow: true },
    ] as const) {
      const r = await db.as('nabvy_app', (q) => startCheckout(q, USER, input, testLadder), USER)
      expect(r).toMatchObject({ ok: false, error: { code: 'subscriptions.unknown_plan' } })
    }
  })

  it('with pricing-console absent (the stub) nothing is on sale', async () => {
    const r = await db.as(
      'nabvy_app',
      (q) => startCheckout(q, USER, { plan: 'pro', startNow: true }, pendingPricingConsoleLadder),
      USER,
    )
    expect(r).toMatchObject({ ok: false, error: { code: 'subscriptions.no_policy' } })
  })

  it('a suspended or banned account cannot reach Checkout, and is not told why', async () => {
    await db.sql(`update better_auth."user" set banned = true where id = $1`, [USER])
    const r = await db.as(
      'nabvy_app',
      (q) => startCheckout(q, USER, { plan: 'pro', startNow: true }, testLadder),
      USER,
    )
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'subscriptions.account_inactive',
        message: 'This account cannot start a plan right now.',
      },
    })
  })
})

describe('startTopup', () => {
  it('opens a payment Checkout with the required tick, the tick time and the pack price', async () => {
    const stripe = fakeStripe()
    const now = new Date('2030-10-12T14:58:00Z')
    const r = await db.as(
      'nabvy_app',
      (q) =>
        startTopup(
          q,
          USER,
          { packPounds: 10, startNow: true },
          {
            stripe,
            topupPrices: {
              5: 'price_TestTopup5',
              10: 'price_TestTopup10',
              25: 'price_TestTopup25',
            },
            usagePolicy: testUsagePolicy,
            ladder: testLadder,
            successUrl: 'https://nabvy.test/ok',
            cancelUrl: 'https://nabvy.test/back',
          },
          now,
        ),
      USER,
    )
    expect(r.ok).toBe(true)
    expect(stripe.sessions[0]).toMatchObject({
      mode: 'payment',
      line_items: [{ price: 'price_TestTopup10', quantity: 1 }],
      consent_collection: { terms_of_service: 'required' },
      custom_text: {
        terms_of_service_acceptance: {
          message: 'Start my plan now. Payments are non-refundable, except where required by law.',
        },
      },
      client_reference_id: USER,
      metadata: {
        userId: USER,
        nabvy_kind: 'topup',
        nabvy_start_now_at: '2030-10-12T14:58:00.000Z',
      },
      customer_creation: 'always',
    })
  })

  it('refuses without the tick, and without a policy to value the pack', async () => {
    const deps = {
      stripe: fakeStripe(),
      topupPrices: { 5: 'price_A', 10: 'price_B', 25: 'price_C' },
      successUrl: 'https://nabvy.test/ok',
      cancelUrl: 'https://nabvy.test/back',
    }
    const noTick = await db.as(
      'nabvy_app',
      (q) => startTopup(q, USER, { packPounds: 5 } as never, deps),
      USER,
    )
    expect(noTick).toMatchObject({ ok: false, error: { code: 'subscriptions.start_now_required' } })
    const noPolicy = await db.as(
      'nabvy_app',
      (q) => startTopup(q, USER, { packPounds: 5, startNow: true }, deps),
      USER,
    )
    expect(noPolicy).toMatchObject({ ok: false, error: { code: 'subscriptions.no_policy' } })
    expect(deps.stripe.sessions).toHaveLength(0)
  })
})

describe('plugin options', () => {
  const options = (h = harness(db)) =>
    stripePluginOptions({
      ...h,
      stripeClient: new Stripe('sk_test_x'),
      webhookSecret: 'whsec_test_not_a_real_secret',
    })

  it("offers the ladder's sellable plans only, with their trial and price IDs", () => {
    expect(
      toStripePlans(TEST_LADDER).map((p) => [
        p.name,
        p.priceId,
        p.annualDiscountPriceId,
        p.freeTrial,
      ]),
    ).toEqual([
      ['starter', 'price_TestStarter', undefined, { days: 7 }],
      ['pro', 'price_TestPro', 'price_TestProAnnual', undefined],
    ])
  })

  it('lets a user act only for themselves', async () => {
    const sub = options().subscription
    if (!sub?.enabled || !sub.authorizeReference) throw new Error('no authorizeReference')
    const call = (referenceId: string) =>
      sub.authorizeReference?.(
        { user: { id: USER }, session: {}, referenceId, action: 'upgrade-subscription' } as never,
        {} as never,
      )
    expect(await call(USER)).toBe(true)
    expect(await call('00000000-0000-4000-8000-0000000000c2')).toBe(false)
  })

  it('onEvent processes the event, idempotently', async () => {
    const h = harness(db)
    const onEvent = options(h).onEvent
    await onEvent?.(stripeEvent('sub-updated-active') as never)
    await onEvent?.(stripeEvent('sub-updated-active') as never)
    expect(await db.sql('select count(*)::int as n from subscriptions.billing_events')).toEqual([
      { n: 1 },
    ])
    expect(h.publisher.ofType('subscriptions.entitlement-changed')).toHaveLength(1)
  })

  it('onEvent rethrows a failure, so the plugin answers non-2xx and Stripe retries', async () => {
    await expect(options().onEvent?.(stripeEvent('sub-unknown-plan') as never)).rejects.toThrow()
  })

  it('processStripeEvent refuses a malformed event and alerts ops', async () => {
    const h = harness(db)
    await expect(processStripeEvent({ id: 'nope' } as never, h)).rejects.toThrow()
    expect(h.publisher.ofType('subscriptions.webhook-failed')[0]?.payload).toEqual({
      stripeEventId: null,
      reason: 'processing',
    })
  })
})
