import {
  DetailEvidenceChangedEvent,
  DetailEvidenceFingerprint,
  DetailEvidenceHash,
  DetailEvidenceOutcome,
  DetailEvidenceText,
  DetailEvidenceUnresolvedEvent,
  DetailEvidenceVersion,
} from '@nabvy/contracts/modules/detail-evidence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { events, module, record } from '../src'
import {
  ALL_ON,
  collectedAndIngested,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

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
  const first = await record(t.db, { jobId: await collectedAndIngested(t, recorded) })
  const unresolved = recorded.dataset.map((row) =>
    row.listingId === '1816901372840238'
      ? {
          recordType: 'listing',
          listingId: row.listingId,
          collectedAt: '2026-09-25T00:00:00.000Z',
          detailAttempted: true,
          detailOutcome: 'extraction-error',
          directItemUnresolved: true,
        }
      : row,
  )
  const second = await record(t.db, { jobId: await t.collected(recorded, unresolved) })
  if (!first.ok || !second.ok) throw new Error('record failed')
  emitted = [...first.value.events, ...second.value.events]
})
afterAll(async () => {
  await t.close()
})

const parseAll = async (view: string, schema: { parse(v: unknown): unknown }) => {
  const rows = await t.asPipeline(`select * from detail_evidence.${view}`)
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) schema.parse(camel(row))
  return rows
}

describe('contracts', () => {
  it('declares its contracts under its own name', () => {
    expect(module).toBe('detail-evidence')
    expect(events.module).toBe('detail-evidence')
  })

  it('both events are emitted and parse', () => {
    const types = emitted.map((e) => (e as { type: string }).type)
    expect(types).toContain('detail-evidence.changed')
    expect(types).toContain('detail-evidence.unresolved')
    for (const e of emitted as { type: string; payload: unknown }[]) {
      const schema =
        e.type === 'detail-evidence.changed'
          ? DetailEvidenceChangedEvent
          : DetailEvidenceUnresolvedEvent
      schema.parse(e.payload)
    }
  })

  it('every view row parses', async () => {
    const current = await parseAll('v_current', DetailEvidenceVersion)
    for (const row of current) DetailEvidenceHash.parse(row.evidence_hash)
    await parseAll('v_text', DetailEvidenceText)
    await parseAll('v_outcomes', DetailEvidenceOutcome)
    await parseAll('v_fingerprints', DetailEvidenceFingerprint)
  })

  it('no view carries a seller-like column or the description outside v_text', async () => {
    const columns = await t.sql(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'detail_evidence' and table_name like 'v\\_%'`,
    )
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) {
      expect(String(c.column_name)).not.toMatch(/seller|profile|raw|source_fields/)
      if (c.column_name === 'description') expect(c.table_name).toBe('v_text')
    }
  })
})
