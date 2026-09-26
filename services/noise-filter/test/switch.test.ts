import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classify } from '../src'
import {
  ALL_ON,
  assessed,
  createTestDatabase,
  listingIdsBySource,
  loadRun,
  RECORDED,
  type TestDatabase,
  withFields,
} from './support/database'

// Rule 11. Off: nothing is read or written and both views are empty, so every listing shows.
// Shadow: rows are written and the internal view shows them; the user-facing view shows none.
// On: the user-facing view shows reason codes, never for a suppressed listing, and none at all
// while listing-suppression is off. An upstream module that is off reads as unknown, never noise.

const run = loadRun(RECORDED)
const SERVICE = '2537899006714740' // "Gaming pc / Builder and repair" (dataset.json:6713)
let t: TestDatabase
let listingIds: string[]
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  listingIds = await assessed(t, run)
})
afterEach(async () => {
  await t.close()
})

const count = async () =>
  Number((await t.sql('select count(*)::int as n from noise_filter.classifications'))[0]?.n)
const internal = () => t.asPipeline('select listing_id from noise_filter.v_classifications')
const app = () => t.asApp('select listing_id, reasons from app.v_noise_filter_reasons')

describe('switch', () => {
  it('off: acknowledges, writes nothing, both views empty', async () => {
    await classify(t.db, { listingIds, now: new Date() })
    await t.switches({ 'noise-filter': 'off' })
    expect(await internal()).toHaveLength(0)
    expect(await app()).toHaveLength(0)
    await t.sql('delete from noise_filter.classifications')
    const result = await classify(t.db, { listingIds, now: new Date() })
    if (!result.ok) throw new Error('classify failed')
    expect(result.value).toMatchObject({ open: false, written: 0, events: [] })
    expect(await count()).toBe(0)
  })

  it('the paused pipeline writes nothing', async () => {
    await t.switches({ pipeline: 'off' })
    const result = await classify(t.db, { listingIds, now: new Date() })
    if (!result.ok) throw new Error('classify failed')
    expect(result.value.open).toBe(false)
    expect(await count()).toBe(0)
  })

  it('shadow: writes and shows internal rows, no user-facing row', async () => {
    await t.switches({ 'noise-filter': 'shadow' })
    await classify(t.db, { listingIds, now: new Date() })
    expect(await internal()).toHaveLength(20)
    expect(await app()).toHaveLength(0)
  })

  it('on: the user-facing view shows listings with reasons, reason codes only', async () => {
    await classify(t.db, { listingIds, now: new Date() })
    const ids = await listingIdsBySource(t)
    const rows = await app()
    expect(rows).toEqual([{ listing_id: ids.get(SERVICE), reasons: ['service'] }])
  })

  it('a suppressed listing never shows; listing-suppression off shows nothing', async () => {
    await classify(t.db, { listingIds, now: new Date() })
    await t.sql(
      `insert into listing_suppression.entries (kind, value, request_id)
       select 'listing_hash', listing_suppression.listing_hash(source, source_listing_id),
              '01920000-0000-7000-8000-000000000001'
       from listing_ingest.listings where source_listing_id = $1`,
      [SERVICE],
    )
    expect(await app()).toHaveLength(0)
    await t.sql('delete from listing_suppression.entries')
    expect(await app()).toHaveLength(1)
    await t.switches({ 'listing-suppression': 'off' })
    expect(await app()).toHaveLength(0)
  })

  it('nabvy_app reads no internal view and only the view-shaped columns of the table', async () => {
    await classify(t.db, { listingIds, now: new Date() })
    await expect(t.asApp('select * from noise_filter.v_classifications')).rejects.toThrow()
    await expect(t.asApp('select evidence from noise_filter.classifications')).rejects.toThrow()
    await expect(
      t.asApp(`insert into noise_filter.classifications (listing_id, evidence_hash, input_hash,
        rule_version, classified_at) values (gen_random_uuid(), repeat('a', 64), repeat('a', 64),
        'n1.00000000', now())`),
    ).rejects.toThrow()
  })

  it('parts-rules off: no signal is read, so a buy-in advert reads as unknown, never noise', async () => {
    const rows = withFields(run.dataset, '1816901372840238', { title: 'We buy gaming PCs' })
    for (const partsRules of ['on', 'off'] as const) {
      const u = await createTestDatabase()
      try {
        await u.switches(ALL_ON)
        const ids = await assessed(u, run, rows)
        await u.switches({ 'parts-rules': partsRules })
        const result = await classify(u.db, { listingIds: ids, now: new Date() })
        if (!result.ok) throw new Error('classify failed')
        const one = (await listingIdsBySource(u)).get('1816901372840238')
        const [row] = await u.asPipeline(
          'select reasons from noise_filter.v_classifications where listing_id = $1',
          [one],
        )
        expect(row?.reasons).toEqual(partsRules === 'on' ? ['buy_in'] : [])
      } finally {
        await u.close()
      }
    }
  })
})
