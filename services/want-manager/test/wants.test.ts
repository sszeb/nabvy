import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteWant,
  getPreferences,
  listWants,
  previewWant,
  setActive,
  setPreferences,
  upsertWant,
  wantOwners,
} from '../src/index'
import {
  ALL_ON,
  CHICHESTER,
  createTestDatabase,
  REDHILL,
  seedCentre,
  seedEntitlement,
  seedFairUse,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
  wantInput,
} from './support/database'

// Card: postcode resolution (the point comes from location, the nearest centre from city-pages);
// the active-want cap (subscriptions' tier, else the Free limit; fair use lowers it); the
// per-want controls; preferences with defaults.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
  await seedCentre(db, CHICHESTER)
  await seedCentre(db, { ...REDHILL, verified: true })
}, 60_000)
afterAll(() => db?.close())
beforeEach(async () => {
  await setSwitches(db, ALL_ON)
  await db.sql('delete from want_manager.wants')
  await db.sql('delete from want_manager.preferences')
  await db.sql('delete from subscriptions.entitlements')
  await db.sql('delete from account.standing')
})

const asUser = <T>(userId: string, fn: Parameters<TestDatabase['as']>[1]) =>
  db.as('nabvy_app', fn, userId) as Promise<T>

describe('postcode resolution', () => {
  it('maps the postcode to a point and the nearest active centre, verified or not', async () => {
    const outcome = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(q, wantInput(U1, { postcode: 'RH1 1AA' }), testDeps),
    )
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.value.created).toBe(true)
    expect(outcome.value.want.centreId).toBe('redhill')
    expect(outcome.value.want.centreVerified).toBe(true)
    const [row] = await db.sql('select lat, lng from want_manager.wants where id = $1', [
      outcome.value.want.id,
    ])
    expect(row).toEqual({ lat: 51.2403, lng: -0.171 })
    expect(outcome.value.event.type).toBe('want-manager.changed')
  })

  it('refuses an unknown postcode, and says so when location is off', async () => {
    const unknown = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(q, wantInput(U1, { postcode: 'ZZ9 9ZZ' }), testDeps),
    )
    expect(unknown.ok ? 'ok' : unknown.error.code).toBe('want-manager.postcode_unknown')
    await setSwitches(db, { location: 'off' })
    const off = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(q, wantInput(U1), testDeps),
    )
    expect(off.ok ? 'ok' : off.error.code).toBe('want-manager.location_unavailable')
  })

  it('keeps a null centre while city-pages is off, and previews the centre without writing', async () => {
    await setSwitches(db, { 'city-pages': 'off' })
    const outcome = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(q, wantInput(U1), testDeps),
    )
    expect(outcome.ok && outcome.value.want.centreId).toBe(null)
    await setSwitches(db, { 'city-pages': 'on' })
    const preview = await asUser<Awaited<ReturnType<typeof previewWant>>>(U1, (q) =>
      previewWant(q, wantInput(U1), testDeps),
    )
    expect(preview.ok && preview.value).toEqual({
      centreId: 'chichester',
      centreVerified: false,
      matchingDeals: null,
    })
    const [{ n }] = (await db.sql('select count(*)::int as n from want_manager.wants')) as [
      { n: number },
    ]
    expect(n).toBe(1)
  })
})

describe('the active-want cap', () => {
  const create = (userId: string, postcode = 'PO19 1AA') =>
    asUser<Awaited<ReturnType<typeof upsertWant>>>(userId, (q) =>
      upsertWant(q, wantInput(userId, { postcode }), testDeps),
    )

  it('applies the Free limit of 3 while subscriptions is off', async () => {
    await setSwitches(db, { subscriptions: 'off' })
    await seedEntitlement(db, { userId: U1, status: 'active', wants: 10 }) // ignored while off
    for (let i = 0; i < 3; i += 1) {
      const outcome = await create(U1, i % 2 ? 'RH1 1AA' : 'PO19 1AA')
      expect(outcome.ok).toBe(true)
    }
    const fourth = await create(U1)
    expect(fourth.ok ? 'ok' : fourth.error.code).toBe('want-manager.limit_reached')
    // A paused want does not count, and can be created over the cap.
    const paused = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(q, wantInput(U1, { active: false }), testDeps),
    )
    expect(paused.ok).toBe(true)
    // Resuming it is refused; another user is unaffected.
    const resumed = await asUser<Awaited<ReturnType<typeof setActive>>>(U1, (q) =>
      setActive(
        q,
        { userId: U1, wantId: paused.ok ? paused.value.want.id : '', active: true },
        testDeps,
      ),
    )
    expect(resumed.ok ? 'ok' : resumed.error.code).toBe('want-manager.limit_reached')
    expect((await create(U2)).ok).toBe(true)
  })

  it("uses the tier's want count while subscriptions is on, and fair use only lowers it", async () => {
    await seedEntitlement(db, { userId: U1, status: 'active', wants: 2 })
    expect((await create(U1)).ok).toBe(true)
    expect((await create(U1)).ok).toBe(true)
    const third = await create(U1)
    expect(third.ok ? 'ok' : third.error.code).toBe('want-manager.limit_reached')

    await seedEntitlement(db, { userId: U2, status: 'active', wants: 5 })
    await seedFairUse(db, U2, 1)
    expect((await create(U2)).ok).toBe(true)
    const second = await create(U2)
    expect(second.ok ? 'ok' : second.error.code).toBe('want-manager.limit_reached')
  })

  it('a free user with no entitlement row gets the entitlement fallback, never more', async () => {
    // subscriptions on, no row: getEntitlement's Free fallback (1 want while pricing-console has
    // no `free` row). The injected port is not used here: this is the real @nabvy/subscriptions.
    expect((await create(U1)).ok).toBe(true)
    const second = await create(U1)
    expect(second.ok ? 'ok' : second.error.code).toBe('want-manager.limit_reached')
  })
})

describe('the want and its controls', () => {
  it('replaces a want whole, lists it, pauses and deletes it', async () => {
    const created = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(q, wantInput(U1), testDeps),
    )
    if (!created.ok) throw new Error(created.error.message)
    const id = created.value.want.id
    const replaced = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(
        q,
        wantInput(U1, {
          wantId: id,
          radiusKm: 60,
          deliverySpeed: 'daily',
          deliveryMethods: ['collection', 'posted'],
          alternatives: 'off',
          filter: { query: 'rtx 4080', priceMaxMinor: 200000 },
          criteria: [
            {
              partType: 'gpu',
              catalogueId: null,
              family: 'RTX 40',
              minAttr: null,
              orBetter: false,
            },
          ],
        }),
        testDeps,
      ),
    )
    if (!replaced.ok) throw new Error(replaced.error.message)
    expect(replaced.value.created).toBe(false)
    expect(replaced.value.want).toMatchObject({
      id,
      radiusKm: 60,
      deliverySpeed: 'daily',
      alternatives: 'off',
      filter: { query: 'rtx 4080', priceMaxMinor: 200000 },
      criteria: [{ partType: 'gpu', family: 'RTX 40', orBetter: false }],
    })
    const listed = await asUser<Awaited<ReturnType<typeof listWants>>>(U1, (q) => listWants(q, U1))
    expect(listed.map((w) => w.id)).toEqual([id])

    const paused = await asUser<Awaited<ReturnType<typeof setActive>>>(U1, (q) =>
      setActive(q, { userId: U1, wantId: id, active: false }, testDeps),
    )
    expect(paused.ok && paused.value.changed).toBe(true)
    const again = await asUser<Awaited<ReturnType<typeof setActive>>>(U1, (q) =>
      setActive(q, { userId: U1, wantId: id, active: false }, testDeps),
    )
    expect(again.ok && again.value.changed).toBe(false)

    const owners = await db.as('nabvy_pipeline', (q) => wantOwners(q, [id]))
    expect(owners.get(id)).toBe(U1)

    const deleted = await asUser<Awaited<ReturnType<typeof deleteWant>>>(U1, (q) =>
      deleteWant(q, { userId: U1, wantId: id }),
    )
    expect(deleted.ok && deleted.value.event.key).toBe(`want-manager.changed:${id}@deleted`)
    const twice = await asUser<Awaited<ReturnType<typeof deleteWant>>>(U1, (q) =>
      deleteWant(q, { userId: U1, wantId: id }),
    )
    expect(twice.ok ? 'ok' : twice.error.code).toBe('want-manager.not_found')
    const [{ n }] = (await db.sql('select count(*)::int as n from want_manager.criteria')) as [
      { n: number },
    ]
    expect(n).toBe(0)
  })

  it('refuses a malformed criterion and a cadence off the ladder before touching the database', async () => {
    const badCriterion = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(
        q,
        wantInput(U1, {
          criteria: [
            { partType: 'gpu', catalogueId: null, family: null, minAttr: null, orBetter: true },
          ],
        }),
        testDeps,
      ),
    )
    expect(badCriterion.ok ? 'ok' : badCriterion.error.code).toBe('want-manager.invalid_input')
    const badCadence = await asUser<Awaited<ReturnType<typeof upsertWant>>>(U1, (q) =>
      upsertWant(q, { ...wantInput(U1), cadenceSeconds: 120 } as never, testDeps),
    )
    expect(badCadence.ok ? 'ok' : badCadence.error.code).toBe('want-manager.invalid_input')
  })
})

describe('preferences', () => {
  it('defaults until set, then one row per user', async () => {
    const defaults = await asUser<Awaited<ReturnType<typeof getPreferences>>>(U1, (q) =>
      getPreferences(q, U1),
    )
    expect(defaults).toEqual({
      userId: U1,
      hideNoise: true,
      hideSpam: true,
      hideMultiQuantity: false,
      channels: [],
      quietHours: null,
    })
    const set = (channels: ('push' | 'telegram' | 'email')[]) =>
      asUser<Awaited<ReturnType<typeof setPreferences>>>(U1, (q) =>
        setPreferences(q, {
          userId: U1,
          hideNoise: false,
          hideSpam: true,
          hideMultiQuantity: true,
          channels,
          quietHours: { startMinute: 1320, endMinute: 420 },
        }),
      )
    const first = await set(['telegram'])
    expect(first.ok && first.value.created).toBe(true)
    const second = await set(['telegram', 'push'])
    expect(second.ok && second.value.created).toBe(false)
    expect(second.ok && second.value.preferences).toMatchObject({
      hideNoise: false,
      channels: ['telegram', 'push'],
      quietHours: { startMinute: 1320, endMinute: 420 },
    })
    const [{ n }] = (await db.sql('select count(*)::int as n from want_manager.preferences')) as [
      { n: number },
    ]
    expect(n).toBe(1)
  })
})
