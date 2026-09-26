import { readdirSync, readFileSync } from 'node:fs'
import { PreparedMessage } from '@nabvy/contracts/modules/prepared-message'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildMany } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  listingIdOf,
  type SeedAssessment,
  type TestDatabase,
} from '../support/database'

// Stage "build": assessment rows (from listing-assessment's recorded fixtures, each case's
// notes.md) seeded into listing_assessment.assessments, read back through the real v_assessments
// and v_unknowns in PGlite, and built with every switch on. Each case checks, per listing, the
// asks and the checks (`partType:quote`), or null when there is nothing to ask.

const casesDir = new URL('./cases/', import.meta.url)
const caseIds = readdirSync(casesDir).sort()
const read = (id: string, file: string) =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('build', () => {
  it.each(caseIds)('%s', async (id) => {
    const input: { assessments: SeedAssessment[] } = read(id, 'input.json')
    const expected: { messages: Record<string, unknown> } = read(id, 'expected.json')
    await t.seed(input.assessments)
    const keys = [...new Set(input.assessments.map((a) => a.key))]
    const built = await buildMany(t.db, { listingIds: keys.map(listingIdOf) })
    const observed = Object.fromEntries(
      keys.map((key) => {
        const message = built.get(listingIdOf(key))
        if (!message) return [key, null]
        expect(PreparedMessage.parse(message)).toEqual(message)
        return [
          key,
          {
            asks: message.checklist.filter((i) => i.kind === 'ask').map((i) => i.partType),
            checks: message.checklist
              .filter((i) => i.kind === 'check')
              .map((i) => `${i.partType}:${/"(.*)"$/.exec(i.text)?.[1]}`),
          },
        ]
      }),
    )
    expect(observed).toEqual(expected.messages)
  })
})
