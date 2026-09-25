import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addItem, recordSale } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md. The key of an item is the client's item ID; the key
// of an outcome is the item ID plus the sale as stored. Run twice, the second run writes nothing.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'
const NOW = new Date('2026-09-25T12:00:00.000Z')
const GPU = 'gpu:nvidia:rtx-3090'

let db: TestDatabase
let n = 0
const itemId = () => `0190f1d2-0000-7000-8000-0000000001${String(++n).padStart(2, '0')}`

beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const itemRows = async (userId: string) =>
  (
    (await db.sql(`select count(*)::int as n from inventory.items where user_id = $1`, [
      userId,
    ])) as [{ n: number }]
  )[0].n

const purchase = (id: string, userId = U1) => ({
  itemId: id,
  userId,
  productKey: GPU,
  cost: { amountMinor: 12000, currency: 'GBP' as const },
  boughtAt: '2026-09-20',
})
const sale = (id: string) => ({
  userId: U1,
  itemId: id,
  sold: { amountMinor: 15000, currency: 'GBP' as const },
  soldAt: '2026-09-24',
})

describe('idempotency', () => {
  it('the same purchase form sent twice writes one row', async () => {
    const id = itemId()
    const before = await itemRows(U1)
    const first = await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    const second = await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    if (!first.ok || !second.ok) throw new Error('addItem failed')
    expect(first.value.created).toBe(true)
    expect(second.value.created).toBe(false)
    expect(second.value.itemId).toBe(id)
    expect(await itemRows(U1)).toBe(before + 1)
  })

  it('the same item ID with different input is a conflict, and writes nothing', async () => {
    const id = itemId()
    await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    const before = await itemRows(U1)
    const other = await db.as(
      'nabvy_app',
      (q) =>
        addItem(
          q,
          { ...purchase(id), cost: { amountMinor: 13000, currency: 'GBP' } },
          { now: NOW },
        ),
      U1,
    )
    expect(other.ok ? 'ok' : other.error.code).toBe('inventory.conflict')
    expect(await itemRows(U1)).toBe(before)
  })

  it("another user's item ID is a conflict for them, never a row and never a read", async () => {
    const id = itemId()
    await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    const before = await itemRows(U2)
    const outcome = await db.as('nabvy_app', (q) => addItem(q, purchase(id, U2), { now: NOW }), U2)
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('inventory.conflict')
    expect(await itemRows(U2)).toBe(before)
  })

  it('the same sale recorded twice changes nothing and republishes the same key', async () => {
    const id = itemId()
    await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    const first = await db.as('nabvy_app', (q) => recordSale(q, sale(id), { now: NOW }), U1)
    const later = new Date('2026-09-25T13:00:00.000Z')
    const second = await db.as('nabvy_app', (q) => recordSale(q, sale(id), { now: later }), U1)
    if (!first.ok || !second.ok) throw new Error('recordSale failed')
    expect(first.value.changed).toBe(true)
    expect(second.value.changed).toBe(false)
    expect(second.value.event.key).toBe(first.value.event.key)
    const [row] = await db.sql(`select sold_recorded_at from inventory.items where id = $1`, [id])
    expect(new Date(String(row?.sold_recorded_at)).toISOString()).toBe(NOW.toISOString())
  })

  it('a corrected sale replaces the stored one, in place, with a new key', async () => {
    const id = itemId()
    await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    const first = await db.as('nabvy_app', (q) => recordSale(q, sale(id), { now: NOW }), U1)
    const corrected = await db.as(
      'nabvy_app',
      (q) =>
        recordSale(
          q,
          { ...sale(id), sold: { amountMinor: 14000, currency: 'GBP' }, soldOn: 'ebay' },
          { now: NOW },
        ),
      U1,
    )
    if (!first.ok || !corrected.ok) throw new Error('recordSale failed')
    expect(corrected.value.changed).toBe(true)
    expect(corrected.value.event.key).not.toBe(first.value.event.key)
    expect(corrected.value.profitMinor).toBe(2000)
    const [row] = await db.sql(`select sold_minor, sold_on from inventory.items where id = $1`, [
      id,
    ])
    expect(Number(row?.sold_minor)).toBe(14000)
    expect(row?.sold_on).toBe('ebay')
  })
})
