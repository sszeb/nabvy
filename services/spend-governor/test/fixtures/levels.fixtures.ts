import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type BudgetDef,
  committedMoney,
  committedProxy,
  floatToMicros,
  type LedgerCall,
  londonMonth,
  nextState,
  type UnmeteredRun,
} from '../../src/domain'
import { selectBudgets } from '../../src/repo'
import { createTestDatabase } from '../support/database'

// Stage "levels": each case is a synthetic month of spend (ledger calls, gateway runs not yet in
// the ledger, settled runs' proxy GB) run through the governor's pure rules against the budgets
// its migration seeds. Proxy GB is synthetic because the gateway does not publish it yet.

type Json = Record<string, unknown>
interface Input {
  now: string
  usdGbpRate: number
  calls: (Omit<LedgerCall, 'at'> & { at: string })[]
  unmetered: (Omit<UnmeteredRun, 'createdAt'> & { createdAt: string })[]
  proxyGb: (number | null)[]
}
interface Expected {
  budgets: Record<string, { committedMicros: number | null; level: string }>
}

const CASES = new URL('./cases/levels/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8')) as Json
const cases = readdirSync(CASES).sort()

let budgets: BudgetDef[] = []
beforeAll(async () => {
  const t = await createTestDatabase()
  budgets = await selectBudgets(t.db)
  await t.close()
})
afterAll(() => undefined)

describe('levels', () => {
  it.each(cases)('%s', (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as unknown as Input
    const expected = read(new URL(`${id}/expected.json`, CASES)) as unknown as Expected
    const now = new Date(input.now)
    const period = londonMonth(now)
    const calls = input.calls.map((c) => ({ ...c, at: new Date(c.at) }))
    const unmetered = input.unmetered.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }))
    const proxy = input.proxyGb.map((gb) => ({
      proxyGbMicros: gb === null ? null : floatToMicros(gb),
    }))

    const got: Expected['budgets'] = {}
    for (const budget of budgets) {
      const committed =
        budget.unit === 'GB'
          ? committedProxy(proxy)
          : committedMoney(budget, period, calls, unmetered, input.usdGbpRate)
      const state = nextState(budget, committed, period, now)
      got[budget.name] = { committedMicros: state.committedMicros, level: state.level }
    }
    expect(got).toEqual(expected.budgets)
  })
})
