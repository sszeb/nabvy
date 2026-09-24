import {
  events,
  SpendGovernorBudget,
  SpendGovernorBudgetAlertedEvent,
  SpendGovernorThrottle,
} from '@nabvy/contracts/modules/spend-governor'
import { vBudgets, vThrottle } from '@nabvy/db/schema/spend-governor'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readBudgets, readThrottle, recompute } from '../src'
import { ALL_ON, createTestDatabase, seed, type TestDatabase } from './support/database'

let t: TestDatabase
let alerts: unknown[] = []
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const now = new Date().toISOString()
  await seed(t, {
    calls: [{ refId: 'r1', reservedMicros: 70_000_000, settledMicros: 70_000_000, at: now }],
  })
  const result = await recompute(t.db, { now, usdGbpRate: 0.75 })
  alerts = result.ok ? result.value.events : []
})
afterAll(async () => {
  await t.close()
})

const columns = (view: Parameters<typeof getViewConfig>[0]) =>
  Object.keys(getViewConfig(view).selectedFields).sort()

describe('contracts', () => {
  it('publishes one event, budget-alerted v1', () => {
    expect(Object.keys(events.definitions)).toEqual(['spend-governor.budget-alerted'])
  })

  it('declares the views with exactly the contract fields', () => {
    expect(columns(vBudgets)).toEqual(Object.keys(SpendGovernorBudget.shape).sort())
    expect(columns(vThrottle)).toEqual(Object.keys(SpendGovernorThrottle.shape).sort())
  })

  it('returns view rows that parse', async () => {
    const budgets = await readBudgets(t.db)
    expect(budgets.map((b) => b.name)).toEqual([
      'apify-monthly',
      'apify-plan-usage',
      'apify-residential-proxy',
    ])
    expect(budgets[1]).toMatchObject({ limitMicros: 85_000_000, remainingMicros: 15_000_000 })
    const throttle = await readThrottle(t.db)
    expect(throttle.level).toBe('slow-free')
    expect(throttle.budgets).toHaveLength(3)
  })

  it('emits alerts whose payload parses and carries identifiers and times only', () => {
    expect(alerts).toHaveLength(1)
    const [alert] = alerts as { payload: unknown }[]
    expect(Object.keys(SpendGovernorBudgetAlertedEvent.parse(alert?.payload))).toEqual([
      'budget',
      'level',
      'periodStart',
    ])
  })
})
