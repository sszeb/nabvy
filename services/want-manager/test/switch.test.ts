import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listWants, setPreferences, upsertWant, wantOwners } from '../src/index'
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

// Rule 11 of docs/design/modules/_rules.md. Off: no new or changed wants (card, "When off"),
// nothing is written, every view is empty. Shadow: writes go through, the internal views have
// rows, the user-facing view has none.

const U1 = '0190f1d2-0000-7000-8000-000000000001'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedCentre(db, CHICHESTER)
}, 60_000)
afterAll(() => db?.close())
beforeEach(async () => {
  await setSwitches(db, ALL_ON)
  await db.sql('delete from want_manager.wants')
})

const rows = (result: unknown) => (result as { rows: unknown[] }).rows
const internal = (view: string) =>
  db.as('nabvy_pipeline', (q) => q.execute(`select * from want_manager.${view}`))
const userFacing = () =>
  db.as('nabvy_app', (q) => q.execute('select * from want_manager.v_want_manager_wants'), U1)
const INTERNAL = ['v_wants', 'v_want_terms_by_centre', 'v_want_parts', 'v_want_areas']

describe('switch', () => {
  it('off: refuses every write, writes nothing, and every view is empty', async () => {
    const created = await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)
    if (!created.ok) throw new Error(created.error.message)
    await setSwitches(db, { 'want-manager': 'off' })

    const want = await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)
    expect(want.ok ? 'ok' : want.error.code).toBe('want-manager.off')
    const prefs = await db.as(
      'nabvy_app',
      (q) =>
        setPreferences(q, {
          userId: U1,
          hideNoise: true,
          hideSpam: true,
          hideMultiQuantity: false,
          channels: [],
          quietHours: null,
        }),
      U1,
    )
    expect(prefs.ok ? 'ok' : prefs.error.code).toBe('want-manager.off')
    const [{ n }] = (await db.sql('select count(*)::int as n from want_manager.wants')) as [
      { n: number },
    ]
    expect(n).toBe(1)
    for (const view of INTERNAL) expect(rows(await internal(view)), view).toHaveLength(0)
    expect(rows(await userFacing())).toHaveLength(0)
    expect(await db.as('nabvy_app', (q) => listWants(q, U1), U1)).toEqual([])
    expect(
      (await db.as('nabvy_pipeline', (q) => wantOwners(q, [created.value.want.id]))).size,
    ).toBe(0)
  })

  it('shadow: writes go through, internal views have rows, the user-facing view has none', async () => {
    await setSwitches(db, { 'want-manager': 'shadow' })
    const want = await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)
    expect(want.ok).toBe(true)
    for (const view of INTERNAL) expect(rows(await internal(view)).length, view).toBeGreaterThan(0)
    expect(rows(await userFacing())).toHaveLength(0)
    expect(await db.as('nabvy_app', (q) => listWants(q, U1), U1)).toEqual([])
  })

  it('on: the user-facing view shows the own wants', async () => {
    await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)
    expect(rows(await userFacing())).toHaveLength(1)
  })
})
