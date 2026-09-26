import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listCells, publishWeek } from '../src'
import { createTestDatabase, INPUTS_ON, type TestDatabase } from './support/database'

// Never by user or seller (card, "Does / does not"): no output of this module carries a user ID,
// a listing ID, a seller field or a per-user row, and no count under 10 is stored or shown.

const WEEK = '2026-09-14'
const NOW = new Date('2026-09-25T00:00:00Z')
const FORBIDDEN = /user|seller|listing|owner|email|name|lat|lng|postcode/i

let t: TestDatabase
let users: string[]
let listings: string[]
let output: string
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(INPUTS_ON)
  const [a, b] = await t.centres()
  users = [
    ...(await t.wants({ centreId: a, catalogueId: 'rtx-3090', count: 11 })),
    // One user alone at B: the cell must not reveal them.
    ...(await t.wants({ centreId: b, catalogueId: 'rtx-3090', count: 1 })),
  ]
  listings = []
  for (let i = 0; i < 10; i++) {
    listings.push(
      await t.advert({
        cityPageId: a,
        catalogueIds: ['rtx-3090'],
        listedAt: '2026-09-15T10:00:00Z',
      }),
    )
  }
  const result = await t.transaction((q) => publishWeek(q, { weekStart: WEEK }, NOW))
  if (!result.ok) throw new Error(result.error.code)
  output = JSON.stringify({
    report: result.value,
    cells: await listCells(t.db, WEEK),
    table: await t.sql('select * from demand_signals.cells'),
    view: await t.asPipeline('select * from demand_signals.v_cells'),
  })
}, 120_000)
afterAll(() => t.close())

describe('demand-signals privacy', () => {
  it('no output carries a user ID or a listing ID', () => {
    for (const id of [...users, ...listings]) expect(output).not.toContain(id)
  })

  it('no table or view column names a user, seller, listing or place finer than the centre', async () => {
    const columns = await t.sql(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'demand_signals' order by table_name, ordinal_position`,
    )
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) expect(String(c.column_name)).not.toMatch(FORBIDDEN)
  })

  it('the event carries the week only', () => {
    const report = JSON.parse(output).report
    expect(report.events.map((e: { payload: unknown }) => e.payload)).toEqual([{ weekStart: WEEK }])
  })

  it('the lone want at B is a suppressed cell with no count', async () => {
    const cells = await listCells(t.db, WEEK)
    const suppressed = cells.filter((c) => c.suppressed)
    expect(suppressed).toHaveLength(1)
    expect(suppressed[0]).toMatchObject({ wants: null, adverts: null })
    const small = await t.sql(
      `select count(*)::int as n from demand_signals.cells
       where (wants is not null and wants < 10) or (adverts is not null and adverts < 10)`,
    )
    expect(small[0]?.n).toBe(0)
  })

  it('the view keeps to the conventions: nabvy_core.view_violations() is empty for it', async () => {
    const rows = await t.sql(
      `select * from nabvy_core.view_violations() where view_name like 'demand_signals.%'`,
    )
    expect(rows).toEqual([])
  })
})
