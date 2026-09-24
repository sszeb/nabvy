import {
  PartsAiExtractedEvent,
  PartsAiPart,
  PartsAiQuarantined,
  PartsAiRun,
} from '@nabvy/contracts/modules/parts-ai'
import { vAiParts, vQuarantine, vRuns } from '@nabvy/db/schema/parts-ai'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { events, module, type PartsAiResponse, run } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  openThrottle,
  RECORDED,
  type TestDatabase,
  USD_GBP_RATE,
} from './support/database'
import { loadRecording, recordedClient } from './support/model'

// Every published view row and the event parse with the module's contracts, the Drizzle view
// declarations match the contracts' keys, and no view carries a seller-like, cost or model column.

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
  await openThrottle(t)
  const listingIds = await detailed(t, loadRun(RECORDED))
  const responses = { ...loadRecording('current').responses }
  // One quarantined call, so v_quarantine has a row.
  responses['1380502417485603'] = {
    ...(responses['1380502417485603'] as PartsAiResponse),
    output: {
      kind: null,
      parts: [{ partType: 'gpu', name: null, quote: 'RTX 9999', inclusion: 'offered' }],
    },
  }
  const client = await recordedClient(t, responses)
  const result = await run(t.db, { listingIds }, { client }, { usdGbpRate: USD_GBP_RATE })
  if (!result.ok) throw new Error('run failed')
  emitted = result.value.events
})
afterAll(async () => {
  await t.close()
})

const VIEWS = [
  ['v_ai_parts', PartsAiPart, vAiParts],
  ['v_runs', PartsAiRun, vRuns],
  ['v_quarantine', PartsAiQuarantined, vQuarantine],
] as const

describe('contracts', () => {
  it.each(VIEWS)('%s rows parse', async (view, schema) => {
    const rows = await t.asPipeline(`select * from parts_ai.${view}`)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) schema.parse(camel(row))
  })

  it.each(VIEWS)(
    '%s matches its Drizzle declaration and has no seller, cost or model column',
    (_, schema, view) => {
      const columns = Object.keys(getViewConfig(view).selectedFields)
      expect(columns.sort()).toEqual(Object.keys(schema.shape).sort())
      for (const name of Object.values(getViewConfig(view).selectedFields).map(
        (c) => (c as { name: string }).name,
      )) {
        expect(name).not.toMatch(/seller|profile|raw|source_fields|cost|model|trace/)
      }
    },
  )

  it('the extracted event parses and is registered', () => {
    expect(module).toBe('parts-ai')
    expect(events.module).toBe('parts-ai')
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('parts-ai.extracted')
      expect(PartsAiExtractedEvent.parse(e.payload).listingIds).toHaveLength(11)
    }
  })
})
