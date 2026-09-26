import {
  AskingPriceIndexBand,
  AskingPriceIndexGroupKey,
  AskingPriceIndexGroupKeyString,
  AskingPriceIndexStats,
  AskingPriceIndexUpdatedEvent,
  events,
  module,
} from '@nabvy/contracts/modules/asking-price-index'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatGroupKey, index } from '../src'
import {
  createTestDatabase,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from './support/database'

const ids = Array.from(
  { length: 10 },
  (_, i) => `01900000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
)
let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seed(
    db,
    ids.map((id, i) => ({ id, priceMinor: 60000 + 100 * i })),
  )
  await switchOn(db, [...UPSTREAM, 'asking-price-index'])
  await setSwitch(db, 'on')
}, 60_000)
afterAll(() => db.close())

describe('asking-price-index contracts', () => {
  it('declares its name', () => {
    expect(module).toBe('asking-price-index')
    expect(events.module).toBe('asking-price-index')
  })

  it('formats a group key its string schema accepts', () => {
    const key = AskingPriceIndexGroupKey.parse({
      catalogueId: 'gpu:rtx-3090',
      context: 'in_pc',
      condition: 'used_like_new',
      country: 'IE',
      currency: 'EUR',
      windowDays: 30,
    })
    expect(AskingPriceIndexGroupKeyString.parse(formatGroupKey(key))).toBe(
      'gpu:rtx-3090|in_pc|used_like_new|IE|EUR|30d',
    )
    expect(AskingPriceIndexGroupKey.safeParse({ ...key, currency: 'USD' }).success).toBe(false)
  })

  it('event payloads, stats rows and band rows parse', async () => {
    const result = await db.as('nabvy_pipeline', (q) => index(q, { listingIds: ids }))
    if (!result.ok) throw new Error(result.error.message)
    for (const e of result.value.events) AskingPriceIndexUpdatedEvent.parse(e.payload)
    // Identifiers only (rule 7): no prices or text in the payload.
    expect(Object.keys(result.value.events[0]?.payload ?? {})).toEqual(['groupKeys'])

    const [row] = await db.sql(
      `select group_key, n, median, mad, p25, p75, min, max, thin, copy_collapse, as_of
       from asking_price_index.v_groups`,
    )
    expect(
      AskingPriceIndexStats.safeParse({
        groupKey: row?.group_key,
        n: row?.n,
        median: Number(row?.median),
        mad: Number(row?.mad),
        p25: Number(row?.p25),
        p75: Number(row?.p75),
        min: Number(row?.min),
        max: Number(row?.max),
        thin: row?.thin,
        copyCollapse: row?.copy_collapse,
        asOf: new Date(row?.as_of as string).toISOString(),
      }).success,
    ).toBe(true)

    const [band] = await db.sql(
      'select group_key, label, n, median, range_low, range_high, currency from app.v_asking_price_index_bands',
    )
    expect(
      AskingPriceIndexBand.parse({
        groupKey: band?.group_key,
        label: band?.label,
        n: band?.n,
        median: Number(band?.median),
        rangeLow: Number(band?.range_low),
        rangeHigh: Number(band?.range_high),
        currency: band?.currency,
      }).n,
    ).toBe(10)
  })
})
