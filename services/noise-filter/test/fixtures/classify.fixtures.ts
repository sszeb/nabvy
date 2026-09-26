import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caseIds, runCase } from '../support/cases'
import { ALL_ON, createTestDatabase, type TestDatabase } from '../support/database'

// Stage "classify": recorded rows (or synthetic rows built from them) stored as a collected
// gateway job and run through ingest, detail-evidence, parts-rules, parts-record, parts-ai (with
// the case's recorded responses) and listing-assessment, then through this module on the
// `assessed` event, on the real migrations in PGlite. Each case checks, per listing, the reasons
// and term statuses `v_classifications` shows (support/observe.ts).

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('classify', () => {
  it.each(caseIds())('%s', async (id) => {
    const { observed, expected } = await runCase(t, id)
    expect(observed).toEqual(expected)
  })
})
