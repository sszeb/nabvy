import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addItem, itemsFor, recordSale } from '../../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from '../support/database'

// Stage "record": a sequence of addItem/recordSale calls by one user, synthetic (no recorded
// Facebook run needed: this module never reads listing content, only what the user typed). Each
// case checks the outcome of every call, the rows written and what the user reads back through
// app.v_inventory_items. Cases with a listing or a scan live in test/rls.test.ts, where the
// other modules' rows are seeded.

interface AddAction {
  kind: 'add'
  itemId: string
  productKey: string
  cost: { amountMinor: number; currency: 'GBP' | 'EUR' }
  boughtAt: string
}
interface SellAction {
  kind: 'sell'
  itemId: string
  sold: { amountMinor: number; currency: 'GBP' | 'EUR' }
  soldAt: string
  soldOn?: 'ebay' | 'facebook' | 'gumtree' | 'vinted' | 'cex'
}
interface Input {
  userId: string
  /** The server clock every call runs at (`YYYY-MM-DD`). */
  today: string
  actions: (AddAction | SellAction)[]
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('record', () => {
  for (const id of cases) {
    it(id, async () => {
      const input = read(new URL(`${id}/input.json`, CASES)) as Input
      const expected = read(new URL(`${id}/expected.json`, CASES))
      const now = new Date(`${input.today}T12:00:00.000Z`)

      await seedUser(t, input.userId, `${id}@example.com`)
      await setSwitches(t, ALL_ON)

      const results: string[] = []
      for (const action of input.actions) {
        if (action.kind === 'add') {
          const { kind: _kind, ...form } = action
          const outcome = await t.as(
            'nabvy_app',
            (q) => addItem(q, { ...form, userId: input.userId }, { now }),
            input.userId,
          )
          results.push(
            outcome.ok ? (outcome.value.created ? 'created' : 'exists') : outcome.error.code,
          )
        } else {
          const { kind: _kind, ...form } = action
          const outcome = await t.as(
            'nabvy_app',
            (q) => recordSale(q, { ...form, userId: input.userId }, { now }),
            input.userId,
          )
          results.push(
            outcome.ok ? (outcome.value.changed ? 'changed' : 'unchanged') : outcome.error.code,
          )
        }
      }

      const [{ n }] = (await t.sql(
        `select count(*)::int as n from inventory.items where user_id = $1`,
        [input.userId],
      )) as [{ n: number }]
      const items = (await t.as('nabvy_app', (q) => itemsFor(q), input.userId)).map((item) => ({
        id: item.id,
        costMinor: item.costMinor,
        soldMinor: item.soldMinor,
        soldAt: item.soldAt,
        soldOn: item.soldOn,
        profitMinor: item.profitMinor,
      }))

      expect({ results, rows: n, items }).toEqual(expected)
    })
  }
})
