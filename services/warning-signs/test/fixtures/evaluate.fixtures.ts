import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caseIds, runCase } from '../support/cases'
import {
  createTestDatabase,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from '../support/database'

// Stage "evaluate": recorded rows (or synthetic rows built from them) seeded into the upstream
// modules' tables and run through this module on the real migrations in PGlite. Each case checks,
// per listing, the fact codes `v_facts` shows (support/cases.ts).

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await switchOn(t, UPSTREAM)
  await setSwitch(t, 'on')
})
afterEach(async () => {
  await t.close()
})

describe('evaluate', () => {
  it.each(caseIds())('%s', async (id) => {
    const { observed, expected } = await runCase(t, id)
    expect(observed).toEqual(expected)
  })
})
