import {
  RelistMergeBasis,
  RelistMergeGroup,
  RelistMergeMergedEvent,
} from '@nabvy/contracts/modules/relist-merge'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { events, merge, module } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingRows,
  loadRun,
  RECORDED,
  relist,
  type TestDatabase,
  upstream,
} from './support/database'

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

let t: TestDatabase
let emitted: { type: string; payload: unknown }[] = []
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const recorded = loadRun(RECORDED)
  const rows = listingRows(recorded)
  const original = rows.find((row) => row.listingId === '1816901372840238') as Record<
    string,
    unknown
  >
  await upstream(t, recorded, rows)
  const [relisted] = await upstream(t, recorded, [relist(original, '9100000000000001', 3)])
  const result = await merge(t.db, { listingIds: [relisted as string] })
  if (!result.ok) throw new Error('merge failed')
  emitted = result.value.events as typeof emitted
})
afterAll(async () => {
  await t.close()
})

describe('contracts', () => {
  it('declares its contracts under its own name', () => {
    expect(module).toBe('relist-merge')
    expect(events.module).toBe('relist-merge')
    expect(RelistMergeBasis.options).toEqual(['origin', 'description', 'photo'])
  })

  it('the merged event is emitted, parses and carries identifiers only', () => {
    expect(emitted.map((e) => e.type)).toEqual(['relist-merge.merged'])
    for (const e of emitted) {
      const payload = RelistMergeMergedEvent.parse(e.payload)
      expect(Object.keys(payload)).toEqual(['listingIds'])
    }
  })

  it('every v_groups row parses', async () => {
    const rows = await t.asPipeline('select * from relist_merge.v_groups')
    expect(rows).toHaveLength(2)
    for (const row of rows) RelistMergeGroup.parse(camel(row))
  })

  it('no table or view carries a seller-like column', async () => {
    const columns = await t.sql(
      `select column_name from information_schema.columns where table_schema = 'relist_merge'`,
    )
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) {
      expect(String(c.column_name)).not.toMatch(/seller|profile|raw|source_fields|key/)
    }
  })
})
