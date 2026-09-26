import { readFileSync } from 'node:fs'
import {
  PartsRecordPart,
  PartsRecordRecord,
  PartsRecordRecordedEvent,
} from '@nabvy/contracts/modules/parts-record'
import { vParts, vRecords } from '@nabvy/db/schema/parts-record'
import type { PartsAiResponse } from '@nabvy/parts-ai'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { events, module, record } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  extracted,
  loadRun,
  RECORDED,
  ruled,
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
  const listingIds = await ruled(t, loadRun(RECORDED))
  await record(t.db, { listingIds })
  const responses = JSON.parse(
    readFileSync(new URL('./fixtures/cases/recorded-run/input.json', import.meta.url), 'utf8'),
  ).responses as Record<string, PartsAiResponse>
  const result = await record(t.db, { listingIds: await extracted(t, listingIds, responses) })
  if (!result.ok) throw new Error('record failed')
  emitted = result.value.events
})
afterAll(async () => {
  await t.close()
})

const VIEWS = [
  ['v_records', PartsRecordRecord, vRecords],
  ['v_parts', PartsRecordPart, vParts],
] as const

describe('contracts', () => {
  it.each(VIEWS)('%s rows parse', async (view, schema) => {
    const rows = await t.asPipeline(`select * from parts_record.${view}`)
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
        expect(name).not.toMatch(/seller|profile|raw|source_fields|cost|model|trace|photo_url/)
      }
    },
  )

  it('the recorded event parses and is registered', () => {
    expect(module).toBe('parts-record')
    expect(events.module).toBe('parts-record')
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('parts-record.recorded')
      expect(PartsRecordRecordedEvent.parse(e.payload).listingIds).toHaveLength(12)
    }
  })
})
