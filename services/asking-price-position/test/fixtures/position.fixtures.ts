import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { position } from '../../src'
import {
  createTestDatabase,
  NOW,
  runIndex,
  type SeedListing,
  seed,
  setSwitch,
  shownRows,
  switchOn,
  type TestDatabase,
  uuid,
} from '../support/database'

// Stage "position": synthetic listings seeded through the upstream modules' own tables on the real
// migrations in PGlite, grouped by the real asking-price-index, then positioned as one batch of
// the group keys its `updated` event carries. Each case checks the named positions, how many
// positions were recorded (T4, shown or not) and how many rows users see. Listing IDs in the cases
// are short names; the test maps them to UUIDs.

interface Input {
  synthetic: true
  builtFrom: string
  listings: (Omit<SeedListing, 'id'> & { id: string })[]
}

interface Expected {
  positions: Record<string, Record<string, unknown>>
  recorded: number
  shown: number
  shownFor: Record<string, number>
}

const CASES = new URL('./cases/', import.meta.url)
const cases = readdirSync(CASES).sort()
const read = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
}, 60_000)
afterEach(() => db.close())

describe('position', () => {
  for (const name of cases) {
    it(name, async () => {
      const input = read<Input>(new URL(`${name}/input.json`, CASES))
      const expected = read<Expected>(new URL(`${name}/expected.json`, CASES))
      const ids = new Map(input.listings.map((l, i) => [l.id, uuid(i + 1)]))
      const names = new Map([...ids].map(([k, v]) => [v, k]))
      await seed(
        db,
        input.listings.map((l) => ({ ...l, id: ids.get(l.id) as string })),
      )
      await switchOn(db)
      await setSwitch(db, 'on')
      const groupKeys = await runIndex(db, [...ids.values()])

      const result = await db.as('nabvy_pipeline', (q) => position(q, { groupKeys }, { now: NOW }))
      if (!result.ok) throw new Error(result.error.message)

      const rows = await db.sql(
        `select listing_id, group_key, rank, n, percentile, robust_z, median, range_low,
           range_high, new_median, new_n
         from asking_price_position.v_positions`,
      )
      const keyOf = (r: Record<string, unknown>) =>
        `${names.get(String(r.listing_id))}@${String(r.group_key).split('|').slice(0, 3).join('|')}`
      const byKey = new Map(rows.map((r) => [keyOf(r), r]))
      const shown = await shownRows(db)
      const actual: Expected = {
        positions: Object.fromEntries(
          Object.keys(expected.positions).map((key) => {
            const r = byKey.get(key)
            return [
              key,
              r === undefined
                ? { none: true }
                : Object.fromEntries(
                    Object.keys(expected.positions[key] ?? {}).map((k) => {
                      const v = r[k]
                      return [k, typeof v === 'bigint' ? Number(v) : v]
                    }),
                  ),
            ]
          }),
        ),
        recorded: rows.length,
        shown: shown.length,
        shownFor: Object.fromEntries(
          Object.keys(expected.shownFor).map((n) => [
            n,
            shown.filter((s) => s.listing_id === ids.get(n)).length,
          ]),
        ),
      }
      expect(actual).toEqual(expected)
    })
  }
})
