import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tripCost, updateSettings } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000c1'
const NOW = new Date('2026-09-24T00:00:00.000Z')

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('travel-cost', 'module', 'on')`,
  )
}, 60_000)

afterAll(() => db.close())

describe('updateSettings validates the merged row', () => {
  it('refuses { preset: custom } when no custom rate is saved, and writes nothing', async () => {
    await expect(
      db.as('nabvy_app', (tx) => updateSettings(tx, { userId: U1, preset: 'custom' }), U1),
    ).rejects.toMatchObject({ code: 'travel-cost.invalid_input' })
    const rows = await db.sql(
      `select count(*)::int as n from travel_cost.user_travel_settings where user_id = $1`,
      [U1],
    )
    expect(rows[0]?.n).toBe(0)
  })
})

describe('updateSettings twice', () => {
  it('leaves one settings row in the same state, however many times it runs', async () => {
    const input = { userId: U1, preset: 'hmrc-business' as const, valueOfTimePenceHour: 0 }
    const run = () => db.as('nabvy_app', (tx) => updateSettings(tx, input), U1)
    const first = await run()
    const second = await run()
    expect(first.settings.preset).toBe('hmrc-business')
    expect(second.settings.preset).toBe('hmrc-business')
    expect(second.settings.valueOfTimePenceHour).toBe(0)

    const rows = await db.sql(
      `select count(*)::int as n from travel_cost.user_travel_settings where user_id = $1`,
      [U1],
    )
    expect(rows[0]?.n).toBe(1)
  })
})

describe('tripCost twice', () => {
  it('is a pure read: the same input gives the same result, and writes nothing', async () => {
    const leg = { roadMiles: 13, minutes: 22.285714285714285 }
    const run = () => db.as('nabvy_app', (tx) => tripCost(tx, { userId: U1, legs: [leg] }, NOW), U1)
    const first = await run()
    const second = await run()
    expect(second).toEqual(first)
  })
})
