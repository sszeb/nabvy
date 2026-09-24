import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  type TestDatabase,
  withFields,
} from '../support/database'

// Stage "run": recorded rows (or synthetic rows built from them) stored as a collected gateway
// job, ingested by listing-ingest and recorded by detail-evidence, then run through the rules on
// the real migrations in PGlite, with product-catalogue's seeded catalogue. Each case checks,
// per listing, the kind, the open parts, the kind signals, the tag blocks and every hit as the
// published views give them: `<source>:<part type>:<quote>[ → <catalogue ID>][ [<inclusion>]]`.

type Json = Record<string, unknown>

interface Input {
  run: string
  /** Only these source listing IDs' rows (plus the run's other records). */
  only?: string[]
  /** Field edits per source listing ID (synthetic). */
  edits?: { listingId: string; fields: Json }[]
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

async function observe(): Promise<Json> {
  const bySource = (sql: string) => t.asPipeline(sql)
  const listings: Record<string, Json> = {}
  const of = (sid: string) => {
    listings[sid] ??= { parts: [], signals: [], tagBlocks: [] }
    return listings[sid] as { parts: string[]; signals: string[]; tagBlocks: string[] } & Json
  }
  for (const g of await bySource(
    `select l.source_listing_id as sid, g.kind, g.kind_gap, g.parts, g.full_verified
     from parts_rules.v_gaps g join listing_ingest.v_listings l on l.id = g.listing_id`,
  )) {
    const o = of(g.sid as string)
    o.kind = g.kind ?? `gap:${g.kind_gap}`
    o.gaps = (g.parts as { partType: string; reason: string }[]).map(
      (p) => `${p.partType}:${p.reason}`,
    )
    o.fullVerified = g.full_verified
  }
  for (const p of await bySource(
    `select l.source_listing_id as sid, p.source, p.part_type, p.quote, p.catalogue_id,
            p.inclusion_candidate
     from parts_rules.v_rule_parts p join listing_ingest.v_listings l on l.id = p.listing_id
     order by p.seq`,
  )) {
    of(p.sid as string).parts.push(
      `${p.source}:${p.part_type}:${p.quote}${p.catalogue_id ? ` → ${p.catalogue_id}` : ''}${
        p.inclusion_candidate === 'offered' ? '' : ` [${p.inclusion_candidate}]`
      }`,
    )
  }
  for (const s of await bySource(
    `select l.source_listing_id as sid, s.signal, s.source, s.quote
     from parts_rules.v_kind_signals s join listing_ingest.v_listings l on l.id = s.listing_id`,
  )) {
    of(s.sid as string).signals.push(`${s.source}:${s.signal}:${s.quote}`)
  }
  for (const b of await bySource(
    `select l.source_listing_id as sid, b.source, b.rule_id, b."start", b."end"
     from parts_rules.v_tag_blocks b join listing_ingest.v_listings l on l.id = b.listing_id`,
  )) {
    of(b.sid as string).tagBlocks.push(`${b.source}:${b.rule_id}:${b.start}-${b.end}`)
  }
  return listings
}

describe('run', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as Input
    const expected = read(new URL(`${id}/expected.json`, CASES)) as {
      totals?: Json
      listings: Record<string, Json>
    }
    const recorded = loadRun(input.run)
    let rows = recorded.dataset as Json[]
    if (input.only) {
      const keep = new Set(input.only)
      rows = rows.filter((r) => r.recordType !== 'listing' || keep.has(String(r.listingId)))
    }
    for (const edit of input.edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)

    const listingIds = await detailed(t, recorded, rows)
    const result = await run(t.db, { listingIds })
    if (!result.ok) throw new Error(result.error.message)
    const all = await observe()
    const observed: Json = { listings: {} }
    if (expected.totals) {
      observed.totals = { runs: result.value.runsWritten, parts: result.value.partsWritten }
    }
    for (const [sid, want] of Object.entries(expected.listings)) {
      const got = (all[sid] ?? {}) as Json
      ;(observed.listings as Json)[sid] = Object.fromEntries(
        Object.keys(want).map((k) => [k, got[k]]),
      )
    }
    expect(observed).toEqual(expected)
  })
})
