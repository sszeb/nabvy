import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PARTS_AI_PROMPT_VERSION } from '../../src'
import { caseIds, runCase } from '../support/cases'
import { ALL_ON, createTestDatabase, openThrottle, type TestDatabase } from '../support/database'
import { loadRecording } from '../support/model'

// Stage "extract": recorded rows (or synthetic rows built from them) stored as a collected
// gateway job, ingested, recorded by detail-evidence and run through parts-rules, then through
// this module with the recorded model on the real migrations in PGlite. Each case checks, per
// listing, how the call ended, the kind and every part as the published views give them:
// `<source>:<part type>:<quote>[ → <catalogue ID>| (<family>)] [<inclusion>]`, and the report.

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
    expect(loadRecording('current').promptVersion).toBe(PARTS_AI_PROMPT_VERSION)
  })

  it.each(caseIds())('%s', async (id) => {
    const { observed, expected } = await runCase(t, id)
    expect(observed).toEqual(expected)
  })
})
