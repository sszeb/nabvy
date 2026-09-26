import {
  events,
  ListingAssessment,
  ListingAssessmentAssessedEvent,
  ListingAssessmentCorrection,
  ListingAssessmentUnknown,
  module,
} from '@nabvy/contracts/modules/listing-assessment'
import { vAssessments, vUnknowns } from '@nabvy/db/schema/listing-assessment'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assess } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  recorded,
  type TestDatabase,
} from './support/database'

// Every published view row and the event parse with the module's contracts, the Drizzle view
// declarations match the contracts' keys, and no view carries a seller-like column.

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

let t: TestDatabase
let emitted: unknown[] = []
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const listingIds = await recorded(t, loadRun(RECORDED))
  const result = await assess(t.db, { listingIds, now: new Date() })
  if (!result.ok) throw new Error('assess failed')
  emitted = result.value.events
})
afterAll(async () => {
  await t.close()
})

const VIEWS = [
  ['v_assessments', ListingAssessment, vAssessments],
  ['v_unknowns', ListingAssessmentUnknown, vUnknowns],
] as const

describe('contracts', () => {
  it.each(VIEWS)('%s rows parse', async (view, schema) => {
    const rows = await t.asPipeline(`select * from listing_assessment.${view}`)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) schema.parse(camel(row))
  })

  it.each(VIEWS)(
    '%s matches its Drizzle declaration and has no seller column',
    (_, schema, view) => {
      const columns = Object.keys(getViewConfig(view).selectedFields)
      expect(columns.sort()).toEqual(Object.keys(schema.shape).sort())
      for (const name of Object.values(getViewConfig(view).selectedFields).map(
        (c) => (c as { name: string }).name,
      )) {
        expect(name).not.toMatch(/seller|profile|raw|source_fields|price|model|photo_url/)
      }
    },
  )

  it('the assessed event parses and is registered', () => {
    expect(module).toBe('listing-assessment')
    expect(events.module).toBe('listing-assessment')
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('listing-assessment.assessed')
      expect(ListingAssessmentAssessedEvent.parse(e.payload).listingIds).toHaveLength(20)
    }
  })

  it('a correction must correct something; an unknown GPU state is refused', () => {
    const base = {
      listingId: '01920000-0000-7000-8000-000000000001',
      evidenceHash: 'a'.repeat(64),
      by: '01920000-0000-7000-8000-000000000009',
      reason: 'seller replied',
    }
    expect(ListingAssessmentCorrection.safeParse(base).success).toBe(false)
    expect(ListingAssessmentCorrection.safeParse({ ...base, gpuState: 'none' }).success).toBe(true)
    expect(ListingAssessmentCorrection.safeParse({ ...base, gpuState: 'maybe' }).success).toBe(
      false,
    )
    expect(ListingAssessmentAssessedEvent.safeParse({ listingIds: [] }).success).toBe(false)
  })
})
