import { readdirSync, readFileSync } from 'node:fs'
import type { PartsAiResponse } from '@nabvy/parts-ai'
import { classify } from '../../src'
import { assessed, loadRun, type TestDatabase, withFields } from './database'
import { observe } from './observe'

// One fixture case run end to end: the recorded rows (with the case's edits) through ingest,
// detail-evidence, parts-rules, parts-record, parts-ai with the case's recorded responses (none:
// no call succeeds), parts-record again and listing-assessment, then this module on the
// `assessed` event, as the live pipeline delivers it.

type Json = Record<string, unknown>

/** A fixture case's input (README.md, "Fixtures and pass rate"). */
export interface CaseInput {
  run: string
  /** Only these source listing IDs' rows (plus the run's other records). */
  only?: string[]
  /** Field edits per source listing ID (synthetic). */
  edits?: { listingId: string; fields: Json }[]
  /** Recorded model responses for this case, per source listing ID. */
  responses?: Record<string, PartsAiResponse>
}

const CASES = new URL('../fixtures/cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))

export const caseIds = (): string[] => readdirSync(CASES).sort()

export function rowsOf(input: CaseInput): Json[] {
  const run = loadRun(input.run)
  let rows = run.dataset as Json[]
  if (input.only) {
    const keep = new Set(input.only)
    rows = rows.filter((r) => r.recordType !== 'listing' || keep.has(String(r.listingId)))
  }
  for (const edit of input.edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)
  return rows
}

/** Runs one case on `t` and returns what it observed beside what the case expects. */
export async function runCase(
  t: TestDatabase,
  id: string,
): Promise<{ observed: Json; expected: Json }> {
  const input = read(new URL(`${id}/input.json`, CASES)) as CaseInput
  const expected = read(new URL(`${id}/expected.json`, CASES)) as { listings: Record<string, Json> }
  const listingIds = await assessed(t, loadRun(input.run), rowsOf(input), input.responses ?? {})
  const result = await classify(t.db, { listingIds, now: new Date() })
  if (!result.ok) throw new Error(result.error.message)
  const all = await observe(t)
  const observed: Json = { listings: {} }
  for (const [sid, want] of Object.entries(expected.listings)) {
    const got = (all[sid] ?? {}) as Json
    ;(observed.listings as Json)[sid] = Object.fromEntries(
      Object.keys(want).map((k) => [k, got[k]]),
    )
  }
  return { observed, expected }
}
