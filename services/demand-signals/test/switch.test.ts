import { state } from '@nabvy/switches'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listCells, publishWeek } from '../src'
import { createTestDatabase, INPUTS_ON, type TestDatabase } from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off (the default) acknowledges and writes nothing and
// `v_cells` is empty; shadow and on write and show internal rows. The module has no user-facing
// view in any state (card: "User-facing: none").

const NOW = new Date('2026-09-25T00:00:00Z')

let t: TestDatabase
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches({ ...INPUTS_ON, 'demand-signals': 'off' })
  const [a] = await t.centres()
  await t.wants({ centreId: a, catalogueId: 'rtx-3090', count: 12 })
}, 120_000)
afterAll(() => t.close())

const publish = (weekStart: string) => t.transaction((q) => publishWeek(q, { weekStart }, NOW))
const count = async () =>
  Number((await t.sql('select count(*)::int as n from demand_signals.cells'))[0]?.n)

describe('demand-signals switch', () => {
  it('reads off with no seed row', async () => {
    await t.sql(`delete from switches.switches where name = 'demand-signals'`)
    expect(await state(t.db, 'demand-signals')).toBe('off')
  })

  it('off: acknowledges, writes nothing, publishes no event', async () => {
    const result = await publish('2026-09-07')
    expect(result).toMatchObject({ ok: true, value: { state: 'off', written: 0, events: [] } })
    expect(await count()).toBe(0)
  })

  it('shadow: writes, and v_cells shows the rows', async () => {
    await t.switches({ 'demand-signals': 'shadow' })
    const result = await publish('2026-09-07')
    expect(result.ok && result.value.written).toBe(1)
    expect(await listCells(t.db, '2026-09-07')).toHaveLength(1)
  })

  it('off again: v_cells is empty although the table keeps its rows', async () => {
    await t.switches({ 'demand-signals': 'off' })
    expect(await listCells(t.db, '2026-09-07')).toEqual([])
    expect(await count()).toBe(1)
  })

  it('on: the same internal rows; no view is granted to the web app in any state', async () => {
    await t.switches({ 'demand-signals': 'on' })
    expect(await listCells(t.db, '2026-09-07')).toHaveLength(1)
    const grants = await t.sql(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'demand_signals' and grantee in ('nabvy_app', 'anon', 'authenticated', 'public')`,
    )
    expect(grants).toEqual([])
    const usage = await t.sql(
      `select has_schema_privilege('nabvy_app', 'demand_signals', 'usage') as app`,
    )
    expect(usage[0]?.app).toBe(false)
  })

  it('readers carry on with every input off: nothing to count, nothing written', async () => {
    await t.switches({ 'want-manager': 'off', 'listing-assessment': 'off', 'city-pages': 'off' })
    const result = await publish('2026-08-31')
    expect(result).toMatchObject({ ok: true, value: { written: 0, cells: 0, events: [] } })
  })
})
