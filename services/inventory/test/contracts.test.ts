import { parseEvent } from '@nabvy/contracts'
import {
  events,
  INVENTORY_MAX_AMOUNT_MINOR,
  InventoryAddItemInput,
  InventoryItem,
  InventoryItemInternal,
  InventoryOutcomeRecordedEvent,
  InventoryRecordSaleInput,
  module,
} from '@nabvy/contracts/modules/inventory'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addItem, itemsFor, recordSale } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

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

const rows = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows

describe('contracts', () => {
  it('declares its name', () => {
    expect(module).toBe('inventory')
    expect(events.module).toBe('inventory')
  })

  it('bounds every input: amounts, dates, the product key, and what names the item', () => {
    const good = {
      itemId: ITEM,
      userId: U1,
      productKey: GPU,
      cost: { amountMinor: 12000, currency: 'GBP' },
      boughtAt: '2026-09-20',
    }
    expect(InventoryAddItemInput.safeParse(good).success).toBe(true)
    expect(
      InventoryAddItemInput.safeParse({ ...good, cost: { amountMinor: -1, currency: 'GBP' } })
        .success,
    ).toBe(false)
    expect(
      InventoryAddItemInput.safeParse({
        ...good,
        cost: { amountMinor: INVENTORY_MAX_AMOUNT_MINOR + 1, currency: 'GBP' },
      }).success,
    ).toBe(false)
    expect(
      InventoryAddItemInput.safeParse({ ...good, cost: { amountMinor: 12.5, currency: 'GBP' } })
        .success,
    ).toBe(false)
    expect(
      InventoryAddItemInput.safeParse({ ...good, cost: { amountMinor: 1, currency: 'USD' } })
        .success,
    ).toBe(false)
    expect(InventoryAddItemInput.safeParse({ ...good, boughtAt: '1999-12-31' }).success).toBe(false)
    expect(InventoryAddItemInput.safeParse({ ...good, boughtAt: '20/09/2026' }).success).toBe(false)
    expect(InventoryAddItemInput.safeParse({ ...good, productKey: 'RTX 3090' }).success).toBe(false)
    expect(InventoryAddItemInput.safeParse({ ...good, productKey: undefined }).success).toBe(false)
    expect(InventoryAddItemInput.safeParse({ ...good, extra: 1 }).success).toBe(false)

    const sale = {
      userId: U1,
      itemId: ITEM,
      sold: { amountMinor: 15000, currency: 'GBP' },
      soldAt: '2026-09-24',
    }
    expect(InventoryRecordSaleInput.safeParse(sale).success).toBe(true)
    expect(InventoryRecordSaleInput.safeParse({ ...sale, soldOn: 'ebay' }).success).toBe(true)
    expect(InventoryRecordSaleInput.safeParse({ ...sale, soldOn: 'carboot' }).success).toBe(false)
    expect(InventoryRecordSaleInput.safeParse({ ...sale, soldAt: 1727000000 }).success).toBe(false)
  })

  it('the event payload carries item IDs only, 1 to 500', () => {
    expect(InventoryOutcomeRecordedEvent.safeParse({ itemIds: [ITEM] }).success).toBe(true)
    expect(InventoryOutcomeRecordedEvent.safeParse({ itemIds: [] }).success).toBe(false)
    expect(
      InventoryOutcomeRecordedEvent.safeParse({ itemIds: Array(501).fill(ITEM) }).success,
    ).toBe(false)
    expect(InventoryOutcomeRecordedEvent.safeParse({ itemIds: [ITEM], soldMinor: 1 }).success).toBe(
      false,
    )
  })

  it('the outcome-recorded event parses with the registry', async () => {
    await db.as(
      'nabvy_app',
      (q) =>
        addItem(
          q,
          {
            itemId: ITEM,
            userId: U1,
            productKey: GPU,
            cost: { amountMinor: 12000, currency: 'GBP' },
            boughtAt: '2026-09-20',
          },
          { now: NOW },
        ),
      U1,
    )
    const outcome = await db.as(
      'nabvy_app',
      (q) =>
        recordSale(
          q,
          {
            userId: U1,
            itemId: ITEM,
            sold: { amountMinor: 15000, currency: 'GBP' },
            soldAt: '2026-09-24',
          },
          { now: NOW },
        ),
      U1,
    )
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.value.event.type).toBe('inventory.outcome-recorded')
    parseEvent(events, outcome.value.event)
  })

  it('every app.v_inventory_items row parses, through itemsFor', async () => {
    const list = await db.as('nabvy_app', (q) => itemsFor(q), U1)
    expect(list.length).toBeGreaterThan(0)
    for (const item of list) InventoryItem.parse(item)
    expect(list[0]?.profitMinor).toBe(3000)
  })

  it('every inventory.v_items row parses and carries no seller-like or listing column', async () => {
    const result = rows(
      await db.as('nabvy_pipeline', (q) => q.execute('select * from inventory.v_items')),
    )
    expect(result.length).toBeGreaterThan(0)
    for (const row of result) {
      InventoryItemInternal.parse({
        id: row.id,
        userId: row.user_id,
        productKey: row.product_key,
        currency: row.currency,
        costMinor: Number(row.cost_minor),
        boughtAt: String(row.bought_at).slice(0, 10),
        soldMinor: row.sold_minor == null ? null : Number(row.sold_minor),
        soldAt: row.sold_at == null ? null : String(row.sold_at).slice(0, 10),
        soldOn: row.sold_on,
        soldRecordedAt:
          row.sold_recorded_at == null
            ? null
            : new Date(String(row.sold_recorded_at)).toISOString(),
      })
      expect(Object.keys(row)).not.toEqual(
        expect.arrayContaining(['seller_name', 'profile_url', 'source_listing_id', 'scan_id']),
      )
    }
  })
})
