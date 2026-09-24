import { vBillingSignals } from '@nabvy/db/schema/subscriptions'
import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createStripeWebhookRoute,
  getEntitlement,
  grantDueAllowances,
  processStripeEvent,
} from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'
import { harness, stripeEvent, USER } from './support/ladder'

// Stripe webhooks on the real migrations: the entitlement lifecycle, allowances, top-ups,
// signals, ordering, failures and the signature check. Events are the recorded (synthetic)
// fixtures in test/fixtures/stripe/.

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await setSwitch(db, 'on', 'usage-ledger')
  await addUsers(db, USER)
}, 60_000)
afterEach(() => db.close())

const buckets = (userId = USER) =>
  db.sql(
    `select e.kind, e.ref_id, e.credits, e.cash_minor, e.expires_at, e.policy_version
       from usage_ledger.entries e where e.user_id = $1 order by e.at, e.ref_id`,
    [userId],
  )

describe('subscription lifecycle', () => {
  it('trial → active with extra areas → past due → cancel at period end → deleted', async () => {
    const h = harness(db)
    const run = (name: string) => processStripeEvent(stripeEvent(name) as never, h)

    await run('customer-created')
    await run('sub-created-trialing')
    expect(await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER))).toMatchObject({
      tier: 'pro',
      status: 'trialing',
      areas: 3,
      trialEnd: '2030-10-08T00:00:00.000Z',
      policyVersion: 'test-ladder@1',
    })
    await run('sub-updated-active')
    expect(await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER))).toMatchObject({
      status: 'active',
      areas: 5,
      wants: 20,
      baseCadenceSeconds: 1800,
      floorCadenceSeconds: 300,
      trialEnd: null,
    })
    await run('sub-updated-past-due')
    expect((await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER))).status).toBe('past_due')
    await run('sub-updated-cancel-at-end')
    expect(await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER))).toMatchObject({
      status: 'active',
      tier: 'pro',
      cancelAtPeriodEnd: true,
      periodEnd: '2030-12-08T00:00:00.000Z',
    })
    await run('sub-deleted')
    expect(await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER))).toMatchObject({
      tier: 'free',
      status: 'free',
      areas: 1,
      wants: 1,
      periodEnd: null,
      cancelAtPeriodEnd: false,
    })
    expect(h.publisher.ofType('subscriptions.entitlement-changed')).toHaveLength(5)
    expect(h.publisher.ofType('subscriptions.webhook-failed')).toHaveLength(0)
  })

  it('a deleted subscription is terminal: a same-second update never restores the plan', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('sub-updated-cancel-at-end') as never, h)
    await processStripeEvent(stripeEvent('sub-deleted') as never, h)
    const r = await processStripeEvent(stripeEvent('sub-updated-after-deleted') as never, h)
    expect(r.outcome).toBe('stale')
    expect((await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER))).status).toBe('free')
  })

  it('an older event never overwrites a newer one', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('sub-updated-cancel-at-end') as never, h)
    const stale = await processStripeEvent(stripeEvent('sub-updated-stale') as never, h)
    expect(stale).toMatchObject({ changed: true, outcome: 'stale' })
    expect((await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER))).tier).toBe('pro')
  })

  it('an unknown plan fails, rolls back, alerts ops and throws so Stripe retries', async () => {
    const h = harness(db)
    await expect(processStripeEvent(stripeEvent('sub-unknown-plan') as never, h)).rejects.toThrow(
      'unknown_plan',
    )
    expect(h.publisher.ofType('subscriptions.webhook-failed')[0]?.payload).toEqual({
      stripeEventId: 'evt_TestSubUnknownPlan',
      reason: 'unknown_plan',
    })
    expect(await db.sql('select count(*)::int as n from subscriptions.billing_events')).toEqual([
      { n: 0 },
    ])
    expect(await db.sql('select count(*)::int as n from subscriptions.entitlements')).toEqual([
      { n: 0 },
    ])
  })

  it('a trial that account-integrity refuses ends at once', async () => {
    const h = harness(db, { trialEligible: async () => false })
    await processStripeEvent(stripeEvent('sub-created-trialing') as never, h)
    expect(h.stripe.endedTrials).toEqual(['sub_TestC1'])
    expect(h.stripe.trialKeys).toEqual(['end-trial:evt_TestSubCreatedTrial'])
  })

  it('with pricing-console absent (the stub), a paid subscription fails as unknown_plan', async () => {
    const h = harness(db, { ladder: { plans: async () => [] } })
    await expect(
      processStripeEvent(stripeEvent('sub-updated-active') as never, h),
    ).rejects.toThrow()
  })
})

describe('allowances and top-ups through usage-ledger', () => {
  it('a renewal invoice grants the monthly bundle once, valued by policy, net of tax', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('sub-updated-active') as never, h)
    await processStripeEvent(stripeEvent('invoice-paid-cycle') as never, h)
    expect(await buckets()).toEqual([
      {
        kind: 'allowance',
        ref_id: 'allowance:sub_TestC1@2030-10-08T00:00:00.000Z',
        credits: 6000,
        cash_minor: 2417,
        expires_at: new Date('2030-11-08T00:00:00Z'),
        policy_version: 'test-usage@1',
      },
    ])
    // The sweep finds the same window already granted.
    const swept = await db.as('nabvy_pipeline', (q) =>
      grantDueAllowances(q, { now: new Date('2030-10-20T00:00:00Z'), usagePolicy: h.usagePolicy }),
    )
    expect(swept).toEqual({ granted: 0, unchanged: 1, refused: 0, next: null })
  })

  it('an invoice before its subscription event fails as out_of_order and is retried', async () => {
    const h = harness(db)
    await expect(
      processStripeEvent(stripeEvent('invoice-paid-cycle') as never, h),
    ).rejects.toThrow()
    expect(h.publisher.ofType('subscriptions.webhook-failed')[0]?.payload.reason).toBe(
      'out_of_order',
    )
    await processStripeEvent(stripeEvent('sub-updated-active') as never, h)
    await processStripeEvent(stripeEvent('invoice-paid-cycle') as never, h)
    expect(await buckets()).toHaveLength(1)
  })

  it('without a usage policy the cash is recorded, ops hears, and the sweep grants later', async () => {
    const stub = harness(db, {
      usagePolicy: { bundleCredits: async () => null, topupCredits: async () => null },
    })
    await processStripeEvent(stripeEvent('sub-updated-active') as never, stub)
    const r = await processStripeEvent(stripeEvent('invoice-paid-cycle') as never, stub)
    expect(r.outcome).toBe('recorded')
    expect(stub.publisher.ofType('subscriptions.webhook-failed')[0]?.payload.reason).toBe(
      'no_policy',
    )
    expect(await buckets()).toEqual([])
    const swept = await db.as('nabvy_pipeline', (q) =>
      grantDueAllowances(q, {
        now: new Date('2030-10-20T00:00:00Z'),
        usagePolicy: harness(db).usagePolicy,
      }),
    )
    expect(swept.granted).toBe(1)
  })

  it('an annual plan gets a monthly allowance from the sweep', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('sub-updated-annual') as never, h)
    await db.sql(
      `update subscriptions.entitlements set period_cash_minor = 24170, cash_period_start = period_start`,
    )
    const swept = await db.as('nabvy_pipeline', (q) =>
      grantDueAllowances(q, { now: new Date('2031-02-15T00:00:00Z'), usagePolicy: h.usagePolicy }),
    )
    expect(swept.granted).toBe(1)
    expect(await buckets()).toMatchObject([
      {
        ref_id: 'allowance:sub_TestC1@2031-02-10T00:00:00.000Z',
        cash_minor: 2014,
        expires_at: new Date('2031-03-10T00:00:00Z'),
      },
    ])
  })

  it('a late renewal invoice after deletion grants nothing and leaves the period alone', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('sub-updated-active') as never, h)
    await processStripeEvent(stripeEvent('sub-deleted') as never, h)
    const r = await processStripeEvent(stripeEvent('invoice-paid-cycle') as never, h)
    expect(r.outcome).toBe('recorded')
    expect(await buckets()).toEqual([])
    expect(
      await db.sql('select period_cash_minor, period_start from subscriptions.entitlements'),
    ).toEqual([{ period_cash_minor: null, period_start: null }])
  })

  it('an unpaid top-up (delayed method) grants nothing until its async payment succeeds', async () => {
    const h = harness(db)
    const unpaid = await processStripeEvent(stripeEvent('checkout-topup-unpaid') as never, h)
    expect(unpaid.outcome).toBe('recorded')
    expect(await buckets()).toEqual([])
    await processStripeEvent(stripeEvent('checkout-topup-async-paid') as never, h)
    await processStripeEvent(stripeEvent('checkout-topup-async-paid') as never, h)
    expect(await buckets()).toMatchObject([
      { kind: 'topup', ref_id: 'pi_TestC1TopupBacs', credits: 833 },
    ])
  })

  it('a paid top-up Checkout becomes credit once, with its consent stored', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('checkout-topup') as never, h)
    await processStripeEvent(stripeEvent('checkout-topup') as never, h)
    expect(await buckets()).toMatchObject([
      { kind: 'topup', ref_id: 'pi_TestC1Topup', credits: 833, cash_minor: 833 },
    ])
    expect(
      await db.sql(
        `select consent_start_now, consent_at from subscriptions.billing_events where checkout_session_id = 'cs_TestC1Topup'`,
      ),
    ).toEqual([{ consent_start_now: true, consent_at: new Date('2030-10-12T14:58:00Z') }])
  })
})

describe('billing signals', () => {
  it('records failed payments, card fingerprints and disputes against the user', async () => {
    const h = harness(db)
    await processStripeEvent(stripeEvent('customer-created') as never, h)
    await processStripeEvent(stripeEvent('charge-succeeded') as never, h)
    await processStripeEvent(stripeEvent('invoice-payment-failed') as never, h)
    await processStripeEvent(stripeEvent('dispute-created') as never, h)
    expect(await db.as('nabvy_pipeline', (q) => q.select().from(vBillingSignals))).toEqual([
      {
        userId: USER,
        failedPayments: 1,
        disputes: 1,
        lastFailedPaymentAt: new Date('2030-11-08T00:30:00Z'),
        lastDisputeAt: new Date('2030-10-20T10:00:00Z'),
        cardFingerprints: ['fpTestCard0001'],
      },
    ])
  })

  it('a charge from an unknown customer is retried, never guessed', async () => {
    const h = harness(db)
    await expect(processStripeEvent(stripeEvent('charge-succeeded') as never, h)).rejects.toThrow()
    expect(h.publisher.ofType('subscriptions.webhook-failed')[0]?.payload.reason).toBe(
      'unknown_customer',
    )
  })

  it('ignores event types it does not use, but records them for idempotency', async () => {
    const r = await processStripeEvent(stripeEvent('unhandled-type') as never, harness(db))
    expect(r).toMatchObject({ changed: true, outcome: 'ignored' })
  })
})

describe('the webhook route', () => {
  const secret = 'whsec_test_not_a_real_secret'
  const stripe = new Stripe('sk_test_x')
  const signed = (body: string, key = secret) =>
    stripe.webhooks.generateTestHeaderString({ payload: body, secret: key })

  it('refuses a bad signature with 400, alerts ops without an event ID, and forwards nothing', async () => {
    const h = harness(db)
    const forwarded: Request[] = []
    const route = createStripeWebhookRoute({
      stripe,
      webhookSecret: secret,
      forward: async (r) => {
        forwarded.push(r)
        return new Response('ok')
      },
      transaction: h.transaction,
      publisher: h.publisher,
    })
    const body = JSON.stringify(stripeEvent('sub-updated-active'))
    const bad = await route(
      new Request('https://nabvy.test/api/auth/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': signed(body, 'whsec_wrong') },
        body,
      }),
    )
    expect(bad.status).toBe(400)
    expect(await bad.text()).not.toContain(secret)
    expect(forwarded).toHaveLength(0)
    expect(h.publisher.ofType('subscriptions.webhook-failed')[0]?.payload).toEqual({
      stripeEventId: null,
      reason: 'signature',
    })

    const good = await route(
      new Request('https://nabvy.test/api/auth/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': signed(body) },
        body,
      }),
    )
    expect(good.status).toBe(200)
    expect(forwarded).toHaveLength(1)
    expect(await forwarded[0]?.text()).toBe(body)
  })

  it('refuses a signature older than the tolerance (a replayed capture)', async () => {
    const h = harness(db)
    const route = createStripeWebhookRoute({
      stripe,
      webhookSecret: secret,
      forward: async () => new Response('ok'),
      transaction: h.transaction,
      publisher: h.publisher,
    })
    const body = JSON.stringify(stripeEvent('sub-updated-active'))
    const old = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    })
    const res = await route(
      new Request('https://nabvy.test/x', {
        method: 'POST',
        headers: { 'stripe-signature': old },
        body,
      }),
    )
    expect(res.status).toBe(400)
  })
})
