import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listRates, params, tripCost, updateSettings } from '../src'
import { TravelCostRefused } from '../src/domain'
import { createTestDatabase, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000c1'
const NOW = new Date('2026-09-24T00:00:00.000Z')
const LEG = { roadMiles: 2.6, minutes: 4.457142857142857 }

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)

afterAll(() => db.close())

describe('travel-cost off (rule 11 default for a new module: no seed row, so the switch reads off)', () => {
  it('refuses tripCost, params and updateSettings, and listRates', async () => {
    await expect(
      db.as('nabvy_app', (tx) => tripCost(tx, { userId: U1, legs: [LEG] }, NOW), U1),
    ).rejects.toMatchObject({ code: 'travel-cost.module_off' })
    await expect(db.as('nabvy_app', (tx) => params(tx, U1, NOW), U1)).rejects.toBeInstanceOf(
      TravelCostRefused,
    )
    await expect(
      db.as('nabvy_app', (tx) => updateSettings(tx, { userId: U1, preset: 'hmrc-business' }), U1),
    ).rejects.toMatchObject({ code: 'travel-cost.module_off' })
    await expect(db.as('nabvy_app', (tx) => listRates(tx), U1)).rejects.toMatchObject({
      code: 'travel-cost.module_off',
    })
  })

  it('v_rates returns no rows even though the seeded rates exist', async () => {
    const rows = await db.sql(`select count(*)::int as n from travel_cost.v_rates`)
    expect(rows[0]?.n).toBe(0)
    const raw = await db.sql(`select count(*)::int as n from travel_cost.travel_rates`)
    expect(Number(raw[0]?.n)).toBeGreaterThan(0)
  })
})

describe('travel-cost on', () => {
  it('works normally, and v_rates returns the seeded rows', async () => {
    await db.sql(
      `insert into switches.switches (name, kind, state) values ('travel-cost', 'module', 'on')`,
    )
    const result = await db.as(
      'nabvy_app',
      (tx) => tripCost(tx, { userId: U1, legs: [LEG] }, NOW),
      U1,
    )
    // 2.6 road miles at the 1 Sep 2026 petrol 1,401–2,000cc rate (17p) plus 4.46 minutes at
    // £12.71/h: the §4.2 figure (£1.31) holds at the March quarter's 14p, priced at NOW it is £1.39.
    expect(result.amount.amountMinor).toBe(139)

    const rates = await db.as('nabvy_pipeline', (tx) => listRates(tx))
    expect(rates.length).toBeGreaterThan(0)

    const rows = await db.sql(`select count(*)::int as n from travel_cost.v_rates`)
    expect(Number(rows[0]?.n)).toBe(rates.length)
  })
})
