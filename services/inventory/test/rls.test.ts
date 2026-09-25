import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addItem, itemsFor, recordSale } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedListing,
  seedScan,
  seedUser,
  setSwitches,
  suppressListing,
  type TestDatabase,
} from './support/database'

// Card: "row-level security". A user cannot read, sell or insert another user's item; a scan or a
// listing is linked only when it is the caller's own scan or on their listing card; a suppressed
// listing's ID never reaches the user-facing view (rule 5 of docs/design/modules/_rules.md).

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'
const NOW = new Date('2026-09-25T12:00:00.000Z')
const GPU = 'gpu:nvidia:rtx-3090'

let db: TestDatabase
let n = 0
const itemId = () => `0190f1d2-0000-7000-8000-0000000002${String(++n).padStart(2, '0')}`

beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const rows = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows
const purchase = (id: string, extra: Record<string, unknown> = {}) => ({
  itemId: id,
  userId: U1,
  productKey: GPU,
  cost: { amountMinor: 12000, currency: 'GBP' as const },
  boughtAt: '2026-09-20',
  ...extra,
})

describe('row-level security', () => {
  it('a user cannot read, sell or insert as another user', async () => {
    const id = itemId()
    const added = await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    expect(added.ok).toBe(true)

    const asU2 = await db.as(
      'nabvy_app',
      (q) => q.execute(`select * from inventory.items where id = '${id}'`),
      U2,
    )
    expect(rows(asU2)).toHaveLength(0)
    expect(await db.as('nabvy_app', (q) => itemsFor(q), U2)).toHaveLength(0)

    const sold = await db.as(
      'nabvy_app',
      (q) =>
        recordSale(
          q,
          {
            userId: U2,
            itemId: id,
            sold: { amountMinor: 1, currency: 'GBP' },
            soldAt: '2026-09-24',
          },
          { now: NOW },
        ),
      U2,
    )
    expect(sold.ok ? 'ok' : sold.error.code).toBe('inventory.not_found')
    await expect(
      db.as(
        'nabvy_app',
        (q) => q.execute(`update inventory.items set sold_minor = 1 where id = '${id}'`),
        U2,
      ),
    ).resolves.not.toThrow() // RLS silently matches zero rows; assert nothing actually changed
    const [row] = await db.sql(`select sold_minor from inventory.items where id = $1`, [id])
    expect(row?.sold_minor).toBeNull()

    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at)
             values ('${U2}', '${GPU}', 'GBP', 1, '2026-09-20') returning id`,
          ),
        U1,
      ),
    ).rejects.toThrow() // WITH CHECK refuses a row for another user even as U1
  })

  it('the app may update only the sale columns', async () => {
    const id = itemId()
    await db.as('nabvy_app', (q) => addItem(q, purchase(id), { now: NOW }), U1)
    await expect(
      db.as(
        'nabvy_app',
        (q) => q.execute(`update inventory.items set cost_minor = 1 where id = '${id}'`),
        U1,
      ),
    ).rejects.toThrow()
    await expect(
      db.as('nabvy_app', (q) => q.execute(`delete from inventory.items where id = '${id}'`), U1),
    ).rejects.toThrow()
  })

  it("a scan links only when it is the caller's own, and fills in the product key", async () => {
    const mine = '0190f1d2-0000-7000-8000-0000000000c1'
    const theirs = '0190f1d2-0000-7000-8000-0000000000c2'
    await seedScan(db, { scanId: mine, userId: U1, identified: GPU })
    await seedScan(db, { scanId: theirs, userId: U2, identified: GPU })

    const fromTheirs = await db.as(
      'nabvy_app',
      (q) =>
        addItem(q, purchase(itemId(), { productKey: undefined, scanId: theirs }), { now: NOW }),
      U1,
    )
    expect(fromTheirs.ok ? 'ok' : fromTheirs.error.code).toBe('inventory.scan_not_found')

    const id = itemId()
    const fromMine = await db.as(
      'nabvy_app',
      (q) => addItem(q, purchase(id, { productKey: undefined, scanId: mine }), { now: NOW }),
      U1,
    )
    expect(fromMine.ok).toBe(true)
    const [row] = await db.sql(`select product_key, scan_id from inventory.items where id = $1`, [
      id,
    ])
    expect(row).toEqual({ product_key: GPU, scan_id: mine })
  })

  it('a listing links only while it is on the listing card, and its ID is hidden once suppressed', async () => {
    const sourceListingId = 'fb-inventory-1'
    const listingId = await seedListing(db, { sourceListingId })
    const unknown = '0190f1d2-0000-7000-8000-0000000000d9'
    const missing = await db.as(
      'nabvy_app',
      (q) => addItem(q, purchase(itemId(), { sourceListingId: unknown }), { now: NOW }),
      U1,
    )
    expect(missing.ok ? 'ok' : missing.error.code).toBe('inventory.listing_not_found')

    const id = itemId()
    const linked = await db.as(
      'nabvy_app',
      (q) => addItem(q, purchase(id, { sourceListingId: listingId }), { now: NOW }),
      U1,
    )
    expect(linked.ok).toBe(true)
    const mine = async () =>
      (await db.as('nabvy_app', (q) => itemsFor(q), U1)).find((item) => item.id === id)
    expect((await mine())?.sourceListingId).toBe(listingId)

    await suppressListing(db, '0190f1d2-0000-7000-8000-0000000000e1', 'facebook', sourceListingId)
    const after = await mine()
    expect(after).toBeDefined() // the user's own money record stays
    expect(after?.sourceListingId).toBeNull() // but the link to the suppressed listing is gone
    expect(after?.costMinor).toBe(12000)

    await setSwitches(db, { 'listing-suppression': 'off' })
    expect((await mine())?.sourceListingId).toBeNull() // fail closed while suppression is off
  })
})
