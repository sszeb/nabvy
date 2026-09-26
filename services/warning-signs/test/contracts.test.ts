import { readdirSync, readFileSync } from 'node:fs'
import { WARNING_SIGNS_RULES } from '@nabvy/config/modules/warning-signs'
import {
  events,
  module,
  WarningSignsFact,
  WarningSignsFactCode,
  WarningSignsFoundEvent,
  WarningSignsListingFact,
} from '@nabvy/contracts/modules/warning-signs'
import { vFacts, vWarningSigns } from '@nabvy/db/schema/warning-signs'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evaluate } from '../src'
import {
  createTestDatabase,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from './support/database'

// Every published view row and the event parse with the module's contracts, the Drizzle view
// declarations match the contracts' keys, no view carries a seller-like column, and the code
// lists in the migrations match the contract and the configuration.

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

const ID = '00000000-0000-4000-8004-000000000001'
let t: TestDatabase
let emitted: unknown[] = []
beforeAll(async () => {
  t = await createTestDatabase()
  await switchOn(t, UPSTREAM)
  await setSwitch(t, 'on')
  await seed(t, [
    {
      id: ID,
      description: 'Faulty, sold as seen. £50 deposit to hold, call 07700 900123 to arrange.',
      priceMinor: 10000,
      cautions: ['box_only'],
      groups: [{ key: 'g-contracts', median: 60000, n: 12 }],
    },
  ])
  const result = await t.as('nabvy_pipeline', (q) =>
    evaluate(q, { listingIds: [ID], now: new Date() }),
  )
  if (!result.ok) throw new Error('evaluate failed')
  emitted = result.value.events
})
afterAll(async () => {
  await t.close()
})

const VIEWS = [
  ['warning_signs.v_facts', WarningSignsFact, vFacts, 'nabvy_pipeline'],
  ['app.v_warning_signs', WarningSignsListingFact, vWarningSigns, 'nabvy_app'],
] as const

describe('contracts', () => {
  it.each(VIEWS)('%s rows parse', async (view, schema, _, role) => {
    const rows = await t.sqlAs(role, `select * from ${view}`)
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
        expect(name).not.toMatch(/seller|profile|raw|source_fields|price|photo_url/)
      }
    },
  )

  it('the event parses and is registered', () => {
    expect(module).toBe('warning-signs')
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('warning-signs.found')
      WarningSignsFoundEvent.parse(e.payload)
      expect(events.module).toBe('warning-signs')
    }
  })

  it('the migrations list the contract codes and the configured user-facing codes', () => {
    const dir = new URL('../../../packages/db/migrations/warning-signs/', import.meta.url)
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .map((n) => readFileSync(new URL(n, dir), 'utf8'))
      .join('\n')
    const tables = /facts_code_check" CHECK \(code in \(([^)]*)\)\)/.exec(sql)?.[1]
    const listed = (s: string | undefined) =>
      [...(s ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(listed(tables)).toEqual([...WarningSignsFactCode.options].sort())
    const shown = [...sql.matchAll(/code in \(('[a-z_]+'(?:, '[a-z_]+')*)\)/g)]
      .map((m) => listed(m[1]))
      .filter((l) => l.length < WarningSignsFactCode.options.length)
    expect(shown.length).toBe(2) // the view and the row policy
    for (const l of shown) expect(l).toEqual([...WARNING_SIGNS_RULES.userFacingCodes].sort())
    expect(WARNING_SIGNS_RULES.userFacingCodes).not.toContain('stock_phrasing_text')
  })
})
