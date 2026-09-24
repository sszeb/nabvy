import {
  events,
  module,
  PRICING_CONSOLE_MESSAGES,
  PricingConsoleErrorCode,
  PricingConsoleLadderRow,
  PricingConsoleOffer,
  PricingConsoleOfferRow,
  PricingConsolePriceRow,
  PricingConsoleSetInput,
  PricingConsoleTier,
} from '@nabvy/contracts/modules/pricing-console'
import { vLadder, vOffers, vPrices } from '@nabvy/db/schema/pricing-console'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { ADMIN, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

// The contracts match the views (Drizzle declarations and the real columns), every seeded row
// parses with its kind's schema, and the error codes all have messages.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'pricing-console', 'on')
}, 60_000)
afterAll(() => db.close())

const columnsOf = async (view: string) =>
  (
    await db.sql(
      `select column_name from information_schema.columns
       where table_schema = 'pricing_console' and table_name = $1 order by ordinal_position`,
      [view],
    )
  ).map((r) => r.column_name as string)

const drizzleColumns = (view: Parameters<typeof getViewConfig>[0]) =>
  Object.values(getViewConfig(view).selectedFields).map((c) => (c as { name: string }).name)

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

describe('pricing-console contracts', () => {
  it('declares its name and no events', () => {
    expect(module).toBe('pricing-console')
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it.each([
    ['v_ladder', vLadder, PricingConsoleLadderRow],
    ['v_prices', vPrices, PricingConsolePriceRow],
    ['v_offers', vOffers, PricingConsoleOfferRow],
  ] as const)('%s: view, Drizzle and contract agree', async (name, view, schema) => {
    const real = await columnsOf(name)
    expect(drizzleColumns(view)).toEqual(real)
    expect(Object.keys((schema as z.ZodObject).shape)).toEqual(real.map(camel))
  })

  it('every seeded row parses with its kind’s schema', async () => {
    const rows = await db.sql('select kind, key, value from pricing_console.policy_rows')
    expect(rows.length).toBeGreaterThan(20)
    for (const r of rows) {
      const parsed = PricingConsoleSetInput.safeParse({
        actorUserId: ADMIN,
        kind: r.kind,
        key: r.key,
        value: r.value,
      })
      expect(parsed.success, `${r.kind}/${r.key}`).toBe(true)
    }
  })

  it('ladder rows parse from the view', async () => {
    const rows = await db.sql('select * from pricing_console.v_ladder')
    for (const r of rows) {
      const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v]))
      expect(PricingConsoleLadderRow.safeParse(row).success).toBe(true)
    }
  })

  it('refuses a floor slower than the base, and an offer for both a user and a segment', () => {
    const tier = {
      baseCadenceMinutes: 30,
      floorCadenceMinutes: 60,
      bundledCredits: 1,
      monthlyPriceMinor: 1,
      yearlyPriceMinor: null,
      topupGrossMicrosPerCredit: 2,
      topupNetMicrosPerCredit: 1,
      areas: 1,
      wants: 1,
      roundTheClock: false,
    }
    expect(PricingConsoleTier.safeParse(tier).success).toBe(false)
    expect(PricingConsoleTier.safeParse({ ...tier, floorCadenceMinutes: 5 }).success).toBe(true)
    const offer = {
      userId: ADMIN,
      segment: 'all',
      item: 'price:export',
      discountBps: 10,
      startsAt: '2026-09-24T00:00:00.000Z',
      endsAt: '2026-09-25T00:00:00.000Z',
    }
    expect(PricingConsoleOffer.safeParse(offer).success).toBe(false)
    expect(PricingConsoleOffer.safeParse({ ...offer, segment: null }).success).toBe(true)
    expect(
      PricingConsoleOffer.safeParse({ ...offer, segment: null, item: 'plan:pro' }).success,
    ).toBe(false)
  })

  it('has a message for every error code', () => {
    expect(Object.keys(PRICING_CONSOLE_MESSAGES).sort()).toEqual(
      [...PricingConsoleErrorCode.options].sort(),
    )
  })
})
