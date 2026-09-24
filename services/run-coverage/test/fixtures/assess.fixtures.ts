import { readdirSync, readFileSync } from 'node:fs'
import { ingest } from '@nabvy/listing-ingest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assess } from '../../src'
import { ALL_ON, createTestDatabase, loadRun, type TestDatabase } from '../support/database'

// Stage "assess": the recorded run (or a synthetic summary built from it) stored as a collected
// gateway job, ingested by listing-ingest (so the gap check has sightings), then judged, step by
// step, on the real migrations in PGlite. Each case checks what every step judged and announced,
// the chosen fields of every row of v_search_coverage, and v_scope_baselines. Job IDs are shown
// as step numbers (1-based).

type Json = Record<string, unknown>

interface Step {
  /** Fields replacing those of RUN_SUMMARY.searches[0] (null removes the field). */
  search?: Json
  /** Top-level RUN_SUMMARY fields replaced. */
  summary?: Json
  /** `renumbered`: every listing ID changed (a page with no listing in common with the last). */
  rows?: 'recorded' | 'renumbered' | 'none'
  status?: 'succeeded' | 'failed'
  /** Whether listing-ingest ingests the job first (default: yes, unless the run failed). */
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
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

function rowsFor(step: Step, dataset: Json[]): Json[] {
  if (step.rows === 'none') return dataset.filter((row) => row.recordType !== 'listing')
  if (step.rows !== 'renumbered') return dataset
  return dataset.map((row) =>
    typeof row.listingId === 'string' ? { ...row, listingId: `9${row.listingId}` } : row,
  )
}

function summaryFor(step: Step, summary: Json): Json {
  const [first, ...rest] = summary.searches as Json[]
  const search = Object.fromEntries(
    Object.entries({ ...first, ...step.search }).filter(([, v]) => v !== null),
  )
  return { ...summary, ...step.summary, searches: [search, ...rest] }
}

const pick = (row: Json, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]))

describe('assess', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as Input
    const expected = read(new URL(`${id}/expected.json`, CASES))
    const recorded = loadRun(input.run)

    const stepOf = new Map<number, number>()
    const steps: Json[] = []
    for (const [i, step] of input.steps.entries()) {
      const status = step.status ?? 'succeeded'
      const jobId = await t.collected(recorded, rowsFor(step, recorded.dataset), {
        status,
        runSummary: summaryFor(step, recorded.runSummary),
      })
      stepOf.set(jobId, i + 1)
      if (step.ingest ?? status === 'succeeded') {
        const ingested = await ingest(t.db, { jobId, kind: 'search' })
        if (!ingested.ok) throw new Error(ingested.error.message)
      }
      const result = await assess(t.db, { jobId, kind: 'search' })
      if (!result.ok) throw new Error(result.error.message)
      steps.push({
        written: result.value.written,
        statuses: result.value.statuses.map((s) => s.status),
        degraded: result.value.degraded.length,
        events: result.value.events.length,
      })
    }

    const outcomeKeys = Object.keys(expected.outcomes[0] ?? {})
    const observed: Json = { steps }
    observed.outcomes = (
      await t.asPipeline(
        'select * from run_coverage.v_search_coverage order by job_id, search_index',
      )
    ).map((row) => {
      const o = camel(row)
      return pick(
        {
          ...o,
          step: stepOf.get(o.jobId as number),
          previousStep: o.previousJobId === null ? null : stepOf.get(o.previousJobId as number),
        },
        outcomeKeys,
      )
    })
    observed.baselines = (
      await t.asPipeline(
        'select * from run_coverage.v_scope_baselines order by centre_id, term, kind',
      )
    ).map((row) => {
      const { jobId, firstCompleteAt: _at, ...rest } = camel(row)
      return { ...rest, step: stepOf.get(jobId as number) }
    })

    expect(observed).toEqual(expected)
  })
})
