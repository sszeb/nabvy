import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lookup } from '../src'
import {
  createTestDatabase,
  seedCredits,
  seedGroup,
  seedScan,
  seedUser,
  setAllOn,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: `lookup()` is idempotent on its natural key, the scan
// ID. A replay must return the same result, write no second `lookups` row and, most importantly,
// never charge usage-ledger twice for one scan.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setAllOn(db)
}, 60_000)
afterAll(() => db.close())

describe('scan-lookup idempotency', () => {
  it('a lookup run twice for the same scan writes once and charges once', async () => {
    const userId = randomUUID()
    const scanId = randomUUID()
    await seedUser(db, userId)
    await seedCredits(db, userId, 5)
    await seedScan(db, scanId, userId, 'gpu:rtx3090')
    await seedGroup(db, 'gpu:rtx3090@standalone@used_good@GB@GBP@30', 'gpu:rtx3090', {
      n: 12,
      median: 25000,
      p25: 23000,
      p75: 27000,
    })

    const first = await db.as('nabvy_pipeline', (tx) => lookup(tx, { scanId }))
    const second = await db.as('nabvy_pipeline', (tx) => lookup(tx, { scanId }))
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.value).toEqual(first.value)

    const rows = await db.sql('select * from scan_lookup.lookups where scan_id = $1', [scanId])
    expect(rows).toHaveLength(1)
    const charges = await db.sql(
      "select * from usage_ledger.entries where ref_id = $1 and kind = 'charge'",
      [scanId],
    )
    expect(charges).toHaveLength(1)
  })
})
