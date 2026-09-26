import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { index, splitHalfStable } from '../../src'
import {
  copyCluster,
  createTestDatabase,
  relistGroup,
  type SeedListing,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from '../support/database'

// Stage "index": synthetic listings, seeded through the upstream modules' own tables on the real
// migrations in PGlite, indexed as one batch. Each case checks every group's figures, each
// member's outcome, and (for n>=10) the split-half stability check (PARTS_INTELLIGENCE.md:386-388).
// Listing IDs in the cases are short names; the test maps them to UUIDs.

interface Input {
  synthetic: true
  builtFrom: string
  listings: (Omit<SeedListing, 'id'> & { id: string })[]
  relist?: string[][]
  copy?: string[][]
  /** Upstream modules left off (their views read as "no data"). */
  off?: string[]
  now: string
}

interface Expected {
  groups: Record<string, Record<string, unknown>>
  members: Record<string, string>
  stable?: Record<string, boolean | null>
  implied?: Record<string, number>
}

const CASES = new URL('./cases/', import.meta.url)
const cases = readdirSync(CASES).sort()
const read = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T
const uuid = (i: number) => `01900000-0000-7000-8000-${String(i).padStart(12, '0')}`

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
}, 60_000)
afterEach(() => db.close())

describe('index', () => {
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
      for (const g of input.relist ?? [])
        await relistGroup(
          db,
          g.map((id) => ids.get(id) as string),
        )
      for (const [i, g] of (input.copy ?? []).entries()) {
        await copyCluster(
          db,
          `cluster-${i}`,
          g.map((id) => ids.get(id) as string),
        )
      }
      await switchOn(db, [...UPSTREAM, 'relist-merge', 'copy-advert'])
      for (const off of input.off ?? []) await setSwitch(db, 'off', off)
      await setSwitch(db, 'on')

      const result = await db.as('nabvy_pipeline', (q) =>
        index(q, { listingIds: [...ids.values()] }, { now: new Date(input.now) }),
      )
      if (!result.ok) throw new Error(result.error.message)

      const groups = await db.sql(
        `select group_key, n, median, mad, p25, p75, min, max, thin, copy_collapse
         from asking_price_index.v_groups order by group_key`,
      )
      const members = await db.sql(
        'select group_key, listing_id, counted, excluded from asking_price_index.v_members',
      )
      const actual: Expected = {
        groups: Object.fromEntries(
          groups.map(({ group_key, ...figures }) => [
            String(group_key),
            Object.fromEntries(
              Object.entries(figures).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]),
            ),
          ]),
        ),
        members: Object.fromEntries(
          members
            .map((m) => [
              `${names.get(String(m.listing_id))}@${String(m.group_key).split('|').slice(1, 4).join('|')}`,
              m.counted ? 'counted' : String(m.excluded),
            ])
            .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
        ),
      }
      if (expected.stable) {
        actual.stable = Object.fromEntries(
          Object.keys(expected.stable).map((key) => [
            key,
            splitHalfStable(
              members
                .filter((m) => m.group_key === key && m.counted)
                .map((m) => ({
                  listingId: String(m.listing_id),
                  askMinor: Number(
                    input.listings.find((l) => ids.get(l.id) === m.listing_id)?.priceMinor,
                  ),
                })),
              0.25,
              10,
            ),
          ]),
        )
      }
      if (expected.implied) {
        const rows = await db.sql(
          'select pc_group_key, implied_rest_minor from asking_price_index.v_implied',
        )
        actual.implied = Object.fromEntries(
          rows.map((r) => [String(r.pc_group_key), Number(r.implied_rest_minor)]),
        )
      }
      expect(actual).toEqual(expected)
    })
  }
})
