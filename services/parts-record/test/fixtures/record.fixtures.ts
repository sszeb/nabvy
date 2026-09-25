import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caseIds, runCase } from '../support/cases'
import { ALL_ON, createTestDatabase, type TestDatabase } from '../support/database'

// Stage "record": recorded rows (or synthetic rows built from them) stored as a collected
// gateway job, ingested, recorded by detail-evidence, run through parts-rules and parts-ai (with
// the case's recorded responses), then through this module on both events, on the real
// migrations in PGlite. Each case checks, per listing, the record's kind and who settled it, its
// extractor versions, its conflict flag and every part as the published views give them:
// `<extractor>:<source>:<part type>:<quote>[ → <catalogue ID>] [<inclusion>][ !conflict]`.

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('record', () => {
  it.each(caseIds())('%s', async (id) => {
    const { observed, expected } = await runCase(t, id)
    expect(observed).toEqual(expected)
  })
})
