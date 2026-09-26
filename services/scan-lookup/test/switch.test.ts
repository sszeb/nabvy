import { randomUUID } from 'node:crypto'
import { state } from '@nabvy/switches'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lookup } from '../src'
import {
  createTestDatabase,
  seedCredits,
  seedGroup,
  seedScan,
  seedUser,
  setSwitch,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md: one switch per module, off by default. Off: scans
// identify but do not price (README.md) — lookup() refuses and writes nothing, both views stay
// empty. Shadow: lookup() runs and writes to the internal view for testing, but never charges
// (a shadow charge would spend real credit while the user-facing view shows no row to explain
// it), and the user-facing view stays empty. On: the full job.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on', 'asking-price-index')
  await setSwitch(db, 'on', 'scan-recognition')
  await setSwitch(db, 'on', 'usage-ledger')
}, 60_000)
afterAll(() => db.close())

async function seedPriceable() {
  const userId = randomUUID()
  const scanId = randomUUID()
  // A fresh catalogue ID per call: this file shares one database, and selectGroups() matches on
  // catalogueId alone, so a shared ID would leak one call's groups into another's lookup.
  const catalogueId = `gpu:rtx3090-${scanId}`
  await seedUser(db, userId)
  await seedCredits(db, userId, 5)
  await seedScan(db, scanId, userId, catalogueId)
  await seedGroup(db, `g-${scanId}`, catalogueId, { n: 12, median: 25000, p25: 23000, p75: 27000 })
  return { userId, scanId }
}

describe('scan-lookup switch', () => {
  it('reads off with no seed row', async () => {
    expect(await db.as('nabvy_pipeline', (tx) => state(tx, 'scan-lookup'))).toBe('off')
  })

  it('off: refuses and writes nothing; both views stay empty', async () => {
    const { scanId } = await seedPriceable()

    const result = await db.as('nabvy_pipeline', (tx) => lookup(tx, { scanId }))
    expect(result).toMatchObject({ ok: false, error: { code: 'scan-lookup.off' } })
    expect(await db.sql('select * from scan_lookup.lookups where scan_id = $1', [scanId])).toEqual(
      [],
    )
  })

  it('shadow: writes the internal view but charges nothing and shows no user-facing row', async () => {
    await setSwitch(db, 'shadow', 'scan-lookup')
    const { userId, scanId } = await seedPriceable()

    const result = await db.as('nabvy_pipeline', (tx) => lookup(tx, { scanId }))
    expect(result).toMatchObject({ ok: true, value: { status: 'priced', costCredits: 0 } })

    const internal = await db.as('nabvy_pipeline', (tx) =>
      tx.execute(`select * from scan_lookup.v_results where scan_id = '${scanId}'`),
    )
    expect((internal as { rows: unknown[] }).rows).toHaveLength(1)

    const own = await db.as(
      'nabvy_app',
      (tx) => tx.execute('select * from app.v_scan_lookup_results'),
      userId,
    )
    expect((own as { rows: unknown[] }).rows).toEqual([])
    expect(await db.sql("select * from usage_ledger.entries where kind = 'charge'")).toEqual([])
  })

  it('on: writes and charges, and the user sees their own row', async () => {
    await setSwitch(db, 'on', 'scan-lookup')
    const { userId, scanId } = await seedPriceable()

    const result = await db.as('nabvy_pipeline', (tx) => lookup(tx, { scanId }))
    expect(result).toMatchObject({ ok: true, value: { costCredits: 1 } })

    const own = await db.as(
      'nabvy_app',
      (tx) => tx.execute(`select * from app.v_scan_lookup_results where scan_id = '${scanId}'`),
      userId,
    )
    expect((own as { rows: unknown[] }).rows).toHaveLength(1)
  })
})
