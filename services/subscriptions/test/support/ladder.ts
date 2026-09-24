import { readFileSync } from 'node:fs'
import type { SubscriptionsLadderPlan } from '@nabvy/contracts/modules/subscriptions'
import { createMemoryPublisher, type MemoryPublisher } from '@nabvy/transport'
import type { UsageLedgerPolicy } from '@nabvy/usage-ledger'
import type { SubscriptionsLadderPolicy, SubscriptionsStripePort } from '../../src'
import type { StripeWebhookDeps } from '../../src/handlers/stripe'
import type { TestDatabase } from './database'

// Test doubles for the injected policies. The values are test values, not prices: they stand in
// for pricing-console's rows (docs/decisions.md, "Paid ladder") so the matrix has something to
// read. Price IDs match test/fixtures/stripe/.

export const USER = '00000000-0000-4000-8000-0000000000c1'

export const TEST_LADDER: SubscriptionsLadderPlan[] = [
  {
    plan: 'free',
    areas: 1,
    wants: 1,
    channels: ['telegram', 'email'],
    baseCadenceSeconds: null,
    floorCadenceSeconds: null,
    trialDays: null,
    stripePriceId: null,
    stripeAnnualPriceId: null,
    policyVersion: 'test-ladder@1',
  },
  {
    plan: 'starter',
    areas: 1,
    wants: 5,
    channels: ['telegram', 'email', 'push'],
    baseCadenceSeconds: 7200,
    floorCadenceSeconds: 3600,
    trialDays: 7,
    stripePriceId: 'price_TestStarter',
    stripeAnnualPriceId: null,
    policyVersion: 'test-ladder@1',
  },
  {
    plan: 'pro',
    areas: 3,
    wants: 20,
    channels: ['telegram', 'email', 'push'],
    baseCadenceSeconds: 1800,
    floorCadenceSeconds: 300,
    trialDays: null,
    stripePriceId: 'price_TestPro',
    stripeAnnualPriceId: 'price_TestProAnnual',
    policyVersion: 'test-ladder@1',
  },
]

export const testLadder: SubscriptionsLadderPolicy = { plans: async () => TEST_LADDER }

/** Test credit values standing in for pricing-console's bundle and top-up rows. */
export const testUsagePolicy: UsageLedgerPolicy = {
  bundleCredits: async (_q, plan) => ({
    credits: plan === 'pro' ? 6000 : 1200,
    policyVersion: 'test-usage@1',
  }),
  topupCredits: async (_q, _plan, cashMinor) => ({
    credits: cashMinor,
    policyVersion: 'test-usage@1',
  }),
}

export interface FakeStripe extends SubscriptionsStripePort {
  endedTrials: string[]
  sessions: unknown[]
}

export function fakeStripe(): FakeStripe {
  const endedTrials: string[] = []
  const sessions: unknown[] = []
  return {
    endedTrials,
    sessions,
    async endTrialNow(id) {
      endedTrials.push(id)
    },
    async createCheckoutSession(params) {
      sessions.push(params)
      return {
        id: `cs_TestCreated${sessions.length}`,
        url: 'https://checkout.stripe.com/c/pay/test',
      }
    },
  }
}

export interface Harness extends StripeWebhookDeps {
  publisher: MemoryPublisher
  stripe: FakeStripe
}

export function harness(db: TestDatabase, overrides: Partial<StripeWebhookDeps> = {}): Harness {
  return {
    transaction: (fn) => db.as('nabvy_pipeline', fn),
    publisher: createMemoryPublisher(),
    ladder: testLadder,
    usagePolicy: testUsagePolicy,
    trialEligible: async () => true,
    stripe: fakeStripe(),
    extraAreaPriceId: 'price_TestExtraArea',
    ...overrides,
  } as Harness
}

/** A recorded (synthetic) Stripe event from test/fixtures/stripe/. */
export function stripeEvent(name: string): Record<string, unknown> & { id: string; type: string } {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/stripe/${name}.json`, import.meta.url), 'utf8'),
  )
}
