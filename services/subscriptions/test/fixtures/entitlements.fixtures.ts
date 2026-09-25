import { readdirSync, readFileSync } from 'node:fs'
import type { EventEnvelope } from '@nabvy/contracts'
import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  getEntitlement,
  getPlan,
  processStripeEvent,
  startCheckout,
  stripePluginOptions,
} from '../../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from '../support/database'
import { type Harness, harness, stripeEvent, testLadder, USER } from '../support/ladder'

// Stage `entitlements`: the card's four tests (entitlement matrix; webhook replay; Checkout
// refused without the "Start my plan now" tick; v_billing_signals never user-facing) as
// scripted, synthetic cases on the real migrations, each on a fresh database. Webhooks run as
// the pipeline; Checkout and reads as the web app inside withUser.

const Step = z.union([
  z.strictObject({ event: z.string() }),
  z.strictObject({
    checkout: z.strictObject({ plan: z.string(), startNow: z.boolean().optional() }),
  }),
  z.strictObject({ plugin: z.strictObject({ tick: z.boolean() }) }),
  z.strictObject({
    read: z.strictObject({
      role: z.enum(['nabvy_app', 'nabvy_pipeline']),
      view: z.enum(['v_billing_signals', 'v_entitlements', 'billing_events', 'entitlements']),
    }),
  }),
  z.strictObject({ plan: z.literal(true) }),
])
const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  steps: z.array(Step).min(1),
})
const Expected = z.strictObject({
  outcomes: z.array(z.record(z.string(), z.unknown())),
  published: z.record(z.string(), z.number().int()),
  grants: z.record(z.string(), z.number().int()).optional(),
  billingEvents: z.number().int().optional(),
  consent: z
    .array(z.strictObject({ session: z.string(), startNow: z.boolean(), at: z.string() }))
    .optional(),
})

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

let db: TestDatabase
let h: Harness
beforeEach(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await setSwitch(db, 'on', 'usage-ledger')
  await addUsers(db, USER)
  h = harness(db)
}, 60_000)
afterEach(() => db.close())

async function runStep(step: z.infer<typeof Step>): Promise<Record<string, unknown>> {
  if ('event' in step) {
    try {
      const r = await processStripeEvent(stripeEvent(step.event) as never, h)
      const e = await db.as('nabvy_pipeline', (q) => getEntitlement(q, USER, testLadder))
      return { outcome: r.outcome, tier: e.tier, status: e.status, areas: e.areas }
    } catch {
      const failed = h.publisher.ofType('subscriptions.webhook-failed').at(-1) as EventEnvelope
      return { failed: failed.payload.reason }
    }
  }
  if ('checkout' in step) {
    const r = await db.as(
      'nabvy_app',
      (q) => startCheckout(q, USER, step.checkout as never, testLadder),
      USER,
    )
    return r.ok ? { ok: true } : { refused: r.error.code }
  }
  if ('plugin' in step) {
    const options = stripePluginOptions({
      ...h,
      stripeClient: new Stripe('sk_test_x'),
      webhookSecret: 'whsec_test_not_a_real_secret',
    })
    const params = options.subscription?.enabled
      ? options.subscription.getCheckoutSessionParams
      : undefined
    if (!params) throw new Error('plugin has no Checkout hook')
    const metadata = step.plugin.tick ? { nabvy_start_now_at: new Date().toISOString() } : {}
    try {
      await params(
        { user: { id: USER }, session: {}, plan: {}, subscription: {} } as never,
        undefined,
        {
          body: { plan: 'pro', metadata },
        } as never,
      )
      return { ok: true }
    } catch (error) {
      return { refused: (error as { body?: { code?: string } }).body?.code ?? String(error) }
    }
  }
  if ('read' in step) {
    const { role, view } = step.read
    try {
      const rows = await db.as(
        role,
        async (q) => (await q.execute(`select * from subscriptions.${view}`)).rows,
        role === 'nabvy_app' ? USER : undefined,
      )
      return { rows: rows.length }
    } catch {
      return { denied: true }
    }
  }
  const plan = await db.as('nabvy_app', (q) => getPlan(q, USER, testLadder), USER)
  return { keys: Object.keys(plan).sort() }
}

describe('entitlements', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const outcomes: Record<string, unknown>[] = []
    for (const step of input.steps) outcomes.push(await runStep(step))
    expect(outcomes).toEqual(expected.outcomes)

    const published: Record<string, number> = {}
    for (const e of h.publisher.published) published[e.type] = (published[e.type] ?? 0) + 1
    expect(published).toEqual(expected.published)

    if (expected.grants) {
      const rows = await db.sql(
        `select kind, count(*)::int as n from usage_ledger.entries where user_id = $1 group by kind`,
        [USER],
      )
      expect(Object.fromEntries(rows.map((r) => [r.kind, r.n]))).toEqual(expected.grants)
    }
    if (expected.billingEvents !== undefined) {
      const [row] = await db.sql('select count(*)::int as n from subscriptions.billing_events')
      expect(row?.n).toBe(expected.billingEvents)
    }
    if (expected.consent) {
      const rows = await db.sql(
        `select checkout_session_id, consent_start_now, consent_at from subscriptions.billing_events
          where checkout_session_id is not null order by checkout_session_id`,
      )
      expect(
        rows.map((r) => ({
          session: r.checkout_session_id,
          startNow: r.consent_start_now,
          at: (r.consent_at as Date).toISOString(),
        })),
      ).toEqual(expected.consent)
    }
  })
})
