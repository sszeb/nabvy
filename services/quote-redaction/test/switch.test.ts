import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quoteFor, redact } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// Fail closed (card "When off"): no quote and no model text unless the switch reads 'on'.
// Reads the live switch through @nabvy/switches (task 0.11); the seed leaves quote-redaction off.

let t: TestDatabase
beforeAll(async () => {
  t = await createTestDatabase()
}, 60_000) // PGlite startup plus migrations is slow on a loaded runner (0.9b)
afterAll(async () => {
  await t.close()
})

const text = 'Call 07700 900123'

describe('quoteFor', () => {
  it('returns nothing while the seeded switch is off', async () => {
    expect(await quoteFor(t.db, text)).toBeNull()
  })

  it('masks once the switch is on', async () => {
    await t.sql(`update switches.switches set state = 'on' where name = 'quote-redaction'`)
    expect(await quoteFor(t.db, text)).toEqual(redact(text))
  })

  it('returns nothing while shadow (rule 11: only a module switch may be shadow)', async () => {
    await t.sql(`update switches.switches set state = 'shadow' where name = 'quote-redaction'`)
    expect(await quoteFor(t.db, text)).toBeNull()
    await t.sql(`update switches.switches set state = 'off' where name = 'quote-redaction'`)
  })
})
