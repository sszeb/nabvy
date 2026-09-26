import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPickup, listForDay, planDay, updateDefaults } from '../src/index'
import {
  createTestDatabase,
  DAY,
  deps,
  seedUser,
  setSwitch,
  type TestDatabase,
  U1,
  U2,
} from './support/database'

// Card: "a user cannot read another user's pickups; the db test finds no view over pickups or
// route_plans; encrypted fields round-trip". search-map-routes.md §5.3: no address, postcode or
// point in a plain column.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitch(db, 'on'))

const rows = (result: unknown) => (result as { rows: unknown[] }).rows

const create = (userId: string, label: string, postcode: string) =>
  db.as(
    'nabvy_app',
    (q) =>
      createPickup(
        q,
        {
          userId,
          label,
          postcode,
          addressText: '12 Sea Road',
          notes: 'ring the bell twice',
          day: DAY,
          window: { kind: 'at', start: '10:30' },
        },
        deps(),
      ),
    userId,
  )

describe('row-level security and encryption at rest', () => {
  it('a user cannot read, update, delete or insert as another user', async () => {
    const outcome = await create(U1, 'RTX 3090 – Bognor', 'PO21 1AA')
    if (!outcome.ok) throw new Error(outcome.error.message)
    const id = outcome.value.pickup.id

    const asU2 = await db.as(
      'nabvy_app',
      (q) => q.execute(`select * from pickup_routes.pickups where id = '${id}'`),
      U2,
    )
    expect(rows(asU2)).toHaveLength(0)
    const listed = await db.as(
      'nabvy_app',
      (q) => listForDay(q, { userId: U2, day: DAY }, deps()),
      U2,
    )
    expect(listed.ok && listed.value).toEqual([])

    await db.as(
      'nabvy_app',
      (q) => q.execute(`update pickup_routes.pickups set label = 'stolen' where id = '${id}'`),
      U2,
    )
    await db.as(
      'nabvy_app',
      (q) => q.execute(`delete from pickup_routes.pickups where id = '${id}'`),
      U2,
    )
    const [row] = await db.sql(`select label from pickup_routes.pickups where id = $1`, [id])
    expect(row?.label).toBe('RTX 3090 – Bognor')

    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `insert into pickup_routes.pickups (user_id, label, private_enc, day, window_kind) values ('${U2}', 'x', '\\x01', '${DAY}', 'unagreed')`,
          ),
        U1,
      ),
    ).rejects.toThrow()
  })

  it('the schema has no view over pickups, route_plans or anything else', async () => {
    const views = await db.sql(`select viewname from pg_views where schemaname = 'pickup_routes'`)
    expect(views).toEqual([])
  })

  it('addresses, notes, postcode and points are sealed at rest and round-trip for the owner', async () => {
    const outcome = await create(U1, 'Monitor – Portsmouth', 'PO1 1AA')
    if (!outcome.ok) throw new Error(outcome.error.message)
    const { pickup } = outcome.value
    expect(pickup.postcode).toBe('PO1 1AA')
    expect(pickup.addressText).toBe('12 Sea Road')
    expect(pickup.notes).toBe('ring the bell twice')
    expect(pickup.point).toEqual({ lat: 50.7989, lng: -1.0912 })

    const [raw] = await db.sql(
      `select encode(private_enc, 'escape') as blob, to_jsonb(p) - 'private_enc' as plain from pickup_routes.pickups p where id = $1`,
      [pickup.id],
    )
    const plain = JSON.stringify(raw?.plain)
    for (const secret of ['PO1 1AA', 'Sea Road', 'ring the bell', '50.7989', '-1.0912']) {
      expect(String(raw?.blob)).not.toContain(secret)
      expect(plain).not.toContain(secret)
    }

    const listed = await db.as(
      'nabvy_app',
      (q) => listForDay(q, { userId: U1, day: DAY }, deps()),
      U1,
    )
    if (!listed.ok) throw new Error(listed.error.message)
    expect(listed.value.find((p) => p.id === pickup.id)?.addressText).toBe('12 Sea Road')
  })

  it('a wrong key refuses to open, rather than returning garbage', async () => {
    await create(U1, 'Keyboard', 'PO18 1AA')
    const wrong = deps({ dataKey: 'ff'.repeat(32) })
    await expect(
      db.as('nabvy_app', (q) => listForDay(q, { userId: U1, day: DAY }, wrong), U1),
    ).rejects.toThrow(/does not open/)
  })

  it("the pipeline can purge but cannot read a sealed column, and another user's plan is invisible", async () => {
    await db.as(
      'nabvy_app',
      (q) => updateDefaults(q, { userId: U2, homePostcode: 'PO19 1AA' }, deps()),
      U2,
    )
    await create(U2, 'Case', 'BN17 1AA')
    const planned = await db.as(
      'nabvy_app',
      (q) => planDay(q, { userId: U2, day: DAY }, deps()),
      U2,
    )
    expect(planned.ok).toBe(true)
    const plans = await db.as(
      'nabvy_app',
      (q) => q.execute(`select id from pickup_routes.route_plans`),
      U1,
    )
    expect(rows(plans)).toHaveLength(0)
    await expect(
      db.as('nabvy_pipeline', (q) =>
        q.execute(`select private_enc from pickup_routes.pickups limit 1`),
      ),
    ).rejects.toThrow()
  })
})
