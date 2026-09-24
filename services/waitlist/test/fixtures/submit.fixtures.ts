import { readdirSync, readFileSync } from 'node:fs'
import { entries } from '@nabvy/db/schema/waitlist'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { submit } from '../../src/index'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `submit`: each case is a sequence of submit() calls against the real migrations (PGlite).
// Expected: the total rows the calls' emails now occupy, and each call's outcome. All cases are
// synthetic (docs/design/modules/_rules.md, rule 16): the form's input is never a recorded
// marketplace run.

const Call = z.strictObject({
  ip: z.string().min(1),
  state: z.enum(['off', 'shadow', 'on']),
  input: z.record(z.string(), z.unknown()),
})
const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  calls: z.array(Call).min(1),
})
const Result = z.union([
  z.strictObject({
    ok: z.literal(true),
    created: z.boolean(),
    email: z.string(),
    postcode: z.string().nullable(),
    wantedProducts: z.array(z.string()),
    utm: z.record(z.string(), z.string()),
  }),
  z.strictObject({ ok: z.literal(false), code: z.string() }),
])
const Expected = z.strictObject({ rows: z.number().int().min(0), results: z.array(Result) })

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

type CallResult = z.infer<typeof Result>

describe('submit', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const results: CallResult[] = []
    for (const call of input.calls) {
      const outcome = await harness.as('nabvy_app', (db) =>
        submit(db, call.input, { state: call.state, ip: call.ip }),
      )
      results.push(
        outcome.ok
          ? {
              ok: true,
              created: outcome.value.created,
              email: outcome.value.entry.email,
              postcode: outcome.value.entry.postcode,
              wantedProducts: outcome.value.entry.wantedProducts,
              utm: outcome.value.entry.utm,
            }
          : { ok: false, code: outcome.error.code },
      )
    }
    expect(results).toEqual(expected.results)

    const emails = new Set<string>()
    for (const r of results) if (r.ok) emails.add(r.email)
    let rows = 0
    for (const email of emails) {
      const found = await harness.as('postgres', (db) =>
        db.select().from(entries).where(eq(entries.email, email)),
      )
      rows += found.length
    }
    expect(rows).toBe(expected.rows)
  })
})
