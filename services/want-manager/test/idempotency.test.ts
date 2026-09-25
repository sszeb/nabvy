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

// Rule 8 of docs/design/modules/_rules.md: the same want saved twice writes once and republishes
// the same key (the transport drops it); changed content is a new version and a new key.

const U1 = '0190f1d2-0000-7000-8000-000000000001'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedCentre(db, CHICHESTER)
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

describe('idempotency', () => {
  it('a replay of the same want writes nothing and republishes the same key', async () => {
    const first = await db.as('nabvy_app', (q) => upsertWant(q, wantInput(U1), testDeps), U1)
    if (!first.ok) throw new Error(first.error.message)
    const id = first.value.want.id
    const [before] = await db.sql('select updated_at from want_manager.wants where id = $1', [id])

    // The same content with the criteria's keys in another order and a differently spaced postcode.
    const replayInput = wantInput(U1, { wantId: id, postcode: 'po191aa' })
    replayInput.criteria = replayInput.criteria.map((c) => JSON.parse(JSON.stringify(c)))
    const second = await db.as('nabvy_app', (q) => upsertWant(q, replayInput, testDeps), U1)
    if (!second.ok) throw new Error(second.error.message)
    expect(second.value.changed).toBe(false)
    expect(second.value.event.key).toBe(first.value.event.key)
    const [after] = await db.sql('select updated_at from want_manager.wants where id = $1', [id])
    expect(String(after?.updated_at)).toBe(String(before?.updated_at))
    const [{ n }] = (await db.sql('select count(*)::int as n from want_manager.wants')) as [
      { n: number },
    ]
    expect(n).toBe(1)

    // Changed content: one row still, a new key.
    const third = await db.as(
      'nabvy_app',
      (q) => upsertWant(q, wantInput(U1, { wantId: id, radiusKm: 30 }), testDeps),
      U1,
    )
    if (!third.ok) throw new Error(third.error.message)
    expect(third.value.changed).toBe(true)
    expect(third.value.event.key).not.toBe(first.value.event.key)
    const [{ n: still }] = (await db.sql('select count(*)::int as n from want_manager.wants')) as [
      { n: number },
    ]
    expect(still).toBe(1)

    // Out of order: the first content again is the first key again, so a late replay of an old
    // event is recognisable as old by its key rather than mistaken for a new version.
    const back = await db.as(
      'nabvy_app',
      (q) => upsertWant(q, wantInput(U1, { wantId: id }), testDeps),
      U1,
    )
    expect(back.ok && back.value.event.key).toBe(first.value.event.key)
  })
})
