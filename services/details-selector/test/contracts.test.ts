import { DetailsSelectorSelection } from '@nabvy/contracts/modules/details-selector'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { events, module, select } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  IN_AREA_CITY_PAGE_ID,
  listingRows,
  loadRun,
  RECORDED,
  type TestDatabase,
  upstream,
  withCityPage,
} from './support/database'

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

let t: TestDatabase
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const recorded = loadRun(RECORDED)
  const rows = listingRows(recorded)
  const original = rows.find((row) => row.listingId === '1816901372840238') as Record<
    string,
    unknown
  >
  const [listingId] = await upstream(t, recorded, [withCityPage(original, IN_AREA_CITY_PAGE_ID)])
  const result = await select(t.db, { listingIds: [listingId as string] })
  if (!result.ok) throw new Error('select failed')
})
afterAll(async () => {
  await t.close()
})

describe('contracts', () => {
  it('declares its contracts under its own name', () => {
    expect(module).toBe('details-selector')
    expect(events.module).toBe('details-selector')
  })

  it('every v_selections row parses as DetailsSelectorSelection', async () => {
    const rows = await t.asPipeline('select * from details_selector.v_selections')
    expect(rows).toHaveLength(1)
    for (const row of rows) DetailsSelectorSelection.parse(camel(row))
  })

  it('no table or view carries a seller-like column', async () => {
    const columns = await t.sql(
      `select column_name from information_schema.columns where table_schema = 'details_selector'`,
    )
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) {
      expect(String(c.column_name)).not.toMatch(/seller|profile|raw|source_fields|key/)
    }
  })
})
