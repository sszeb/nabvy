import { state } from '@nabvy/switches'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  listOneOffRuns,
  listPlan,
  onWantManagerChanged,
  recordOneOffRun,
  replan,
} from '../src/index'
import {
  createTestDatabase,
  READY,
  seedCentre,
  seedWant,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md. Off (the default): the handler acknowledges and
// writes nothing, recording a one-off is refused, and both views are empty (card, "When off: no
// plan, so nothing is scheduled"). Shadow: runs and writes, internal views have rows (the module
// has no user-facing view). On: the same.

let db: TestDatabase
let wantId: string
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitches(db, { ...READY, 'search-planner': 'off' })
  await seedCentre(db, { cityPageId: '101' })
  wantId = (await seedWant(db, { centreId: '101', families: ['RTX 3090'] })).wantId
}, 60_000)
afterAll(() => db.close())

describe('search-planner switch', () => {
  it('reads off with no seed row', async () => {
    await db.sql(`delete from switches.switches where name = 'search-planner'`)
    expect(await db.as('nabvy_pipeline', (tx) => state(tx, 'search-planner'))).toBe('off')
  })

  it('off: acknowledges events, writes nothing, refuses one-offs, shows nothing', async () => {
    const out = await db.as('nabvy_pipeline', (tx) =>
      onWantManagerChanged(tx, [{ wantIds: [wantId] }]),
    )
    expect(out.events).toEqual([])
    expect(await db.sql('select * from search_planner.plan_terms')).toEqual([])
    await expect(
      db.as('nabvy_pipeline', (tx) =>
        recordOneOffRun(tx, { purpose: 'verification', input: { centreId: '101', terms: ['pc'] } }),
      ),
    ).rejects.toMatchObject({ code: 'search-planner.off' })
    expect(await db.sql('select * from search_planner.one_off_runs')).toEqual([])
  })

  it('off: views are empty even with rows stored', async () => {
    await setSwitches(db, { 'search-planner': 'on' })
    await db.as('nabvy_pipeline', (tx) => replan(tx))
    await db.as('nabvy_pipeline', (tx) =>
      recordOneOffRun(tx, { purpose: 'verification', input: { centreId: '909', terms: ['pc'] } }),
    )
    expect(await db.as('nabvy_pipeline', (tx) => listPlan(tx))).toHaveLength(3)
    await setSwitches(db, { 'search-planner': 'off' })
    expect(await db.as('nabvy_pipeline', (tx) => listPlan(tx))).toEqual([])
    expect(await db.as('nabvy_pipeline', (tx) => listOneOffRuns(tx))).toEqual([])
  })

  it('shadow: runs, writes and shows internal rows', async () => {
    await db.sql('delete from search_planner.plan_terms')
    await db.sql('delete from search_planner.plans')
    await setSwitches(db, { 'search-planner': 'shadow' })
    const out = await db.as('nabvy_pipeline', (tx) =>
      onWantManagerChanged(tx, [{ wantIds: [wantId] }]),
    )
    expect(out.events).toHaveLength(1)
    expect(await db.as('nabvy_pipeline', (tx) => listPlan(tx))).toHaveLength(3)
    expect(await db.as('nabvy_pipeline', (tx) => listOneOffRuns(tx))).toHaveLength(1)
  })
})
