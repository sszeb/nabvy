import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caseIds, runCase } from '../support/cases'
import { ALL_ON, createTestDatabase, type TestDatabase } from '../support/database'

// Stage "assess": recorded rows (or synthetic rows built from them) stored as a collected gateway
// job and run through ingest, detail-evidence, parts-rules, parts-record and parts-ai (with the
// case's recorded responses), then through this module on the `recorded` event, on the real
// migrations in PGlite. Each case checks, per listing, what `v_assessments` and `v_unknowns`
// show (support/observe.ts).

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('assess', () => {
  it.each(caseIds())('%s', async (id) => {
    const { observed, expected } = await runCase(t, id)
    expect(observed).toEqual(expected)
  })
})
