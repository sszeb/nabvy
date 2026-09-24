import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { InMemoryProductEventsForwarder, track } from '../../src/index'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `track`: one track() call per case against the real migrations (PGlite), covering the
// two things the module card's "Tests and fixtures" line names: the consent gate and the
// property allowlist. Consent is set up directly in account.user_profiles (this suite tests
// product-events, not account's own write path); `consent: null` sets up no profile row at all.
// All cases are synthetic (docs/design/modules/_rules.md, rule 16): there is no recorded
// marketplace run to build a product-event case from.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  userId: z.uuid(),
  consent: z.boolean().nullable(),
  switchState: z.enum(['off', 'shadow', 'on']),
  sessionId: z.string().nullable(),
  trackInput: z.record(z.string(), z.unknown()),
})
const Expected = z.strictObject({
  result: z.union([
    z.strictObject({ ok: z.literal(true), recorded: z.boolean(), forwarded: z.boolean() }),
    z.strictObject({ ok: z.literal(false), code: z.string() }),
  ]),
  storedRowCount: z.number().int().nonnegative(),
  forwardedCalls: z.number().int().nonnegative(),
})

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

let harness: TestDatabase
beforeAll(async () => {
  harness = await createTestDatabase()
}, 60_000) // PGlite startup plus migrations is slow on a loaded runner
afterAll(() => harness.close())

describe('track', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    if (input.consent !== null) {
      await harness.sql(
        'insert into account.user_profiles (user_id, analytics_consent) values ($1, $2)',
        [input.userId, input.consent],
      )
    }
    if (input.switchState !== 'off') {
      await harness.sql(
        `insert into switches.switches (name, kind, state) values ('product-events', 'module', $1)
         on conflict (name) do update set state = excluded.state`,
        [input.switchState],
      )
    }

    const forwarder = new InMemoryProductEventsForwarder()
    const outcome = await harness.as(
      'nabvy_app',
      (db) =>
        track(db, input.userId, input.trackInput, {
          state: input.switchState,
          sessionId: input.sessionId ?? undefined,
          forwarder,
        }),
      input.userId,
    )
    const result = outcome.ok
      ? { ok: true as const, ...outcome.value }
      : { ok: false as const, code: outcome.error.code }
    expect(result).toEqual(expected.result)
    expect(forwarder.captured).toHaveLength(expected.forwardedCalls)

    const rows = await harness.sql(
      'select count(*)::int as count from product_events.events where user_id = $1',
      [input.userId],
    )
    expect(rows[0]?.count).toBe(expected.storedRowCount)
  })
})
