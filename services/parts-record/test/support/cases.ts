import { readdirSync, readFileSync } from 'node:fs'
import type { PartsRecordPhotoVerdict } from '@nabvy/contracts/modules/parts-record'
import type { PartsAiResponse } from '@nabvy/parts-ai'
import { type PhotoVerdicts, record } from '../../src'
import { extracted, loadRun, ruled, type TestDatabase, withFields } from './database'
import { observe } from './observe'

// One fixture case run end to end: the recorded rows (with the case's edits) through ingest,
// detail-evidence and parts-rules, then parts-ai with the case's recorded responses (none: no
// call succeeds and the record holds rule rows only), then this module on the `ran` event and
// again on the `extracted` event, as the live pipeline delivers them.

type Json = Record<string, unknown>

/** A fixture case's input (README.md, "Fixtures and pass rate"). */
export interface CaseInput {
  run: string
  /** Only these source listing IDs' rows (plus the run's other records). */
  only?: string[]
  /** Field edits per source listing ID (synthetic). */
  edits?: { listingId: string; fields: Json }[]
  /** Recorded model responses for this case, per source listing ID (synthetic). */
  responses?: Record<string, PartsAiResponse>
  /** Photo verdicts fed through the injected seam, per source listing ID (synthetic). */
  photo?: {
    version: string
    verdicts: (Omit<PartsRecordPhotoVerdict, 'listingId' | 'evidenceHash' | 'photoVersion'> & {
      listingId: string
    })[]
  }
}

const CASES = new URL('../fixtures/cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))

export const caseIds = (): string[] => readdirSync(CASES).sort()

export function rowsOf(input: CaseInput): Json[] {
  const recorded = loadRun(input.run)
  let rows = recorded.dataset as Json[]
  if (input.only) {
    const keep = new Set(input.only)
    rows = rows.filter((r) => r.recordType !== 'listing' || keep.has(String(r.listingId)))
  }
  for (const edit of input.edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)
  return rows
}

/**
 * The photo-review seam for a case: the case's verdicts, keyed to each listing's current
 * evidence hash the way photo-review's view would key them. No verdicts: the module's default.
 */
export function photoSeam(t: TestDatabase, photo: CaseInput['photo']): PhotoVerdicts {
  return async (_q, versions) => {
    if (!photo) return []
    const rows = await t.asPipeline(
      'select id, source_listing_id as sid from listing_ingest.v_listings',
    )
    const idOf = new Map(rows.map((r) => [r.sid as string, r.id as string]))
    return photo.verdicts.flatMap((v) => {
      const version = versions.find((x) => x.listingId === idOf.get(v.listingId))
      if (!version) return []
      return [
        {
          ...v,
          listingId: version.listingId,
          evidenceHash: version.evidenceHash,
          photoVersion: photo.version,
        },
      ]
    })
  }
}

/** Runs one case on `t` and returns what it observed beside what the case expects. */
export async function runCase(
  t: TestDatabase,
  id: string,
): Promise<{ observed: Json; expected: Json }> {
  const input = read(new URL(`${id}/input.json`, CASES)) as CaseInput
  const expected = read(new URL(`${id}/expected.json`, CASES)) as { listings: Record<string, Json> }
  const listingIds = await ruled(t, loadRun(input.run), rowsOf(input))
  const deps = { photoVerdicts: photoSeam(t, input.photo) }
  const onRan = await record(t.db, { listingIds }, deps)
  if (!onRan.ok) throw new Error(onRan.error.message)
  const withAi = await extracted(t, listingIds, input.responses ?? {})
  if (withAi.length > 0) {
    const onExtracted = await record(t.db, { listingIds: withAi }, deps)
    if (!onExtracted.ok) throw new Error(onExtracted.error.message)
  }
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
