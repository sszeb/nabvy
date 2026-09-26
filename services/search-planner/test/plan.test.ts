import type { EventEnvelope } from '@nabvy/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addAdminTestPair,
  listOneOffRuns,
  listPlan,
  recordOneOffRun,
  removeAdminTestPair,
  replan,
  SearchPlannerRefused,
  setOneOffRunStatus,
} from '../src/index'
import {
  createTestDatabase,
  deleteWant,
  planTerms,
  READY,
  seedAdmin,
  seedCentre,
  seedWant,
  setSwitches,
  type TestDatabase,
} from './support/database'

// The card's tests (docs/design/modules/search-planner.md, "Tests and fixtures") against the
// real migrations: a plan from want counts; a pair leaves when its last want goes; no user ID
// reaches a plan; verification needs no approval and any other one-off without one is refused;
// an admin-test pair left after want-manager is on fails.

let db: TestDatabase
beforeEach(async () => {
  await db?.close()
  db = await createTestDatabase()
  await setSwitches(db, READY)
}, 60_000)
afterAll(() => db.close())

const pipeline = <T>(fn: Parameters<TestDatabase['as']>[1]) =>
  db.as('nabvy_pipeline', fn) as Promise<T>

const centresOf = (events: EventEnvelope[]) =>
  events.flatMap((e) => (e.payload as { centreIds: string[] }).centreIds)

describe('the plan', () => {
  it('turns want counts per centre into a family pair and the container pairs', async () => {
    await seedCentre(db, { cityPageId: '101' })
    await seedWant(db, { centreId: '101', families: ['RTX 3090'], paid: true })
    await seedWant(db, { centreId: '101', families: ['RTX 3090'] })
    const { events } = await pipeline<Awaited<ReturnType<typeof replan>>>((tx) => replan(tx))
    expect(centresOf(events)).toEqual(['101'])
    const plan = await pipeline<Awaited<ReturnType<typeof listPlan>>>((tx) => listPlan(tx))
    expect(plan).toEqual([
      {
        centreId: '101',
        term: 'rtx 3090',
        class: 'narrow',
        origins: ['wants'],
        wantCount: 2,
        paidWantCount: 1,
        rank: 1,
      },
      {
        centreId: '101',
        term: 'gaming pc',
        class: 'broad',
        origins: ['wants'],
        wantCount: 2,
        paidWantCount: 1,
        rank: 2,
      },
      {
        centreId: '101',
        term: 'pc',
        class: 'broad',
        origins: ['wants'],
        wantCount: 2,
        paidWantCount: 1,
        rank: 3,
      },
    ])
  })

  it('drops a pair when its last want goes, and nothing runs for the centre', async () => {
    await seedCentre(db, { cityPageId: '101' })
    const a = await seedWant(db, { centreId: '101', families: ['RTX 3090'] })
    const b = await seedWant(db, { centreId: '101', families: ['RTX 4090'] })
    await pipeline((tx) => replan(tx))
    await deleteWant(db, b.wantId)
    const second = await pipeline<Awaited<ReturnType<typeof replan>>>((tx) => replan(tx))
    expect(centresOf(second.events)).toEqual(['101'])
    expect((await planTerms(db)).map((r) => r.term)).toEqual(['gaming pc', 'pc', 'rtx 3090'])
    await deleteWant(db, a.wantId)
    await pipeline((tx) => replan(tx))
    expect(await planTerms(db)).toEqual([])
    expect(await pipeline((tx) => listPlan(tx))).toEqual([])
    expect(await db.sql('select * from search_planner.plans')).toEqual([])
  })

  it('never lets a user ID reach a plan', async () => {
    await seedCentre(db, { cityPageId: '101' })
    const { userId, wantId } = await seedWant(db, {
      centreId: '101',
      families: ['RTX 3090'],
      paid: true,
    })
    await pipeline((tx) => replan(tx))
    const columns = await db.sql(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'search_planner' and table_name in ('plans', 'plan_terms', 'v_plan', 'v_one_off_runs')`,
    )
    expect(columns.filter((c) => /user|approved_by/.test(String(c.column_name)))).toEqual([])
    const dump = JSON.stringify([
      await db.sql('select * from search_planner.plans'),
      await db.sql('select * from search_planner.plan_terms'),
      await pipeline((tx) => listPlan(tx)),
      await pipeline((tx) => listOneOffRuns(tx)),
    ])
    expect(dump).not.toContain(userId)
    expect(dump).not.toContain(wantId)
  })

  it('runs nothing at an unverified centre, and records one verification run for it', async () => {
    await seedCentre(db, { cityPageId: '202', verified: false })
    await seedWant(db, { centreId: '202', families: ['RTX 3090'] })
    await seedWant(db, { centreId: '202', families: ['RTX 3080'] })
    await seedWant(db, { centreId: '202', families: ['RTX 3080'] })
    const first = await pipeline<Awaited<ReturnType<typeof replan>>>((tx) => replan(tx))
    expect(first.verificationRunIds).toHaveLength(1)
    expect(await pipeline((tx) => listPlan(tx))).toEqual([])
    const runs = await pipeline<Awaited<ReturnType<typeof listOneOffRuns>>>((tx) =>
      listOneOffRuns(tx),
    )
    expect(
      runs.map(({ purpose, input, approved, status }) => ({ purpose, input, approved, status })),
    ).toEqual([
      {
        purpose: 'verification',
        input: { centreId: '202', terms: ['rtx 3080'] },
        approved: false,
        status: 'pending',
      },
    ])
    const again = await pipeline<Awaited<ReturnType<typeof replan>>>((tx) => replan(tx))
    expect(again.verificationRunIds).toEqual([])
    // Verified: the pairs run.
    await seedCentre(db, { cityPageId: '202', verified: true })
    const verified = await pipeline<Awaited<ReturnType<typeof replan>>>((tx) => replan(tx))
    expect(centresOf(verified.events)).toEqual(['202'])
    expect(
      (await pipeline<Awaited<ReturnType<typeof listPlan>>>((tx) => listPlan(tx))).map(
        (p) => p.term,
      ),
    ).toEqual(['rtx 3080', 'gaming pc', 'pc', 'rtx 3090'])
  })

  it('never runs a pair at an inactive centre or with city-pages off', async () => {
    await seedCentre(db, { cityPageId: '303', active: false })
    await seedWant(db, { centreId: '303', families: ['RTX 3090'] })
    await pipeline((tx) => replan(tx))
    expect(await pipeline((tx) => listPlan(tx))).toEqual([])
    expect(await pipeline((tx) => listOneOffRuns(tx))).toEqual([])
    await seedCentre(db, { cityPageId: '303', active: true })
    await setSwitches(db, { 'city-pages': 'off' })
    await pipeline((tx) => replan(tx))
    expect(await pipeline((tx) => listPlan(tx))).toEqual([])
  })
})

describe('the admin test pair', () => {
  it('enters audited, runs first, and is idempotent', async () => {
    await seedCentre(db, { cityPageId: '101' })
    const admin = await seedAdmin(db)
    const input = {
      centreId: '101',
      term: 'rtx3090',
      actorUserId: admin,
      reason: 'owner test hunt',
    }
    const first = await pipeline<Awaited<ReturnType<typeof addAdminTestPair>>>((tx) =>
      addAdminTestPair(tx, input),
    )
    expect(first.added).toBe(true)
    expect(centresOf(first.events)).toEqual(['101'])
    const second = await pipeline<Awaited<ReturnType<typeof addAdminTestPair>>>((tx) =>
      addAdminTestPair(tx, input),
    )
    expect(second).toEqual({ added: false, events: [] })
    expect(await pipeline((tx) => listPlan(tx))).toEqual([
      {
        centreId: '101',
        term: 'rtx3090',
        class: 'narrow',
        origins: ['admin-test'],
        wantCount: 0,
        paidWantCount: 0,
        rank: 1,
      },
    ])
    const audit = await db.sql(`select action, target, after, reason from audit_log.entries`)
    expect(audit).toEqual([
      {
        action: 'search-planner.admin-test-pair-added',
        target: 'centre:101',
        after: { term: 'rtx3090', origin: 'admin-test' },
        reason: 'owner test hunt',
      },
    ])
    await pipeline((tx) => removeAdminTestPair(tx, input))
    expect(await planTerms(db)).toEqual([])
    expect(await db.sql(`select action from audit_log.entries order by at, id`)).toHaveLength(2)
  })

  it('is refused once want-manager is on, and none is left after a replan', async () => {
    await seedCentre(db, { cityPageId: '101' })
    const admin = await seedAdmin(db)
    const input = {
      centreId: '101',
      term: 'rtx3090',
      actorUserId: admin,
      reason: 'owner test hunt',
    }
    await pipeline((tx) => addAdminTestPair(tx, input))
    await setSwitches(db, { 'want-manager': 'on' })
    await expect(
      pipeline((tx) => addAdminTestPair(tx, { ...input, term: 'rtx 3090' })),
    ).rejects.toMatchObject({
      code: 'search-planner.want_manager_on',
    })
    await pipeline((tx) => replan(tx))
    const left = await db.sql(`select * from search_planner.plan_terms where origin = 'admin-test'`)
    expect(left).toEqual([])
  })

  it('is refused while the module is off', async () => {
    await setSwitches(db, { 'search-planner': 'off' })
    const admin = await seedAdmin(db)
    await expect(
      pipeline((tx) =>
        addAdminTestPair(tx, { centreId: '101', term: 'rtx3090', actorUserId: admin, reason: 'x' }),
      ),
    ).rejects.toBeInstanceOf(SearchPlannerRefused)
  })
})

describe('one-off runs', () => {
  it('records a verification run without approval, once per centre', async () => {
    const run = {
      purpose: 'verification' as const,
      input: { centreId: '404', terms: ['rtx 3090'] },
    }
    const first = await pipeline<{ id: string; created: boolean }>((tx) => recordOneOffRun(tx, run))
    const second = await pipeline<{ id: string; created: boolean }>((tx) =>
      recordOneOffRun(tx, run),
    )
    expect(first.created).toBe(true)
    expect(second).toEqual({ id: first.id, created: false })
    expect(await db.sql('select * from audit_log.entries')).toEqual([])
  })

  it.each(['gap-fill', 'actor-test', 'fixture'] as const)(
    'refuses an unapproved %s run',
    async (purpose) => {
      await expect(
        pipeline((tx) =>
          recordOneOffRun(tx, { purpose, input: { centreId: '101', terms: ['rtx 3090'] } }),
        ),
      ).rejects.toMatchObject({ code: 'search-planner.approval_required' })
      expect(await db.sql('select * from search_planner.one_off_runs')).toEqual([])
    },
  )

  it('records an approved gap-fill run with its audit row, and never shows the approver', async () => {
    const admin = await seedAdmin(db)
    const { id } = await pipeline<{ id: string }>((tx) =>
      recordOneOffRun(tx, {
        purpose: 'gap-fill',
        input: { listingIds: ['123', '456'] },
        approval: { actorUserId: admin, reason: 'part-price gap-fill' },
      }),
    )
    const audit = await db.sql('select action, target, reason from audit_log.entries')
    expect(audit).toEqual([
      {
        action: 'search-planner.one-off-approved',
        target: `one-off-run:${id}`,
        reason: 'part-price gap-fill',
      },
    ])
    const runs = await pipeline<Awaited<ReturnType<typeof listOneOffRuns>>>((tx) =>
      listOneOffRuns(tx),
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ id, purpose: 'gap-fill', approved: true, status: 'pending' })
    expect(JSON.stringify(runs)).not.toContain(admin)
  })

  it('refuses an unapproved run in the database too', async () => {
    await expect(
      db.as('nabvy_pipeline', (tx) =>
        tx.execute(
          `insert into search_planner.one_off_runs (purpose, input) values ('actor-test', '{}')`,
        ),
      ),
    ).rejects.toThrow()
  })

  it('moves a run along its life and refuses a wrong move', async () => {
    const { id } = await pipeline<{ id: string }>((tx) =>
      recordOneOffRun(tx, { purpose: 'verification', input: { centreId: '505', terms: ['pc'] } }),
    )
    await pipeline((tx) => setOneOffRunStatus(tx, { id, status: 'submitted' }))
    await pipeline((tx) => setOneOffRunStatus(tx, { id, status: 'submitted' }))
    await expect(
      pipeline((tx) => setOneOffRunStatus(tx, { id, status: 'cancelled' })),
    ).rejects.toMatchObject({
      code: 'search-planner.invalid_transition',
    })
    await pipeline((tx) => setOneOffRunStatus(tx, { id, status: 'failed' }))
    // A failed verification frees the centre for a new one.
    const again = await pipeline<{ created: boolean }>((tx) =>
      recordOneOffRun(tx, { purpose: 'verification', input: { centreId: '505', terms: ['pc'] } }),
    )
    expect(again.created).toBe(true)
  })
})

describe('roles', () => {
  it('gives the web app no access to the schema', async () => {
    await expect(
      db.as('nabvy_app', (tx) => tx.execute('select * from search_planner.v_plan')),
    ).rejects.toThrow()
    await expect(
      db.as('nabvy_app', (tx) => tx.execute('select * from search_planner.plan_terms')),
    ).rejects.toThrow()
  })
})
