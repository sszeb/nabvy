import {
  CHECK_SCHEDULER_KINDS,
  CHECK_SCHEDULER_REASONS,
  CHECK_SCHEDULER_RUN_STATUSES,
  CheckSchedulerRun,
  CheckSchedulerShape,
  events,
  module,
} from '@nabvy/contracts/modules/check-scheduler'
import { SearchPlannerTermClass } from '@nabvy/contracts/modules/search-planner'
import {
  CHECK_SCHEDULER_TERM_CLASSES as DB_CLASSES,
  CHECK_SCHEDULER_KINDS as DB_KINDS,
  CHECK_SCHEDULER_REASONS as DB_REASONS,
  CHECK_SCHEDULER_SHAPES as DB_SHAPES,
  CHECK_SCHEDULER_RUN_STATUSES as DB_STATUSES,
  vCheckRuns,
} from '@nabvy/db/schema/check-scheduler'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

describe('check-scheduler contracts', () => {
  it('declares its name and publishes no events (its output is runs)', () => {
    expect(module).toBe('check-scheduler')
    expect(events.module).toBe('check-scheduler')
  })

  it("keeps the database's check lists equal to the contracts' enums", () => {
    expect([...DB_KINDS]).toEqual([...CHECK_SCHEDULER_KINDS])
    expect([...DB_REASONS]).toEqual([...CHECK_SCHEDULER_REASONS])
    expect([...DB_STATUSES]).toEqual([...CHECK_SCHEDULER_RUN_STATUSES])
    expect([...DB_SHAPES]).toEqual([...CheckSchedulerShape.options])
    expect([...DB_CLASSES]).toEqual([...SearchPlannerTermClass.options])
  })

  it('types every column of v_check_runs, and nothing else', () => {
    const columns = Object.keys(getViewConfig(vCheckRuns).selectedFields).sort()
    expect(columns).toEqual(Object.keys(CheckSchedulerRun.shape).sort())
  })

  it('refuses a run with no terms, a details shape or an unknown reason', () => {
    const run = {
      id: '01920000-0000-7000-8000-000000000001',
      jobId: 1,
      centreId: '115935195086622',
      kind: 'newest',
      shape: 'newest-check',
      terms: ['rtx 3090'],
      reason: 'scheduled',
      status: 'submitted',
      tickAt: '2026-09-25T12:00:00.000Z',
      rerunOf: null,
      oneOffId: null,
      errorCode: null,
      createdAt: '2026-09-25T12:00:00.000Z',
      updatedAt: '2026-09-25T12:00:00.000Z',
    }
    expect(CheckSchedulerRun.parse(run)).toEqual(run)
    expect(() => CheckSchedulerRun.parse({ ...run, terms: [] })).toThrow()
    expect(() => CheckSchedulerRun.parse({ ...run, shape: 'details-text' })).toThrow()
    expect(() => CheckSchedulerRun.parse({ ...run, reason: 'per-user' })).toThrow()
    expect(() => CheckSchedulerRun.parse({ ...run, userId: 'x' })).toThrow()
  })
})
