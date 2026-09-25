import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  type SyntheticListing,
  type SyntheticPage,
  type TestDatabase,
} from '../support/database'

// Stage "resolve": synthetic listings (the card's cases; `"synthetic": true` in each input.json)
// written as listing-ingest and detail-evidence rows over the seeded city pages, then resolved
// by the detail pass on the real migrations in PGlite. Each case checks, per listing, what the
// internal and user-facing views show, and that no view carries a full postcode or the
// listing's own coordinates.

type Json = Record<string, unknown>

interface Input {
  synthetic: true
  builtFrom: string
  pages: SyntheticPage[]
  listings: SyntheticListing[]
  postcodes?: Record<string, { lat: number; lng: number }>
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

async function observe(): Promise<Record<string, Json>> {
  const listings: Record<string, Json> = {}
  const of = (sid: string) => {
    listings[sid] ??= { appRows: 0 }
    return listings[sid] as Json
  }
  for (const a of await t.asPipeline(
    `select l.source_listing_id as sid, a.town_or_area, a.approximate, a.conflict, a.basis, a.status
     from pickup_location.v_areas a join listing_ingest.v_listings l on l.id = a.listing_id`,
  )) {
    Object.assign(of(a.sid as string), {
      status: a.status,
      townOrArea: a.town_or_area,
      approximate: a.approximate,
      conflict: a.conflict,
      basis: a.basis,
    })
  }
  const listingIds = await t.asPipeline(
    'select id, source_listing_id as sid from listing_ingest.v_listings',
  )
  const bySid = new Map(listingIds.map((r) => [String(r.id), String(r.sid)]))
  for (const u of await t.asApp('select * from app.v_pickup_location')) {
    const o = of(bySid.get(String(u.listing_id)) as string)
    o.appRows = Number(o.appRows) + 1
    Object.assign(o, {
      areaDistrict: u.area_district,
      noteCode: u.note_code,
      notePlaceLabel: u.note_place_label,
      listedInLabel: u.listed_in_label,
      source: u.source,
      lat: u.lat,
      lng: u.lng,
      collection: u.collection,
      postage: u.postage,
      localDelivery: u.local_delivery,
      meetupOffered: u.meetup_offered,
    })
  }
  for (const h of await t.asPipeline(
    `select l.source_listing_id as sid, h.postage_only_text, h.courier_only_text, h.delivery_only_text
     from pickup_location.v_handover h join listing_ingest.v_listings l on l.id = h.listing_id`,
  )) {
    Object.assign(of(h.sid as string), {
      postageOnlyText: h.postage_only_text,
      courierOnlyText: h.courier_only_text,
      deliveryOnlyText: h.delivery_only_text,
    })
  }
  return listings
}

describe('resolve', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as Input
    const expected = read(new URL(`${id}/expected.json`, CASES)) as {
      listings: Record<string, Json>
    }
    await t.cityPages(input.pages)
    const listingIds = await detailed(t, input.listings)
    const postcodes = new Map(Object.entries(input.postcodes ?? {}))
    const result = await run(
      t.db,
      { pass: 'detail', listingIds },
      { postcodePoint: async (_q, postcode) => postcodes.get(postcode) },
    )
    if (!result.ok) throw new Error(result.error.message)
    const all = await observe()

    // Nothing a view shows is a full postcode, and no display point is a listing's own
    // coordinates (docs/decisions.md, "Where an item really is"; the location-precision test).
    const views = ['pickup_location.v_areas', 'pickup_location.v_evidence', 'app.v_pickup_location']
    for (const view of views) {
      const text = JSON.stringify(
        view.startsWith('app.')
          ? await t.asApp(`select * from ${view}`)
          : await t.asPipeline(`select * from ${view}`),
      )
      for (const postcode of Object.keys(input.postcodes ?? {})) {
        expect(text, `${view} shows ${postcode}`).not.toContain(postcode)
        expect(text, `${view} shows the inward code`).not.toContain(postcode.slice(-3))
      }
    }
    const shown = await t.asApp('select lat, lng from app.v_pickup_location')
    for (const l of input.listings) {
      if (!l.coordinates) continue
      for (const row of shown) {
        expect([row.lat, row.lng]).not.toEqual([l.coordinates.latitude, l.coordinates.longitude])
      }
    }

    const observed: Json = {}
    for (const [sid, want] of Object.entries(expected.listings)) {
      const got = (all[sid] ?? {}) as Json
      observed[sid] = Object.fromEntries(Object.keys(want).map((k) => [k, got[k]]))
    }
    expect(observed).toEqual(expected.listings)
  })
})
