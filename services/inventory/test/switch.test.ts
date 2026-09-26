import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addItem, itemsFor, recordSale } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md. Off: inventory is unavailable, nothing is written,
// and both views are empty. Shadow: recording still writes (a write is a command the user asked
// for, never a read), the internal view has rows, and the user-facing view has none. Nothing here
// moves money or sends to a user, so no state requires `on` beyond the user-facing view.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const ITEM = '0190f1d2-0000-7000-8000-0000000000a1'
const NOW = new Date('2026-09-25T12:00:00.000Z')
const GPU = 'gpu:nvidia:rtx-3090'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const rows = (result: unknown) => (result as { rows: unknown[] }).rows
const internal = () => db.as('nabvy_pipeline', (q) => q.execute('select * from inventory.v_items'))
const userFacing = () =>
  db.as('nabvy_app', (q) => q.execute('select * from app.v_inventory_items'), U1)
const purchase = {
  itemId: ITEM,
  userId: U1,
  productKey: GPU,
  cost: { amountMinor: 12000, currency: 'GBP' as const },
  boughtAt: '2026-09-20',
}

describe('switch', () => {
  it('off: refuses addItem and recordSale, writes nothing, and both views are empty', async () => {
    await setSwitches(db, { inventory: 'off' })
    const added = await db.as('nabvy_app', (q) => addItem(q, purchase, { now: NOW }), U1)
    expect(added.ok ? 'ok' : added.error.code).toBe('inventory.off')
    const sold = await db.as(
      'nabvy_app',
      (q) =>
        recordSale(
          q,
          {
            userId: U1,
            itemId: ITEM,
            sold: { amountMinor: 1, currency: 'GBP' },
            soldAt: '2026-09-24',
          },
          { now: NOW },
        ),
      U1,
    )
    expect(sold.ok ? 'ok' : sold.error.code).toBe('inventory.off')
    const [{ n }] = (await db.sql(`select count(*)::int as n from inventory.items`)) as [
      { n: number },
    ]
    expect(n).toBe(0)
    expect(rows(await internal())).toHaveLength(0)
    expect(rows(await userFacing())).toHaveLength(0)
    expect(await db.as('nabvy_app', (q) => itemsFor(q), U1)).toHaveLength(0)
  })

  it('shadow: recording writes, the internal view has rows, the user-facing view has none', async () => {
    await setSwitches(db, { inventory: 'shadow' })
    const added = await db.as('nabvy_app', (q) => addItem(q, purchase, { now: NOW }), U1)
    expect(added.ok).toBe(true)
    expect(rows(await internal()).length).toBeGreaterThan(0)
    expect(rows(await userFacing())).toHaveLength(0)
  })

  it('on: the user sees their own items', async () => {
    expect(rows(await userFacing()).length).toBeGreaterThan(0)
  })
})
