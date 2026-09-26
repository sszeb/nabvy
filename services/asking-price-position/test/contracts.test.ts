import {
  AskingPricePosition,
  AskingPricePositionInput,
  AskingPricePositionPositionedEvent,
  AskingPricePositionShown,
  events,
  module,
} from '@nabvy/contracts/modules/asking-price-position'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { position } from '../src'
import {
  createTestDatabase,
  NOW,
  runIndex,
  seed,
  setSwitch,
  shownRows,
  switchOn,
  type TestDatabase,
  uuid,
} from './support/database'

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v,
    ]),
  )

describe('asking-price-position contracts', () => {
  it('declares its name', () => {
    expect(module).toBe('asking-price-position')
    expect(events.module).toBe('asking-price-position')
  })

  it('refuses an empty batch, a bad group key and a price in the event (rule 7)', () => {
    expect(AskingPricePositionInput.safeParse({ groupKeys: [] }).success).toBe(false)
    expect(AskingPricePositionInput.safeParse({ groupKeys: ['nonsense'] }).success).toBe(false)
    expect(
      AskingPricePositionPositionedEvent.safeParse({ listingIds: [uuid(1)], askMinor: 1 }).success,
    ).toBe(false)
  })

  it('refuses a shown row below n = 10', () => {
    const row = {
      listingId: uuid(1),
      label: 'RTX 3090, on its own, used, good',
      rank: 1,
      n: 9,
      median: 1,
      rangeLow: 1,
      rangeHigh: 1,
      currency: 'GBP',
    }
    expect(AskingPricePositionShown.safeParse(row).success).toBe(false)
    expect(AskingPricePositionShown.safeParse({ ...row, n: 10 }).success).toBe(true)
  })
})

describe('view rows and events parse', () => {
  let db: TestDatabase
  beforeAll(async () => {
    db = await createTestDatabase()
    const ids = Array.from({ length: 10 }, (_, i) => uuid(i + 1))
    await seed(
      db,
      ids.map((id, i) => ({ id, priceMinor: 60000 + 1000 * i })),
    )
    await switchOn(db)
    await setSwitch(db, 'on')
  }, 60_000)
  afterAll(() => db.close())

  it('v_positions, app.v_asking_price_position and the event', async () => {
    const groupKeys = await runIndex(
      db,
      Array.from({ length: 10 }, (_, i) => uuid(i + 1)),
    )
    const result = await db.as('nabvy_pipeline', (q) => position(q, { groupKeys }, { now: NOW }))
    if (!result.ok) throw new Error(result.error.message)
    for (const e of result.value.events) {
      expect(AskingPricePositionPositionedEvent.parse(e.payload)).toBeTruthy()
    }
    const rows = await db.sql('select * from asking_price_position.v_positions')
    expect(rows).toHaveLength(10)
    for (const r of rows) expect(AskingPricePosition.parse(camel(r))).toBeTruthy()
    const shown = await shownRows(db)
    expect(shown).toHaveLength(10)
    for (const r of shown) expect(AskingPricePositionShown.parse(camel(r))).toBeTruthy()
  })
})
