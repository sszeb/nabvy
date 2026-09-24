import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ingest } from '../../src'
import {
  ALL_ON,
  asDetailRows,
  createTestDatabase,
  loadRun,
  type TestDatabase,
  withPrice,
} from '../support/database'

// Stage "ingest": recorded rows (or synthetic rows built from them) stored as collected gateway
// jobs, then ingested job by job on the real migrations in PGlite. Each case checks what every
// step announced, the listings and observations written, v_price_changes, and chosen fields of
// one listing and one observation as the published views give them.

type Json = Record<string, unknown>

interface Step {
  kind: 'search' | 'details'
  price?: { listingId: string; amountMinor: number }
  /** Rewrites each `money.rawAmount` and `display` (the text differs; the amount does not). */
  rawDisplay?: boolean
}

interface Input {
  run: string
  steps: Step[]
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

const camel = (row: Json) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v,
    ]),
  )

function rowsFor(step: Step, dataset: Json[]): Json[] {
  let rows = step.kind === 'details' ? asDetailRows(dataset) : dataset
  if (step.price) rows = withPrice(rows, step.price.listingId, step.price.amountMinor)
  if (step.rawDisplay) {
    rows = rows.map((row) => {
      const money = row.money as Json | undefined
      if (!money || typeof money.amountMinor !== 'number') return row
      const text = `£${money.amountMinor / 100}`
      return { ...row, money: { ...money, rawAmount: text, display: text } }
    })
  }
  return rows
}

describe('ingest', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as Input
    const expected = read(new URL(`${id}/expected.json`, CASES))
    const recorded = loadRun(input.run)
    const sourceIdOf = async () =>
      new Map(
        (await t.asPipeline('select id, source_listing_id from listing_ingest.v_listings')).map(
          (r) => [r.id as string, r.source_listing_id as string],
        ),
      )

    const steps: Json[] = []
    for (const step of input.steps) {
      const jobId = await t.collected(recorded, rowsFor(step, recorded.dataset))
      const result = await ingest(t.db, { jobId, kind: step.kind })
      if (!result.ok) throw new Error(result.error.message)
      const names = await sourceIdOf()
      steps.push({
        cards: result.value.cards,
        sightingsWritten: result.value.sightingsWritten,
        firstSeen: result.value.firstSeen.length,
        cardChanged: result.value.cardChanged.map((listingId) => names.get(listingId)),
      })
    }

    const names = await sourceIdOf()
    const observed: Json = { steps }
    const [count] = await t.asPipeline('select count(*)::int as n from listing_ingest.v_listings')
    observed.listings = count?.n
    const kinds = await t.asPipeline(
      `select count(*) filter (where kind = 'search')::int as search,
              count(*) filter (where kind = 'detail')::int as detail
       from listing_ingest.v_sightings`,
    )
    observed.sightings = kinds[0]
    observed.priceChanges = (
      await t.asPipeline(
        `select listing_id, kind, previous_minor, price_minor, currency
         from listing_ingest.v_price_changes order by seen_at`,
      )
    ).map((r) => {
      const { listingId, ...rest } = camel(r)
      return { sourceListingId: names.get(listingId as string), ...rest }
    })

    if (expected.listing) {
      const [row] = await t.asPipeline(
        'select * from listing_ingest.v_listings where source_listing_id = $1',
        [expected.listing.sourceListingId],
      )
      const listing = camel(row ?? {})
      observed.listing = Object.fromEntries(
        Object.keys(expected.listing).map((key) => [key, listing[key]]),
      )
    }
    if (expected.sighting) {
      const [row] = await t.asPipeline(
        `select s.* from listing_ingest.v_sightings s
         join listing_ingest.v_listings l on l.id = s.listing_id
         where l.source_listing_id = $1 and s.kind = $2`,
        [expected.sighting.sourceListingId, expected.sighting.kind],
      )
      const sighting = camel(row ?? {})
      observed.sighting = {
        sourceListingId: expected.sighting.sourceListingId,
        ...Object.fromEntries(
          Object.keys(expected.sighting)
            .filter((key) => key !== 'sourceListingId')
            .map((key) => [key, sighting[key]]),
        ),
      }
    }

    expect(observed).toEqual(expected)
  })
})
