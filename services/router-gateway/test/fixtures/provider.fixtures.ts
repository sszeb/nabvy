import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caseIds, runCase } from '../support/cases'
import { createTestDatabase, openGateway, type TestDatabase } from '../support/database'

// Stage "provider": recorded openrouteservice answers (Matrix V2 and Directions V2) replayed
// through table() and route() with the gateway open. Each case checks the metres-and-seconds
// result, or the RouterError code a caller falls back on.

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await openGateway(t)
})
afterEach(async () => {
  await t.close()
})

describe('provider', () => {
  it.each(caseIds())('%s', async (id) => {
    const { observed, expected } = await runCase(t, id)
    expect(observed).toEqual(expected)
  })
})
