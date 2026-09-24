import {
  RunCoverageRoute,
  RunCoverageScopeBaseline,
  RunCoverageSearch,
  RunCoverageSearchControls,
  RunCoverageSearchDegradedEvent,
  RunCoverageStopReason,
} from '@nabvy/contracts/modules/run-coverage'
import { ingest } from '@nabvy/listing-ingest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assess, events, module } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
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
  const ok = await t.collected(recorded)
  await ingest(t.db, { jobId: ok, kind: 'search' })
  const a = await assess(t.db, { jobId: ok, kind: 'search' })
  const bad = await t.collected(recorded, recorded.dataset, {
    runSummary: {
      ...recorded.runSummary,
      searches: [{ ...(recorded.runSummary.searches as object[])[0], stopReason: 'odd' }],
    },
  })
  await ingest(t.db, { jobId: bad, kind: 'search' })
  const b = await assess(t.db, { jobId: bad, kind: 'search' })
  if (!a.ok || !b.ok) throw new Error('assess failed')
  emitted = [...a.value.events, ...b.value.events]
})
afterAll(async () => {
  await t.close()
})

describe('contracts', () => {
  it('declares its events under its own name', () => {
    expect(module).toBe('run-coverage')
    expect(Object.keys(events.definitions)).toEqual(['run-coverage.search-degraded'])
  })

  it('emits envelopes whose payloads parse, carrying IDs only', () => {
    expect(emitted).toHaveLength(1)
    expect(RunCoverageSearchDegradedEvent.safeParse(emitted[0]?.payload).success).toBe(true)
  })

  it('unknown stop reasons and routes read unknown', () => {
    expect(RunCoverageStopReason.parse('something-new')).toBe('unknown')
    expect(RunCoverageStopReason.parse(undefined)).toBe('unknown')
    expect(RunCoverageRoute.parse('graphql')).toBe('unknown')
    expect(RunCoverageRoute.parse('http')).toBe('http')
  })

  it('every view row parses', async () => {
    const parse = async (view: string, schema: { safeParse(v: unknown): { success: boolean } }) => {
      const rows = await t.asPipeline(`select * from run_coverage.${view}`)
      expect(rows.length, view).toBeGreaterThan(0)
      for (const row of rows) expect(schema.safeParse(camel(row)).success, view).toBe(true)
    }
    await parse('v_search_coverage', RunCoverageSearch)
    await parse('v_scope_baselines', RunCoverageScopeBaseline)
    await parse('v_search_controls', RunCoverageSearchControls)
  })

  it('no view has a seller-like column', async () => {
    const columns = await t.sql(
      `select column_name from information_schema.columns where table_schema = 'run_coverage'`,
    )
    expect(columns.filter((c) => /seller|profile|name$/.test(String(c.column_name)))).toEqual([])
  })
})
