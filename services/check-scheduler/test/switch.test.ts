import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listRuns, onSearchDegraded, tick } from '../src'
import {
  CHICHESTER,
  createTestDatabase,
  type FakePorts,
  fakePorts,
  pair,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md and the card's "When off: no scheduled checks".

const DAY = new Date('2026-09-25T12:00:00Z')
let db: TestDatabase
let ports: FakePorts
beforeEach(async () => {
  db = await createTestDatabase()
  ports = fakePorts()
  ports.plan = [pair(CHICHESTER, 'rtx 3090', 'narrow', 0, 1)]
})
afterEach(() => db.close())

const rows = async (table: string) =>
  Number((await db.sql(`select count(*)::int as n from check_scheduler.${table}`))[0]?.n)

describe('check-scheduler switch', () => {
  it('off (the default): schedules nothing, submits nothing, writes nothing', async () => {
    await db.switches({ pipeline: 'on' })
    expect(await db.tx((tx) => tick(tx, { ports, now: DAY }))).toEqual({ status: 'off' })
    expect(ports.submitted).toEqual([])
    expect(ports.calls).toEqual([])
    await db.search({
      id: '01920000-0000-7000-8000-0000000000f1',
      jobId: 1,
      centreId: CHICHESTER,
      term: 'pc',
      status: 'degraded',
    })
    expect(
      await db.tx((tx) =>
        onSearchDegraded(tx, [{ jobId: 1, searchIds: ['01920000-0000-7000-8000-0000000000f1'] }]),
      ),
    ).toBe(0)
    expect(await rows('check_runs')).toBe(0)
    expect(await rows('schedule')).toBe(0)
  })

  it('the pipeline off: nothing is scheduled either', async () => {
    await db.switches({ 'check-scheduler': 'on', pipeline: 'off' })
    expect(await db.tx((tx) => tick(tx, { ports, now: DAY }))).toEqual({ status: 'off' })
    expect(ports.submitted).toEqual([])
  })

  it('shadow: decides and records, but submits nothing', async () => {
    await db.switches({ 'check-scheduler': 'shadow', pipeline: 'on' })
    const report = await db.tx((tx) => tick(tx, { ports, now: DAY }))
    expect(report).toMatchObject({ status: 'ran', runs: [{ status: 'shadow', jobId: null }] })
    expect(ports.submitted).toEqual([])
    expect(await listRuns(db.db)).toMatchObject([{ status: 'shadow', centreId: CHICHESTER }])
  })

  it('the view is empty while off', async () => {
    await db.switches({ 'check-scheduler': 'shadow', pipeline: 'on' })
    await db.tx((tx) => tick(tx, { ports, now: DAY }))
    await db.switches({ 'check-scheduler': 'off' })
    expect(await listRuns(db.db)).toEqual([])
  })
})
