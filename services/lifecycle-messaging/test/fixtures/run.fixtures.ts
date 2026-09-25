import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { setPreference } from '@nabvy/marketing-consent'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { InMemoryEmailResolver, run } from '../../src'
import { createTestDatabase } from '../support/database'

// Stage `run`: the module's core acceptance test (module card, "Tests and fixtures"): "programmes
// fire from test events; suppressed addresses skipped" (docs/backlog.md:70). Each case is its own
// fresh database (unlike services/marketing-consent's can-market.fixtures.ts, which shares one --
// run() scans every user with a matching trigger event, so a shared database would let one case's
// rows leak into the next case's counts).

const NOW = new Date('2026-09-24T12:00:00.000Z')

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  programme: z.string(),
  step: z.string(),
  moduleState: z.enum(['off', 'shadow', 'on']),
  marketingConsentState: z.enum(['off', 'shadow', 'on']),
  granted: z.boolean(),
  suppressed: z.boolean(),
  triggerEvent: z.string(),
  triggerProperties: z.record(z.string(), z.unknown()),
  triggerAgeMinutes: z.number(),
  exitEvent: z.string().nullable(),
  exitAgeMinutes: z.number().nullable(),
  priorMarketingRunToday: z.boolean(),
})
const Expected = z.strictObject({
  evaluated: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  skippedReason: z.string().nullable(),
})

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

describe('run', () => {
  it.each(cases)(
    '$id',
    async ({ input, expected }) => {
      const db = await createTestDatabase()
      try {
        const userId = randomUUID()
        const email = `${userId}@example.com`
        await db.createUser({ userId })
        await db.sql(
          `insert into switches.switches (name, kind, state) values ('lifecycle-messaging', 'module', $1)
           on conflict (name) do update set state = excluded.state`,
          [input.moduleState],
        )
        await db.sql(
          `insert into switches.switches (name, kind, state) values ('marketing-consent', 'module', $1)
           on conflict (name) do update set state = excluded.state`,
          [input.marketingConsentState],
        )
        await db.sql(
          `insert into switches.switches (name, kind, state) values ('product-events', 'module', 'on')
           on conflict (name) do update set state = excluded.state`,
        )
        if (input.granted) {
          for (const category of ['tips', 'offers'] as const) {
            await db.as(
              'nabvy_app',
              (tx) => setPreference(tx, { userId, category, granted: true, source: 'signup' }),
              userId,
            )
          }
        }
        if (input.suppressed) {
          await db.sql(
            `insert into marketing_consent.email_suppressions (email_hash, reason, source)
             values (encode(sha256(convert_to(lower($1), 'UTF8')), 'hex'), 'bounce', 'resend')`,
            [email],
          )
        }
        await db.insertEvent({
          userId,
          event: input.triggerEvent,
          properties: input.triggerProperties,
          at: new Date(NOW.getTime() - input.triggerAgeMinutes * 60_000),
        })
        if (input.exitEvent != null && input.exitAgeMinutes != null) {
          await db.insertEvent({
            userId,
            event: input.exitEvent,
            properties: {},
            at: new Date(NOW.getTime() - input.exitAgeMinutes * 60_000),
          })
        }
        if (input.priorMarketingRunToday) {
          await db.sql(
            `insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
             values ($1, 'win-back', '30d', $2, $2)`,
            [userId, new Date(NOW.getTime() - 2 * 60 * 60_000).toISOString()],
          )
        }

        const result = await db.as('nabvy_pipeline', (tx) =>
          run(tx, { now: NOW, emailResolver: new InMemoryEmailResolver({ [userId]: email }) }),
        )
        expect(result.evaluated).toBe(expected.evaluated)
        expect(result.sent).toBe(expected.sent)
        if (expected.skippedReason) {
          expect(result.skipped[expected.skippedReason]).toBeGreaterThanOrEqual(1)
        }
      } finally {
        await db.close()
      }
    },
    60_000,
  )
})
