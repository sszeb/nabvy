import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { select } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  type Json,
  listingRows,
  loadRun,
  type TestDatabase,
  upstream,
  withCategory,
  withCityPage,
  withDeliveryTypes,
  withListingId,
  withTitle,
} from '../support/database'

// Stage "select": recorded rows, edited per case, run through listing-ingest and city-pages on
// the real migrations in PGlite, then selected. Each case checks which source listing IDs were
// selected and why, and that a replayed selection writes nothing new (rule 8).

interface RowSpec {
  /** A recorded row's source listing ID to start from. */
  of: string
  /** A fresh source listing ID for this row, so cases never collide on the recorded ID. */
  as: string
  title?: string
  /** `null` clears the category (unknown). Omit to keep the recorded row's category. */
  categoryId?: string | null
  cityPageId?: string
  deliveryTypes?: string[]
}

interface Input {
  run: string
  rows: RowSpec[]
  /** Switch overrides on top of ALL_ON, applied before selecting. */
  switches?: Record<string, 'off' | 'shadow' | 'on'>
}

interface Expected {
  selected: { sourceListingId: string; reason: string }[]
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

function rowFor(spec: RowSpec, recordedRows: Json[]): Json {
  const base = recordedRows.find((row) => row.listingId === spec.of)
  if (!base) throw new Error(`fixture: recorded listing ${spec.of} not found`)
  let row = withListingId(base, spec.as)
  if (spec.title !== undefined) row = withTitle(row, spec.title)
  if (spec.categoryId !== undefined) row = withCategory(row, spec.categoryId)
  if (spec.cityPageId !== undefined) row = withCityPage(row, spec.cityPageId)
  if (spec.deliveryTypes !== undefined) row = withDeliveryTypes(row, spec.deliveryTypes)
  return row
}

describe('select', () => {
  for (const name of cases) {
    it(name, async () => {
      const input: Input = read(new URL(`${name}/input.json`, CASES))
      const expected: Expected = read(new URL(`${name}/expected.json`, CASES))
      const recorded = loadRun(input.run)
      const recordedRows = listingRows(recorded)
      const rows = input.rows.map((spec) => rowFor(spec, recordedRows))

      if (input.switches) await t.switches(input.switches)
      const listingIds = await upstream(t, recorded, rows)
      const first = await select(t.db, { listingIds })
      if (!first.ok) throw new Error(first.error.message)

      const actual = first.value.selected
        .map((s) => ({ sourceListingId: s.sourceListingId, reason: s.reason }))
        .sort((a, b) => (a.sourceListingId < b.sourceListingId ? -1 : 1))
      expect(actual).toEqual(
        [...expected.selected].sort((a, b) => (a.sourceListingId < b.sourceListingId ? -1 : 1)),
      )

      // Replay: rule 8, a repeated selection over the same card versions writes nothing new.
      const second = await select(t.db, { listingIds })
      if (!second.ok) throw new Error(second.error.message)
      expect(second.value.selected).toEqual([])
    })
  }
})
