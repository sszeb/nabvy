import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { onWantManagerChanged } from '../src/index'
import {
  createTestDatabase,
  planTerms,
  READY,
  seedCentre,
  seedWant,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: the handler runs twice on the same batch and the second
// run writes nothing. The plan is a function of the views, so the same batch yields the same plan.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitches(db, READY)
}, 60_000)
afterAll(() => db.close())

describe('search-planner idempotency', () => {
  it('writes once and emits once for a replayed want-manager.changed batch', async () => {
    await seedCentre(db, { cityPageId: '101' })
    const { wantId } = await seedWant(db, { centreId: '101', families: ['RTX 3090'] })
    const batch = [{ wantIds: [wantId] }]
    const first = await db.as('nabvy_pipeline', (tx) => onWantManagerChanged(tx, batch))
    expect(first.events).toHaveLength(1)
    expect(first.events[0]?.type).toBe('search-planner.plan-changed')
    const stamps = await db.sql('select updated_at from search_planner.plan_terms order by term')
    const rows = await planTerms(db)
    const second = await db.as('nabvy_pipeline', (tx) => onWantManagerChanged(tx, batch))
    expect(second.events).toEqual([])
    expect(await planTerms(db)).toEqual(rows)
    expect(await db.sql('select updated_at from search_planner.plan_terms order by term')).toEqual(
      stamps,
    )
  })

  it('refuses a payload that is not want-manager.changed', async () => {
    await expect(
      db.as('nabvy_pipeline', (tx) => onWantManagerChanged(tx, [{ userId: 'x' }])),
    ).rejects.toThrow()
  })
})
