import { readdirSync, readFileSync } from 'node:fs'
import { entries } from '@nabvy/db/schema/waitlist'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { submit } from '../../src/index'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `submit`: each case is a sequence of submit() calls against the real migrations (PGlite).
// Expected: each call's outcome (identical for a new address and a repeat one, PR #31 review — the
// module never returns the stored row) and the rows that actually exist afterwards for every email
// the calls named, read directly from the table (not through submit(), which cannot read it back).
// All cases are synthetic (docs/design/modules/_rules.md, rule 16): the form's input is never a
// recorded marketplace run.

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
  z.strictObject({ ok: z.literal(true), joined: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: z.string() }),
])
const StoredRow = z.strictObject({
  email: z.string(),
  postcode: z.string().nullable(),
  wantedProducts: z.array(z.string()),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  utmTerm: z.string().nullable(),
  utmContent: z.string().nullable(),
})
const Expected = z.strictObject({
  results: z.array(Result),
  storedRows: z.array(StoredRow),
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

const byEmail = (row: { email: string }) => row.email

describe('submit', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const results = []
    const emails = new Set<string>()
    for (const call of input.calls) {
      const email = call.input.email
      if (typeof email === 'string') emails.add(email.trim().toLowerCase())
      const outcome = await harness.as('nabvy_app', (db) =>
        submit(db, call.input, { state: call.state, ip: call.ip }),
      )
      results.push(
        outcome.ok
          ? { ok: true as const, ...outcome.value }
          : { ok: false as const, code: outcome.error.code },
      )
    }
    expect(results).toEqual(expected.results)

    const storedRows = []
    for (const email of emails) {
      const [row] = await harness.as('postgres', (db) =>
        db.select().from(entries).where(eq(entries.email, email)),
      )
      if (row) {
        storedRows.push({
          email: row.email,
          postcode: row.postcode,
          wantedProducts: row.wantedProducts ?? [],
          utmSource: row.utmSource,
          utmMedium: row.utmMedium,
          utmCampaign: row.utmCampaign,
          utmTerm: row.utmTerm,
          utmContent: row.utmContent,
        })
      }
    }
    storedRows.sort((a, b) => byEmail(a).localeCompare(byEmail(b)))
    const expectedStoredRows = [...expected.storedRows].sort((a, b) =>
      byEmail(a).localeCompare(byEmail(b)),
    )
    expect(storedRows).toEqual(expectedStoredRows)
  })
})
