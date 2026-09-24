import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { record } from '../../src'
import {
  ALL_ON,
  collectedAndIngested,
  createTestDatabase,
  later,
  loadRun,
  type TestDatabase,
  withFields,
} from '../support/database'

// Stage "record": recorded rows (or synthetic rows built from them) stored as collected gateway
// jobs, ingested by listing-ingest, then recorded job by job on the real migrations in PGlite.
// Each case checks what every step wrote and announced, the versions and their statuses, and
// chosen fields of one listing's current version and latest fetch as the published views give
// them.

type Json = Record<string, unknown>

interface Step {
  /** Collection time of every listing row (a later run of the same page). */
  collectedAt?: string
  /** Replaces each row's description with its `sourceFields.detail` copy. */
  detailCopy?: boolean
  /** Field edits per listing ID (synthetic). */
  edits?: { listingId: string; fields: Json }[]
  /** Rows reduced to what a details run returns for a removed ID (synthetic). */
  unresolved?: string[]
  /** Only these listing IDs' rows, plus unresolved ones (a details run of chosen IDs). */
  only?: string[]
  /** Whether listing-ingest ingests the job first (default true). */
  ingest?: boolean
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

const pick = (row: Json, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]))

function rowsFor(step: Step, dataset: Json[]): Json[] {
  let rows = dataset
  if (step.only) {
    const keep = new Set([...step.only, ...(step.unresolved ?? [])])
    rows = rows.filter((row) => keep.has(String(row.listingId)))
  }
  if (step.collectedAt) rows = later(rows, step.collectedAt)
  if (step.detailCopy) {
    rows = rows.map((row) => {
      const copy = ((row.sourceFields as Json | undefined)?.detail as Json | undefined)?.description
      return typeof copy === 'string' ? { ...row, description: copy } : row
    })
  }
  for (const edit of step.edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)
  for (const id of step.unresolved ?? []) {
    const row = rows.find((r) => r.listingId === id)
    const stub = {
      recordType: 'listing',
      listingId: id,
      collectedAt: step.collectedAt ?? '2026-09-24T01:40:43.415Z',
      detailAttempted: true,
      detailAttempts: 1,
      detailOutcome: 'extraction-error',
      directItemUnresolved: true,
    }
    rows = row ? rows.map((r) => (r === row ? stub : r)) : [...rows, stub]
  }
  return rows
}

describe('record', () => {
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
    let last: Json = {}
    for (const step of input.steps) {
      const rows = rowsFor(step, recorded.dataset)
      const jobId =
        step.ingest === false
          ? await t.collected(recorded, rows)
          : await collectedAndIngested(t, recorded, rows)
      const result = await record(t.db, { jobId })
      if (!result.ok) throw new Error(result.error.message)
      const names = await sourceIdOf()
      steps.push({
        details: result.value.details,
        versionsWritten: result.value.versionsWritten,
        fetchesWritten: result.value.fetchesWritten,
        changed: result.value.changed.length,
        unresolved: result.value.unresolved.length,
      })
      last = {
        changed: result.value.changed.map((listingId) => names.get(listingId)),
        unresolved: result.value.unresolved.map((listingId) => names.get(listingId)),
      }
    }

    const observed: Json = { steps, last }
    const [counts] = await t.asPipeline(
      `select count(*)::int as versions,
              count(*) filter (where description_status = 'full_verified')::int as full_verified
       from detail_evidence.v_text`,
    )
    observed.versions = counts
    const [current] = await t.asPipeline('select count(*)::int as n from detail_evidence.v_current')
    observed.current = current?.n

    if (expected.listing) {
      const [row] = await t.asPipeline(
        'select * from detail_evidence.v_current where source_listing_id = $1',
        [expected.listing.sourceListingId],
      )
      observed.listing = pick(camel(row ?? {}), Object.keys(expected.listing))
    }
    if (expected.text) {
      const [row] = await t.asPipeline(
        `select x.description from detail_evidence.v_text x
         join detail_evidence.v_current c using (listing_id, evidence_hash)
         where c.source_listing_id = $1`,
        [expected.text.sourceListingId],
      )
      observed.text = {
        sourceListingId: expected.text.sourceListingId,
        startsWith: String(row?.description ?? '').slice(0, expected.text.startsWith.length),
      }
    }
    if (expected.outcome) {
      const [row] = await t.asPipeline(
        `select * from detail_evidence.v_outcomes where source_listing_id = $1
         order by fetched_at desc, job_id desc limit 1`,
        [expected.outcome.sourceListingId],
      )
      observed.outcome = pick(camel(row ?? {}), Object.keys(expected.outcome))
    }

    expect(observed).toEqual(expected)
  })
})
