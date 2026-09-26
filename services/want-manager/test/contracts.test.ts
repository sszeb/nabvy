import { parseEvent } from '@nabvy/contracts'
import {
  events,
  WANT_MANAGER_CADENCE_STEP_SECONDS,
  WantManagerAlternatives,
  WantManagerChannel,
  WantManagerDeliveryMethod,
  WantManagerDeliverySpeed,
  WantManagerPartType,
  WantManagerPipelineWant,
  WantManagerTermsByCentre,
  WantManagerWant,
  WantManagerWantArea,
  WantManagerWantPart,
} from '@nabvy/contracts/modules/want-manager'
import {
  WANT_MANAGER_ALTERNATIVES,
  WANT_MANAGER_CADENCE_STEPS,
  WANT_MANAGER_CHANNELS,
  WANT_MANAGER_DELIVERY_METHODS,
  WANT_MANAGER_DELIVERY_SPEEDS,
  WANT_MANAGER_PART_TYPES,
} from '@nabvy/db/schema/want-manager'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listWants, upsertWant } from '../src/index'
import {
  ALL_ON,
  CHICHESTER,
  createTestDatabase,
  seedCatalogueItem,
  seedCentre,
  seedEntitlement,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
  wantInput,
} from './support/database'

const U1 = '0190f1d2-0000-7000-8000-000000000001'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedCentre(db, CHICHESTER)
  await seedCatalogueItem(db, {
    catalogueId: 'gpu:rtx-4080',
    kind: 'gpu',
    family: 'RTX 40',
    name: 'RTX 4080',
  })
  await seedEntitlement(db, { userId: U1, status: 'active', wants: 5 })
}, 60_000)
afterAll(() => db?.close())
beforeEach(async () => {
  await setSwitches(db, ALL_ON)
  await db.sql('delete from want_manager.wants')
})

const rows = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows
const internal = (view: string) =>
  db.as('nabvy_pipeline', (q) => q.execute(`select * from want_manager.${view}`))
const iso = (v: unknown) => new Date(String(v)).toISOString()

describe('contracts', () => {
  it('the schema check lists match the contract enums', () => {
    expect([...WANT_MANAGER_CADENCE_STEPS]).toEqual([...WANT_MANAGER_CADENCE_STEP_SECONDS])
    expect([...WANT_MANAGER_DELIVERY_SPEEDS]).toEqual(WantManagerDeliverySpeed.options)
    expect([...WANT_MANAGER_DELIVERY_METHODS]).toEqual(WantManagerDeliveryMethod.options)
    expect([...WANT_MANAGER_ALTERNATIVES]).toEqual(WantManagerAlternatives.options)
    expect([...WANT_MANAGER_PART_TYPES]).toEqual(WantManagerPartType.options)
    expect([...WANT_MANAGER_CHANNELS]).toEqual(WantManagerChannel.options)
  })

  it('the changed event and the want parse', async () => {
    const outcome = await db.as(
      'nabvy_app',
      (q) => upsertWant(q, wantInput(U1, { deliveryMethods: ['collection', 'posted'] }), testDeps),
      U1,
    )
    if (!outcome.ok) throw new Error(outcome.error.message)
    parseEvent(events, outcome.value.event)
    WantManagerWant.parse(outcome.value.want)
    for (const want of await db.as('nabvy_app', (q) => listWants(q, U1), U1)) {
      WantManagerWant.parse(want)
    }
  })

  it('every internal view row parses', async () => {
    await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)

    const wants = rows(await internal('v_wants'))
    expect(wants.length).toBeGreaterThan(0)
    for (const r of wants) {
      const parsed = WantManagerPipelineWant.parse({
        id: r.id,
        centreId: r.centre_id,
        lat: r.lat,
        lng: r.lng,
        radiusKm: r.radius_km,
        priceCapMinor: r.price_cap_minor === null ? null : Number(r.price_cap_minor),
        currency: r.currency,
        active: r.active,
        cadenceSeconds: r.cadence_seconds,
        deliverySpeed: r.delivery_speed,
        deliveryMethods: r.delivery_methods,
        alternatives: r.alternatives,
        pcContainment: r.pc_containment,
        alternativesMaxPriceMinor:
          r.alternatives_max_price_minor === null ? null : Number(r.alternatives_max_price_minor),
        instantAlternatives: r.instant_alternatives,
        instantTopPicks: r.instant_top_picks,
        filter: r.filter,
        criteria: r.criteria,
        paid: r.paid,
        updatedAt: iso(r.updated_at),
      })
      expect(parsed.paid).toBe(true)
      expect(parsed.criteria).toHaveLength(2)
    }

    const terms = rows(await internal('v_want_terms_by_centre'))
    expect(terms).toHaveLength(1) // the GPU resolves to its family; RAM names no term
    for (const r of terms) {
      const parsed = WantManagerTermsByCentre.parse({
        centreId: r.centre_id,
        family: r.family,
        wantCount: Number(r.want_count),
        paidWantCount: Number(r.paid_want_count),
      })
      expect(parsed).toEqual({
        centreId: 'chichester',
        family: 'RTX 40',
        wantCount: 1,
        paidWantCount: 1,
      })
    }

    const parts = rows(await internal('v_want_parts'))
    expect(parts).toHaveLength(2)
    for (const r of parts) {
      WantManagerWantPart.parse({
        centreId: r.centre_id,
        partType: r.part_type,
        catalogueId: r.catalogue_id,
        family: r.family,
      })
    }

    const areas = rows(await internal('v_want_areas'))
    expect(areas).toHaveLength(1)
    for (const r of areas) {
      const parsed = WantManagerWantArea.parse({
        centreId: r.centre_id,
        lat: r.lat,
        lng: r.lng,
        radiusKm: r.radius_km,
        acceptsDelivery: r.accepts_delivery,
      })
      // 50.8367 → 50.85, -0.7792 → -0.80: the 0.05° grid, never the exact point.
      expect(parsed).toEqual({
        centreId: 'chichester',
        lat: 50.85,
        lng: -0.8,
        radiusKm: 25,
        acceptsDelivery: false,
      })
    }
  })
})
