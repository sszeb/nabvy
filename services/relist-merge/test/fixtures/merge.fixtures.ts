import { readdirSync, readFileSync } from 'node:fs'
import type { Queryable } from '@nabvy/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Evidence, type MergeEvidence, merge, type SellerKey } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  type Json,
  listingRows,
  loadRun,
  relist,
  type TestDatabase,
  upstream,
} from '../support/database'

// Stage "merge": recorded rows, and synthetic relists built from them, run through listing-ingest
// and detail-evidence on the real migrations in PGlite, then merged step by step with every
// listing of the step as the batch. Each case checks the stored groups (by source listing ID) and
// how many listing IDs each step announced. Seller keys and photo matches, which come from modules
// not built yet, are injected from the case, as the task file will inject them.

interface Relist {
  of: string
  as: string
  days: number
  description?: string
  cityPageId?: string
  /** Upper-cases the text and doubles its spaces (same fingerprint). */
  reformat?: boolean
}

interface Step {
  /** Recorded listing rows to include: all of them (true) or these source IDs. */
  recorded?: true | string[]
  /** Description edits of recorded rows (synthetic). */
  edits?: { id: string; description: string }[]
  relists?: Relist[]
}

interface Input {
  run: string
  steps: Step[]
  sellerKeys?: Record<string, SellerKey[]>
  photoMatches?: [string, string][]
}

interface Member {
  listing: string
  basis: string
  matched: string | null
}

interface Expected {
  groups: Member[][]
  announced: number[]
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

function withCityPage(row: Json, id: string): Json {
  const copy = structuredClone(row)
  const location = ((copy.sourceFields as Json).search as Json).location as Json
  ;(location.reverse_geocode as Json).city_page = { id, display_name: 'Elsewhere' }
  return copy
}

function rowsFor(step: Step, recordedRows: Json[]): Json[] {
  const byId = new Map(recordedRows.map((row) => [String(row.listingId), row]))
  const edited = new Map(
    (step.edits ?? []).map((e) => [e.id, { ...byId.get(e.id), description: e.description }]),
  )
  const base =
    step.recorded === true ? recordedRows : (step.recorded ?? []).map((id) => byId.get(id) as Json)
  const rows = base.map((row) => edited.get(String(row.listingId)) ?? row)
  for (const r of step.relists ?? []) {
    let row = relist(byId.get(r.of) as Json, r.as, r.days)
    if (r.description !== undefined) row = { ...row, description: r.description }
    if (r.cityPageId) row = withCityPage(row, r.cityPageId)
    if (r.reformat) {
      row = { ...row, description: String(row.description).toUpperCase().replaceAll(' ', '  ') }
    }
    rows.push(row)
  }
  return rows
}

async function uuidMap(): Promise<Map<string, string>> {
  const rows = await t.sql('select id, source_listing_id from listing_ingest.listings')
  return new Map(rows.map((row) => [String(row.source_listing_id), String(row.id)]))
}

function evidenceFor(input: Input): MergeEvidence {
  return {
    async photoMatches(_q: Queryable, listingIds: string[]): Promise<Evidence[]> {
      const ids = await uuidMap()
      const wanted = new Set(listingIds)
      return (input.photoMatches ?? []).flatMap(([a, b]) => {
        const [ua, ub] = [ids.get(a), ids.get(b)]
        return ua && ub && (wanted.has(ua) || wanted.has(ub))
          ? [{ listingId: ua, otherListingId: ub, basis: 'photo' as const }]
          : []
      })
    },
    async sellerKeys(_q: Queryable, listingIds: string[]) {
      const ids = await uuidMap()
      const wanted = new Set(listingIds)
      return new Map(
        Object.entries(input.sellerKeys ?? {}).flatMap(([id, keys]) => {
          const uuid = ids.get(id)
          return uuid && wanted.has(uuid) ? [[uuid, keys] as const] : []
        }),
      )
    },
  }
}

describe('merge', () => {
  for (const name of cases) {
    it(name, async () => {
      const input: Input = read(new URL(`${name}/input.json`, CASES))
      const expected: Expected = read(new URL(`${name}/expected.json`, CASES))
      const recorded = loadRun(input.run)
      const recordedRows = listingRows(recorded)
      const evidence = evidenceFor(input)

      const announced: number[] = []
      for (const step of input.steps) {
        const listingIds = await upstream(t, recorded, rowsFor(step, recordedRows))
        const result = await merge(t.db, { listingIds }, evidence)
        if (!result.ok) throw new Error(result.error.message)
        announced.push(
          result.value.events.reduce(
            (n, e) => n + (e.payload as { listingIds: string[] }).listingIds.length,
            0,
          ),
        )
      }

      const sourceOf = new Map([...(await uuidMap())].map(([source, id]) => [id, source]))
      const rows = await t.asPipeline(
        'select group_id, listing_id, basis, matched_listing_id from relist_merge.v_groups',
      )
      const groups = new Map<string, Member[]>()
      for (const row of rows) {
        const members = groups.get(String(row.group_id)) ?? []
        members.push({
          listing: sourceOf.get(String(row.listing_id)) as string,
          basis: String(row.basis),
          matched: row.matched_listing_id
            ? (sourceOf.get(String(row.matched_listing_id)) as string)
            : null,
        })
        groups.set(String(row.group_id), members)
      }
      const actual = [...groups.values()]
        .map((members) => members.sort((a, b) => (a.listing < b.listing ? -1 : 1)))
        .sort((a, b) => ((a[0]?.listing ?? '') < (b[0]?.listing ?? '') ? -1 : 1))

      expect({ groups: actual, announced }).toEqual(expected)
    })
  }
})
