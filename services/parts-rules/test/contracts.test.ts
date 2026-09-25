import {
  PartsRulesGap,
  PartsRulesKindSignal,
  PartsRulesPart,
  PartsRulesRanEvent,
  PartsRulesTagBlock,
} from '@nabvy/contracts/modules/parts-rules'
import { vGaps, vKindSignals, vRuleParts, vTagBlocks } from '@nabvy/db/schema/parts-rules'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { events, module, run } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  RECORDED,
  type TestDatabase,
  withFields,
} from './support/database'

// Every published view row and the event parse with the module's contracts, the Drizzle view
// declarations match the contracts' keys, and no view carries a seller-like column.

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v,
    ]),
  )

let t: TestDatabase
let emitted: unknown[] = []
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const recorded = loadRun(RECORDED)
  const rows = withFields(recorded.dataset, '1072745435569624', {
    description: 'GPU: RTX 2070 Super\n#rtx4090 #rtx5080 #gamingpc',
  })
  const result = await run(t.db, { listingIds: await detailed(t, recorded, rows) })
  if (!result.ok) throw new Error('run failed')
  emitted = result.value.events
})
afterAll(async () => {
  await t.close()
})

const VIEWS = [
  ['v_rule_parts', PartsRulesPart, vRuleParts],
  ['v_gaps', PartsRulesGap, vGaps],
  ['v_tag_blocks', PartsRulesTagBlock, vTagBlocks],
  ['v_kind_signals', PartsRulesKindSignal, vKindSignals],
] as const

describe('contracts', () => {
  it.each(VIEWS)('%s rows parse', async (view, schema) => {
    const rows = await t.asPipeline(`select * from parts_rules.${view}`)
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
        expect(name).not.toMatch(/seller|profile|raw|source_fields/)
      }
    },
  )

  it('the ran event parses and is registered', () => {
    expect(module).toBe('parts-rules')
    expect(events.module).toBe('parts-rules')
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('parts-rules.ran')
      PartsRulesRanEvent.parse(e.payload)
    }
  })
})
