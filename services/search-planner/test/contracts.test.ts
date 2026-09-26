import {
  events,
  module,
  SearchPlannerOneOffPurpose,
  SearchPlannerOneOffRun,
  SearchPlannerOneOffStatus,
  SearchPlannerOrigin,
  SearchPlannerPlan,
  SearchPlannerPlanChangedEvent,
  SearchPlannerRecordOneOffInput,
  SearchPlannerTerm,
  SearchPlannerTermClass,
} from '@nabvy/contracts/modules/search-planner'
import {
  SEARCH_PLANNER_ONE_OFF_PURPOSES,
  SEARCH_PLANNER_ONE_OFF_STATUSES,
  SEARCH_PLANNER_ORIGINS,
  SEARCH_PLANNER_TERM_CLASSES,
  vOneOffRuns,
  vPlan,
} from '@nabvy/db/schema/search-planner'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

describe('search-planner contracts', () => {
  it('declares its name and its one event', () => {
    expect(module).toBe('search-planner')
    expect(events.module).toBe('search-planner')
    expect(Object.keys(events.definitions)).toEqual(['search-planner.plan-changed'])
  })

  it('keeps the schema check lists equal to the contract enums', () => {
    expect([...SEARCH_PLANNER_TERM_CLASSES]).toEqual(SearchPlannerTermClass.options)
    expect([...SEARCH_PLANNER_ORIGINS]).toEqual(SearchPlannerOrigin.options)
    expect([...SEARCH_PLANNER_ONE_OFF_PURPOSES]).toEqual(SearchPlannerOneOffPurpose.options)
    expect([...SEARCH_PLANNER_ONE_OFF_STATUSES]).toEqual(SearchPlannerOneOffStatus.options)
  })

  it('keeps the view row types equal to the Drizzle view columns', () => {
    const keys = (v: Parameters<typeof getViewConfig>[0]) =>
      Object.keys(getViewConfig(v).selectedFields).sort()
    expect(keys(vPlan)).toEqual(Object.keys(SearchPlannerPlan.shape).sort())
    expect(keys(vOneOffRuns)).toEqual(Object.keys(SearchPlannerOneOffRun.shape).sort())
  })

  it('carries identifiers only in the event (rule 7)', () => {
    expect(Object.keys(SearchPlannerPlanChangedEvent.shape)).toEqual(['centreIds'])
    expect(SearchPlannerPlanChangedEvent.safeParse({ centreIds: [] }).success).toBe(false)
    expect(
      SearchPlannerPlanChangedEvent.safeParse({ centreIds: Array(501).fill('1') }).success,
    ).toBe(false)
    expect(SearchPlannerPlanChangedEvent.safeParse({ centreIds: ['101'] }).success).toBe(true)
  })

  it('parses terms and one-off inputs and refuses the obvious bad input', () => {
    expect(SearchPlannerTerm.safeParse('rtx 3090').success).toBe(true)
    expect(SearchPlannerTerm.safeParse('RTX 3090').success).toBe(false)
    expect(SearchPlannerTerm.safeParse(' pc').success).toBe(false)
    expect(
      SearchPlannerRecordOneOffInput.safeParse({ purpose: 'gap-fill', input: {} }).success,
    ).toBe(false)
    expect(
      SearchPlannerRecordOneOffInput.safeParse({
        purpose: 'gap-fill',
        input: { listingIds: Array(201).fill('1') },
      }).success,
    ).toBe(false)
    expect(
      SearchPlannerRecordOneOffInput.safeParse({
        purpose: 'fixture',
        input: { centreId: '101', terms: ['pc'] },
      }).success,
    ).toBe(true)
  })
})
