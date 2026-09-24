import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { add, suppressed } from '../../src'
import {
  ALL_ON,
  collectedAndRecorded,
  createSampleAppView,
  createTestDatabase,
  loadRun,
  type TestDatabase,
} from '../support/database'

// Stage "add": the recorded run stored as a collected gateway job, ingested by listing-ingest and
// recorded by detail-evidence on the real migrations in PGlite; then a seller-rights request is
// added, and later runs (synthetic relists built from recorded rows) are collected. Each case
// checks what `add` wrote and which source listing IDs the list hides, through v_suppressed, through
// is_suppressed() and through a sample user-facing view.

type Json = Record<string, unknown>

interface Relist {
  /** The recorded row the relist copies. */
  from: string
  /** The new source listing ID, replacing every copy of the old one in the row. */
  newId: string
  /** Field edits on the copy (synthetic). */
  fields?: Json
}

interface Input {
  run: string
  /** Whether the recorded run is collected before the request (default true). */
  collectFirst?: boolean
  add: {
    requestId: string
    listings: { source: 'facebook'; sourceListingId: string }[]
    /** Seller keys, as seeds hashed when the test runs (no key-shaped literal in the repo). */
    sellerKeySeeds?: string[]
    /** When the request is recorded (default: now). */
    now?: string
  }
  /** Runs collected after the request. */
  relists?: Relist[]
  /** Collect the recorded run after the request (with collectFirst false). */
  collectAfter?: boolean
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await createSampleAppView(t)
})
afterEach(async () => {
  await t.close()
})

function relistRows(dataset: Json[], relists: Relist[]): Json[] {
  return relists.map((relist) => {
    const row = dataset.find((r) => r.listingId === relist.from)
    if (!row) throw new Error(`no recorded row ${relist.from}`)
    const copy = JSON.parse(JSON.stringify(row).replaceAll(relist.from, relist.newId)) as Json
    return { ...copy, ...relist.fields }
  })
}

async function hidden(): Promise<Json> {
  const bySource = await t.asPipeline(
    `select l.source_listing_id as id, s.reason
     from listing_suppression.v_suppressed s
     join listing_ingest.v_listings l on l.id = s.listing_id
     order by 1, 2`,
  )
  const all = await t.asPipeline(
    `select id::text as id, source_listing_id from listing_ingest.v_listings`,
  )
  const hiddenIds = await suppressed(
    t.db,
    all.map((r) => String(r.id)),
  )
  const [card] = await t.asApp(`select count(*)::int as n from app.v_listing_card_sample`)
  return {
    suppressed: bySource.map((r) => `${r.id} ${r.reason}`),
    isSuppressed: all
      .filter((r) => hiddenIds.has(String(r.id)))
      .map((r) => String(r.source_listing_id))
      .sort(),
    appRows: card?.n,
    listings: all.length,
  }
}

describe('add', () => {
  for (const id of cases) {
    it(id, async () => {
      const input = read(new URL(`${id}/input.json`, CASES)) as Input
      const expected = read(new URL(`${id}/expected.json`, CASES))
      const recorded = loadRun(input.run)

      if (input.collectFirst !== false) await collectedAndRecorded(t, recorded)
      const { now, sellerKeySeeds, ...request } = input.add
      const sellerKeys = (sellerKeySeeds ?? []).map((seed) =>
        createHash('sha256').update(seed).digest('hex'),
      )
      const result = await add(t.db, { ...request, sellerKeys }, now ? { now: new Date(now) } : {})
      if (!result.ok) throw new Error(result.error.message)
      if (input.collectAfter) await collectedAndRecorded(t, recorded)
      if (input.relists) {
        await collectedAndRecorded(t, recorded, relistRows(recorded.dataset, input.relists))
      }

      const entries = await t.asPipeline(
        `select kind, basis, count(*)::int as n from listing_suppression.entries
         group by kind, basis order by kind, basis`,
      )
      const actual = {
        written: result.value.written,
        withoutLookalike: result.value.withoutLookalike.map((l) => l.sourceListingId),
        entries: entries.map((e) => `${e.kind}${e.basis ? `/${e.basis}` : ''} ${e.n}`),
        ...(await hidden()),
      }
      expect(actual).toEqual(expected)
    })
  }
})
