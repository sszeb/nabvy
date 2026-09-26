import {
  events,
  module,
  NoiseFilterClassification,
  NoiseFilterClassifiedEvent,
  NoiseFilterListingReasons,
  NoiseFilterReason,
} from '@nabvy/contracts/modules/noise-filter'
import { vClassifications, vNoiseFilterReasons } from '@nabvy/db/schema/noise-filter'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classify } from '../src'
import {
  ALL_ON,
  assessed,
  createTestDatabase,
  loadRun,
  RECORDED,
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
  const listingIds = await assessed(t, loadRun(RECORDED))
  const result = await classify(t.db, { listingIds, now: new Date() })
  if (!result.ok) throw new Error('classify failed')
  emitted = result.value.events
})
afterAll(async () => {
  await t.close()
})

const VIEWS = [
  ['noise_filter.v_classifications', NoiseFilterClassification, vClassifications],
  ['app.v_noise_filter_reasons', NoiseFilterListingReasons, vNoiseFilterReasons],
] as const

describe('contracts', () => {
  it.each(VIEWS)('%s rows parse', async (view, schema) => {
    const rows = await t.sql(`select * from ${view}`)
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

  it('the classified event parses and is registered', () => {
    expect(module).toBe('noise-filter')
    expect(events.module).toBe('noise-filter')
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('noise-filter.classified')
      expect(NoiseFilterClassifiedEvent.parse(e.payload).listingIds).toHaveLength(20)
    }
    expect(NoiseFilterClassifiedEvent.safeParse({ listingIds: [] }).success).toBe(false)
  })

  it('the table check and the contract agree on the reason codes', async () => {
    const [row] = await t.sql(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'classifications_reasons_check'`,
    )
    for (const reason of NoiseFilterReason.options) expect(row?.def).toContain(`"${reason}"`)
    expect(
      NoiseFilterListingReasons.safeParse({ listingId: crypto.randomUUID(), reasons: [] }).success,
    ).toBe(false)
  })
})
