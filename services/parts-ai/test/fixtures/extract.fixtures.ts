import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PARTS_AI_PROMPT_VERSION, run } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  openThrottle,
  type TestDatabase,
  USD_GBP_RATE,
  withFields,
} from '../support/database'
import { loadRecording, recordedClient } from '../support/model'
import { type CaseInput, observe } from '../support/observe'

// Stage "extract": recorded rows (or synthetic rows built from them) stored as a collected
// gateway job, ingested, recorded by detail-evidence and run through parts-rules, then through
// this module with the recorded model on the real migrations in PGlite. Each case checks, per
// listing, how the call ended, the kind and every part as the published views give them:
// `<source>:<part type>:<quote>[ → <catalogue ID>| (<family>)] [<inclusion>]`, and the report.

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()
const current = loadRecording('current')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await openThrottle(t)
})
afterEach(async () => {
  await t.close()
})

describe('extract', () => {
  it('the recordings were made with the current prompt', () => {
    // Changing the prompt or the output schema changes the version: re-record, then re-run.
    expect(current.promptVersion).toBe(PARTS_AI_PROMPT_VERSION)
  })

  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as CaseInput
    const expected = read(new URL(`${id}/expected.json`, CASES))
    const recorded = loadRun(input.run)
    const rowsOf = (edits: CaseInput['edits']) => {
      let rows = recorded.dataset as Record<string, unknown>[]
      if (input.only) {
        const keep = new Set(input.only)
        rows = rows.filter((r) => r.recordType !== 'listing' || keep.has(String(r.listingId)))
      }
      for (const edit of edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)
      return rows
    }
    const responses = { ...current.responses, ...(input.responses ?? {}) }

    let listingIds = await detailed(t, recorded, rowsOf(input.edits))
    let client = await recordedClient(t, responses)
    let modelCalls = 0
    let result = await run(t.db, { listingIds }, { client }, { usdGbpRate: USD_GBP_RATE })
    if (!result.ok) throw new Error(result.error.message)
    if (input.second) {
      // A second collected job (another run ID); the replayed batch names the first job's
      // listings too, as a duplicate event or the sweep would.
      const again = await detailed(
        t,
        { ...recorded, apifyRunId: `${recorded.apifyRunId}-2` },
        rowsOf([...(input.edits ?? []), ...input.second]),
      )
      listingIds = [...new Set([...listingIds, ...again])]
      modelCalls += client.calls.length
      client = await recordedClient(t, responses)
      result = await run(t.db, { listingIds }, { client }, { usdGbpRate: USD_GBP_RATE })
      if (!result.ok) throw new Error(result.error.message)
    }
    modelCalls += client.calls.length
    const observed = await observe(t, result.value, modelCalls, expected)
    expect(observed).toEqual(expected)
  })
})
