import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyOverride, erase, pointsFor, run } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  RECORDED,
  syntheticListing,
  type TestDatabase,
} from './support/database'

// Rule 11: off writes nothing and every view is empty; shadow fills internal views only and
// every user-facing reader (app.v_pickup_location, pointsFor) gives exactly what off gives;
// on shows rows. erase() and applyOverride() run whatever the switch says.

type Json = Record<string, unknown>
const recorded = loadRun(RECORDED)
const base = recorded.dataset.find((r) => r.recordType === 'listing') as Json
const others = recorded.dataset.filter((r) => r.recordType !== 'listing')
const CHI = {
  cityPageId: '115935195086622',
  name: 'Chichester, West Sussex',
  towns: ['Chichester'],
  lat: 50.8365,
  lng: -0.7792,
}
const VIEWS = ['v_areas', 'v_evidence', 'v_handover', 'v_ai_usage']
const rows = [
  ...others,
  syntheticListing(base, {
    listingId: '7200000000000001',
    title: 'RTX 3090',
    description: 'Collection only from Leeds.',
    location: 'Chichester',
    cityPageId: CHI.cityPageId,
    coordinates: { latitude: 50.84, longitude: -0.78 },
  }),
  syntheticListing(base, {
    listingId: '7200000000000002',
    title: 'RTX 3080',
    description: 'Selling my PC in Leeds, cheap.',
    location: 'Chichester',
    cityPageId: CHI.cityPageId,
    coordinates: { latitude: 50.84, longitude: -0.78 },
  }),
]

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await t.cityPages([CHI])
})
afterEach(async () => {
  await t.close()
})

const tableCount = async () => {
  const [row] = await t.sql(
    `select (select count(*)::int from pickup_location.resolutions)
          + (select count(*)::int from pickup_location.current)
          + (select count(*)::int from pickup_location.handover)
          + (select count(*)::int from pickup_location.ai_queue) as n`,
  )
  return row?.n
}
const viewRows = async () => {
  const out: Record<string, number> = {}
  for (const view of VIEWS) {
    const [row] = await t.asPipeline(`select count(*)::int as n from pickup_location.${view}`)
    out[view] = Number(row?.n)
  }
  const [app] = await t.asApp('select count(*)::int as n from app.v_pickup_location')
  out.app = Number(app?.n)
  return out
}
const points = async (ids: string[]) =>
  [...(await pointsFor(t.db, ids)).entries()].map(([id, p]) => [
    id,
    p.point,
    p.townOrArea,
    p.approximate,
    p.basis,
  ])

describe('switch', () => {
  it('off: acknowledges, writes nothing, and every view is empty', async () => {
    const listingIds = await detailed(t, recorded, rows)
    await t.switches({ 'pickup-location': 'off' })
    expect(await run(t.db, { pass: 'detail', listingIds })).toMatchObject({
      ok: true,
      value: { open: false, events: [] },
    })
    expect(await tableCount()).toBe(0)
    expect(Object.values(await viewRows()).every((n) => n === 0)).toBe(true)

    await t.switches({ 'pickup-location': 'on' })
    expect((await run(t.db, { pass: 'detail', listingIds })).ok).toBe(true)
    const on = await viewRows()
    expect(on).toMatchObject({ v_areas: 2, v_handover: 2, v_ai_usage: 1, app: 2 })
    expect(on.v_evidence).toBeGreaterThan(0)
    await t.switches({ 'pickup-location': 'off' })
    expect(Object.values(await viewRows()).every((n) => n === 0)).toBe(true)
  })

  it('a paused pipeline writes nothing', async () => {
    const listingIds = await detailed(t, recorded, rows)
    await t.switches({ pipeline: 'off' })
    expect(await run(t.db, { pass: 'detail', listingIds })).toMatchObject({
      ok: true,
      value: { open: false },
    })
    expect(await tableCount()).toBe(0)
  })

  it('shadow: internal views fill, the user-facing view stays empty, pointsFor equals off', async () => {
    const listingIds = await detailed(t, recorded, rows)
    await t.switches({ 'pickup-location': 'off' })
    const off = await points(listingIds)
    expect(off).toHaveLength(2)
    expect(
      off.every(
        ([, p, town, approx, basis]) =>
          town === 'Chichester' && approx === true && basis === 'fallback' && p !== null,
      ),
    ).toBe(true)

    await t.switches({ 'pickup-location': 'shadow' })
    const result = await run(t.db, { pass: 'detail', listingIds })
    expect(result.ok && result.value.resolved).toHaveLength(2)
    const views = await viewRows()
    expect(views.v_areas).toBe(2)
    expect(views.app).toBe(0)
    expect(await points(listingIds)).toEqual(off)

    await t.switches({ 'pickup-location': 'on' })
    const on = await points(listingIds)
    expect(on).not.toEqual(off)
    const conflicting = on.find(([, , town]) => town === 'Leeds')
    expect(conflicting?.[3]).toBe(true)
  })

  it('the user-facing view needs listing-suppression on and hides a suppressed listing', async () => {
    const listingIds = await detailed(t, recorded, rows)
    await run(t.db, { pass: 'detail', listingIds })
    expect((await viewRows()).app).toBe(2)
    await t.switches({ 'listing-suppression': 'off' })
    expect((await viewRows()).app).toBe(0)
    await t.switches({ 'listing-suppression': 'on' })
    await t.sql(
      `insert into listing_suppression.entries (kind, value, request_id)
       select 'listing_hash', listing_suppression.listing_hash(source, source_listing_id),
              '00000000-0000-7000-8000-000000000042'
       from listing_ingest.v_listings where id = $1`,
      [listingIds[0]],
    )
    expect((await viewRows()).app).toBe(1)
  })

  it('erase removes everything whatever the switch; an override moves the current row', async () => {
    const listingIds = await detailed(t, recorded, rows)
    await run(t.db, { pass: 'detail', listingIds })
    const target = listingIds[0] as string
    const applied = await applyOverride(t.db, {
      listingId: target,
      areaId: `cp:${CHI.cityPageId}`,
      by: '00000000-0000-7000-8000-000000000009',
      reason: 'The seller confirmed collection is in Chichester.',
    })
    expect(applied).toEqual({ ok: true, value: { applied: true } })
    const [row] = await t.asPipeline(
      'select town_or_area, conflict, approximate from pickup_location.v_areas where listing_id = $1',
      [target],
    )
    expect(row).toEqual({ town_or_area: 'Chichester', conflict: false, approximate: false })
    expect(
      await applyOverride(t.db, {
        listingId: target,
        areaId: 'cp:nope',
        by: '00000000-0000-7000-8000-000000000009',
        reason: 'x',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'pickup-location.area_not_found' },
    })

    await t.switches({ 'pickup-location': 'off' })
    expect(await erase(t.db, [target])).toBe(1)
    const [left] = await t.sql(
      `select (select count(*)::int from pickup_location.resolutions where listing_id = $1)
            + (select count(*)::int from pickup_location.candidates where listing_id = $1)
            + (select count(*)::int from pickup_location.overrides where listing_id = $1) as n`,
      [target],
    )
    expect(left?.n).toBe(0)
    expect(await tableCount()).toBeGreaterThan(0)
  })
})
