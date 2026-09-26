import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { onAccountDeleted } from '../src/handlers'
import { addItem } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'
const NOW = new Date('2026-09-25T12:00:00.000Z')
const GPU = 'gpu:nvidia:rtx-3090'

let db: TestDatabase
let n = 0
const itemId = () => `0190f1d2-0000-7000-8000-0000000003${String(++n).padStart(2, '0')}`

beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const count = async (userId: string) =>
  (
    (await db.sql(`select count(*)::int as n from inventory.items where user_id = $1`, [
      userId,
    ])) as [{ n: number }]
  )[0].n
const add = (userId: string) =>
  db.as(
    'nabvy_app',
    (q) =>
      addItem(
        q,
        {
          itemId: itemId(),
          userId,
          productKey: GPU,
          cost: { amountMinor: 12000, currency: 'GBP' },
          boughtAt: '2026-09-20',
        },
        { now: NOW },
      ),
    userId,
  )

describe('purge on account.deleted', () => {
  it("removes the deleted user's items and leaves other users alone", async () => {
    await add(U1)
    await add(U1)
    await add(U2)
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }]))
    expect(await count(U1)).toBe(0)
    expect(await count(U2)).toBe(1)
  })

  it('is idempotent and runs while the module is off', async () => {
    await setSwitches(db, { inventory: 'off' })
    await expect(
      db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }])),
    ).resolves.not.toThrow()
    expect(await count(U1)).toBe(0)
  })

  it('de-duplicates a batch of payloads for the same user', async () => {
    await add(U2)
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U2 }, { userId: U2 }]))
    expect(await count(U2)).toBe(0)
  })
})
