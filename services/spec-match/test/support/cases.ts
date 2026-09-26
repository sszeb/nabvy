import { readdirSync, readFileSync } from 'node:fs'
import type { WantManagerCriterion } from '@nabvy/contracts/modules/want-manager'
import type { PartsAiResponse } from '@nabvy/parts-ai'
import { type ListingPoint, matchListings } from '../../src'
import {
  assessed,
  listingIdsBySource,
  loadRun,
  seedWant,
  type TestDatabase,
  type WantSeed,
  withFields,
} from './database'
import { observe } from './observe'

// One fixture case run end to end: the recorded rows (with the case's edits) through ingest,
// detail-evidence, parts-rules, parts-record, parts-ai (no call succeeds unless the case records
// a response) and listing-assessment; the case's wants stored in want-manager's tables; then this
// module on the `assessed` event, as the live pipeline delivers it.

type Json = Record<string, unknown>

/** A fixture case's input (README.md, "Fixtures and pass rate"). */
export interface CaseInput {
  run: string
  synthetic?: boolean
  /** Only these source listing IDs' rows (plus the run's other records). */
  only?: string[]
  /** Field edits per source listing ID (synthetic). */
  edits?: { listingId: string; fields: Json }[]
  /** Recorded model responses for this case, per source listing ID. */
  responses?: Record<string, PartsAiResponse>
  /**
   * pickup-location's points per source listing ID (`*` for every listing), standing in for the
   * injected `pointsFor` (a soft edge); a listing with none has no point.
   */
  points?: Record<string, { lat: number; lng: number; basis: string }>
  /** The case's wants, by name. */
  wants: Record<string, Omit<WantSeed, 'criteria'> & { criteria: WantManagerCriterion[] }>
}

/** What a case expects: per want, the listings it matched, and optionally the counts. */
export interface CaseExpected {
  wants: Record<string, Record<string, Json>>
  counts?: Record<string, Json>
}

const CASES = new URL('../fixtures/cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))

export const caseIds = (): string[] => readdirSync(CASES).sort()

export function rowsOf(input: Pick<CaseInput, 'run' | 'only' | 'edits'>): Json[] {
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
): Promise<{ observed: CaseExpected; expected: CaseExpected }> {
  const input = read(new URL(`${id}/input.json`, CASES)) as CaseInput
  const expected = read(new URL(`${id}/expected.json`, CASES)) as CaseExpected
  const listingIds = await assessed(t, loadRun(input.run), rowsOf(input), input.responses ?? {})
  const names = new Map<string, string>()
  for (const [name, want] of Object.entries(input.wants)) {
    names.set((await seedWant(t, want)).wantId, name)
  }
  const bySource = await listingIdsBySource(t)
  const points = new Map<string, ListingPoint>()
  for (const [sid, id] of bySource) {
    const p = input.points?.[sid] ?? input.points?.['*']
    if (p) points.set(id, { point: { lat: p.lat, lng: p.lng }, basis: p.basis })
  }
  const pointsFor = async (_q: unknown, ids: string[]) =>
    new Map(ids.filter((id) => points.has(id)).map((id) => [id, points.get(id) as ListingPoint]))
  const result = await matchListings(t.db, { listingIds, now: new Date() }, { pointsFor })
  if (!result.ok) throw new Error(result.error.message)
  const all = await observe(t, names)
  const observed: CaseExpected = { wants: {} }
  for (const name of Object.keys(expected.wants)) observed.wants[name] = all.wants[name] ?? {}
  if (expected.counts) {
    observed.counts = {}
    for (const name of Object.keys(expected.counts)) {
      observed.counts[name] = all.counts[name] ?? {
        matches: 0,
        notStated: 0,
        fromDescriptionOnly: 0,
      }
    }
  }
  return { observed, expected }
}
