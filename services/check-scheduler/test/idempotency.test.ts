import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onSearchDegraded, tick } from '../src'
import {
  ALL_ON,
  BELFAST,
  CHICHESTER,
  createTestDatabase,
  type FakePorts,
  fakePorts,
  pair,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: a replay writes nothing new. Keys: the tick slot and
// region for a tick's run; the degraded search's ID for a rerun.

const DAY = new Date('2026-09-25T12:00:00Z')
let db: TestDatabase
let ports: FakePorts
beforeEach(async () => {
  db = await createTestDatabase()
  await db.switches(ALL_ON)
  ports = fakePorts()
})
afterEach(() => db.close())

const snapshot = () =>
  db.sql(
    `select centre_id, kind, shape, terms, reason, status, tick_at, job_id, rerun_of
     from check_scheduler.check_runs order by id`,
  )

describe('check-scheduler idempotency', () => {
  it('a tick run twice in one slot writes and submits once', async () => {
    ports.plan = [pair(CHICHESTER, 'rtx 3090', 'narrow', 0, 1), pair(BELFAST, 'pc', 'broad', 0, 2)]
    await db.tx((tx) => tick(tx, { ports, now: DAY }))
    const before = await snapshot()
    const schedule = await db.sql('select * from check_scheduler.schedule order by centre_id')
    await db.tx((tx) => tick(tx, { ports, now: new Date(DAY.getTime() + 60_000) }))
    expect(await snapshot()).toEqual(before)
    expect(await db.sql('select * from check_scheduler.schedule order by centre_id')).toEqual(
      schedule,
    )
    expect(ports.submitted).toHaveLength(2)
  })

  it('a degraded-search batch replayed queues its reruns once', async () => {
    ports.plan = [pair(CHICHESTER, 'rtx 3090', 'narrow', 0, 1)]
    await db.tx((tx) => tick(tx, { ports, now: DAY }))
    const ids = ['01920000-0000-7000-8000-000000000101', '01920000-0000-7000-8000-000000000102']
    for (const id of ids) {
      await db.search({ id, jobId: 1, centreId: CHICHESTER, term: 'rtx 3090', status: 'degraded' })
    }
    // A search judged complete, or of a job this module did not send, is never rerun.
    await db.search({
      id: '01920000-0000-7000-8000-000000000103',
      jobId: 1,
      centreId: CHICHESTER,
      term: 'rtx 3090',
      status: 'complete',
    })
    await db.search({
      id: '01920000-0000-7000-8000-000000000104',
      jobId: 77,
      centreId: CHICHESTER,
      term: 'rtx 3090',
      status: 'degraded',
    })
    const batch = [
      { jobId: 1, searchIds: [...ids, '01920000-0000-7000-8000-000000000103'] },
      { jobId: 77, searchIds: ['01920000-0000-7000-8000-000000000104'] },
    ]
    expect(await db.tx((tx) => onSearchDegraded(tx, batch))).toBe(2)
    const before = await snapshot()
    expect(await db.tx((tx) => onSearchDegraded(tx, batch))).toBe(0)
    expect(await snapshot()).toEqual(before)
  })
})
