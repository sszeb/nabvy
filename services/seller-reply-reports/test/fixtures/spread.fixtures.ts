import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../support/database'
import { casesOf, type Row, readCase, runScenario, type Scenario } from '../support/scenario'

// Stage "spread": reports spread across a confirmed copy-advert cluster: re-measured per member for
// location, never to the possible original, own listing only without a cluster (design §3.2). Each case lists every evidence row written.

const NOW = new Date('2026-09-25T12:00:00.000Z')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('spread', () => {
  for (const id of casesOf('spread')) {
    it(id, async () => {
      const { rows } = await runScenario(t, id, readCase(id, 'input.json') as Scenario, NOW)
      expect(rows).toEqual((readCase(id, 'expected.json') as { evidence: Row[] }).evidence)
    })
  }
})
