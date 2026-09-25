import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { tripCost, updateSettings } from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `trip-cost`: reproduces docs/design/drafts/search-map-routes.md §4.2's worked numbers
// against the real seeded rate rows (packages/db/migrations/travel-cost/*_travel_cost_seed.sql),
// not a hand-rolled array (test/domain.test.ts covers the pure logic on its own). Each case prices
// one leg (already-measured road miles and minutes) at a given moment, optionally after changing
// the user's settings first. The worked-number cases are priced in the 1 Mar 2026 quarter, whose
// 14p petrol rate §4.2 used; the "current-quarter" cases price the same trip on 2026-09-24 and
// must pick the 1 Sep 2026 rows GOV.UK published on 21 August 2026.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  userId: z.string(),
  legs: z.array(z.strictObject({ roadMiles: z.number(), minutes: z.number() })).min(1),
  now: z.iso.datetime({ offset: false }),
  settings: z
    .strictObject({
      preset: z.enum(['fuel-only', 'hmrc-business', 'custom']).optional(),
      fuel: z.enum(['petrol', 'diesel', 'lpg']).optional(),
      engineBand: z
        .enum(['1400-or-less', '1401-2000', 'over-2000', '1600-or-less', '1601-2000'])
        .optional(),
      valueOfTimePenceHour: z.number().int().nonnegative().optional(),
    })
    .optional(),
})
const Expected = z.union([
  z.strictObject({ amountMinor: z.number().int() }),
  z.strictObject({ refused: z.string() }),
])

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .flatMap((id) => {
    const parsed = Input.safeParse(read(id, 'input.json'))
    return parsed.success
      ? [{ id, input: parsed.data, expected: Expected.parse(read(id, 'expected.json')) }]
      : []
  })

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('travel-cost', 'module', 'on')`,
  )
}, 60_000)
afterAll(() => db.close())

describe('trip-cost', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    if (input.settings) {
      await db.as(
        'nabvy_app',
        (tx) => updateSettings(tx, { userId: input.userId, ...input.settings }),
        input.userId,
      )
    }
    const outcome = await db
      .as(
        'nabvy_app',
        (tx) => tripCost(tx, { userId: input.userId, legs: input.legs }, new Date(input.now)),
        input.userId,
      )
      .then(
        (result) => ({ amountMinor: result.amount.amountMinor }),
        (error: { code?: string }) => ({ refused: error.code ?? 'unknown' }),
      )
    if ('amountMinor' in expected) {
      expect(outcome).toEqual({ amountMinor: expected.amountMinor })
    } else {
      expect(outcome).toEqual({ refused: expected.refused })
    }
  })
})
