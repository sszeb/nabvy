import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { canMarket, pauseAll, setPreference } from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `can-market`: the module's core gate (module card, "Outputs"). Each case sets up a user's
// switch state, standing, consent and suppression, then checks `canMarket()`'s decision — the
// card's own acceptance test, "a suppressed address is never sent to", is one of these cases.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  moduleState: z.enum(['off', 'shadow', 'on']),
  banned: z.boolean(),
  granted: z.boolean(),
  paused: z.boolean(),
  suppressed: z.boolean(),
})
const Expected = z.strictObject({ canMarket: z.boolean() })

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .flatMap((id) => {
    const parsed = Input.safeParse(read(id, 'input.json'))
    return parsed.success
      ? [{ id, input: parsed.data, expected: Expected.parse(read(id, 'expected.json')) }]
      : []
  })

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)
afterAll(() => db.close())

describe('can-market', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const userId = randomUUID()
    const email = `${userId}@example.com`
    await db.createUser({ userId, banned: input.banned })
    // Always set explicitly (never skipped for 'off'): cases share one database, so a state left
    // over from an earlier case must never leak into this one.
    await db.sql(
      `insert into switches.switches (name, kind, state) values ('marketing-consent', 'module', $1)
       on conflict (name) do update set state = excluded.state`,
      [input.moduleState],
    )
    if (input.granted) {
      await db.as(
        'nabvy_app',
        (tx) => setPreference(tx, { userId, category: 'tips', granted: true, source: 'signup' }),
        userId,
      )
    }
    if (input.paused) {
      await db.as(
        'nabvy_app',
        (tx) => pauseAll(tx, { userId, source: 'preference-centre' }),
        userId,
      )
    }
    if (input.suppressed) {
      await db.sql(
        `insert into marketing_consent.email_suppressions (email_hash, reason, source)
         values (encode(sha256(convert_to(lower($1), 'UTF8')), 'hex'), 'bounce', 'resend')`,
        [email],
      )
    }

    const result = await db.as('nabvy_pipeline', (tx) =>
      canMarket(tx, { userId, email, category: 'tips' }),
    )
    expect(result).toBe(expected.canMarket)
  })
})
