import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { upsertWant } from '../src/index'
import {
  ALL_ON,
  CHICHESTER,
  createTestDatabase,
  seedCentre,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
  wantInput,
} from './support/database'

// Card: "a user cannot read another user's wants; the aggregate views carry no user IDs."

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
  await seedCentre(db, CHICHESTER)
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const rows = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows

describe('row-level security', () => {
  it('a user cannot read, update, insert or delete as another user', async () => {
    const outcome = await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)
    if (!outcome.ok) throw new Error(outcome.error.message)
    const id = outcome.value.want.id

    for (const table of ['wants', 'criteria', 'v_want_manager_wants']) {
      const column = table === 'criteria' ? 'want_id' : 'id'
      const asU2 = await db.as(
        'nabvy_app',
        (q) => q.execute(`select * from want_manager.${table} where ${column} = '${id}'`),
        U2,
      )
      expect(rows(asU2), table).toHaveLength(0)
    }

    await db.as(
      'nabvy_app',
      (q) => q.execute(`update want_manager.wants set radius_km = 999 where id = '${id}'`),
      U2,
    )
    await db.as(
      'nabvy_app',
      (q) => q.execute(`delete from want_manager.wants where id = '${id}'`),
      U2,
    )
    const [row] = await db.sql('select radius_km from want_manager.wants where id = $1', [id])
    expect(row?.radius_km).toBe(25)

    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `insert into want_manager.criteria (want_id, user_id, position, part_type, family)
             values ('${id}', '${U2}', 5, 'gpu', 'RTX 40')`,
          ),
        U1,
      ),
    ).rejects.toThrow() // WITH CHECK refuses a row for another user even as U1

    // Outside withUser nothing is visible at all.
    const noUser = await db.as('nabvy_app', (q) => q.execute('select * from want_manager.wants'))
    expect(rows(noUser)).toHaveLength(0)
  })

  it('no internal view carries a user ID, and the pipeline cannot read the user-facing view', async () => {
    await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)
    for (const view of ['v_wants', 'v_want_terms_by_centre', 'v_want_parts', 'v_want_areas']) {
      const result = rows(
        await db.as('nabvy_pipeline', (q) => q.execute(`select * from want_manager.${view}`)),
      )
      expect(result.length, view).toBeGreaterThan(0)
      for (const row of result) {
        expect(Object.keys(row), view).not.toContain('user_id')
        expect(Object.keys(row), view).not.toContain('userId')
      }
    }
    await expect(
      db.as('nabvy_pipeline', (q) => q.execute('select * from want_manager.v_want_manager_wants')),
    ).rejects.toThrow()
    await expect(
      db.as('nabvy_app', (q) => q.execute('select * from want_manager.v_wants'), U1),
    ).rejects.toThrow()
  })

  it('the fair-use cap function returns nothing outside withUser', async () => {
    await db.sql(
      `insert into account.standing (user_id, status, limits) values ($1, 'active', '{"maxActiveHunts": 1}')`,
      [U1],
    )
    const outside = rows(
      await db.as('nabvy_app', (q) => q.execute('select * from want_manager.fair_use_want_cap()')),
    )
    expect(outside).toHaveLength(0)
    const inside = rows(
      await db.as(
        'nabvy_app',
        (q) => q.execute('select * from want_manager.fair_use_want_cap()'),
        U1,
      ),
    )
    expect(inside).toEqual([{ max_active_hunts: 1 }])
  })
})
