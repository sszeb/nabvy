import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { gateAllows, set, state } from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `set`: each case is a sequence of admin changes run through set() as the pipeline against
// the real migrations (PGlite). Expected: each switch's final state read through state(), the
// number of audit rows per switch, the refusal codes in order, and any gate checks. Cases share
// one database, so each case changes switches no other case touches.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  changes: z.array(z.record(z.string(), z.unknown())),
  gateChecks: z.array(z.strictObject({ gate: z.string(), userId: z.string() })).optional(),
})
const Expected = z.strictObject({
  states: z.record(z.string(), z.string()),
  audits: z.record(z.string(), z.number()),
  refused: z.array(z.string()),
  gates: z.array(z.boolean()).optional(),
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

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000) // PGlite startup plus migrations is slow on a loaded runner
afterAll(() => db.close())

describe('set', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const refused: string[] = []
    for (const change of input.changes) {
      await db
        .as('nabvy_pipeline', (tx) => set(tx, change as never))
        .catch((error: { code?: string }) => refused.push(String(error.code)))
    }
    expect(refused).toEqual(expected.refused)
    for (const [name, value] of Object.entries(expected.states)) {
      expect(await db.as('nabvy_app', (tx) => state(tx, name)), name).toBe(value)
    }
    for (const [name, n] of Object.entries(expected.audits)) {
      const [row] = await db.sql(
        'select count(*)::int as n from audit_log.entries where target = $1',
        [`switch:${name}`],
      )
      expect(row?.n, name).toBe(n)
    }
    if (expected.gates) {
      const results: boolean[] = []
      for (const check of input.gateChecks ?? []) {
        results.push(await db.as('nabvy_app', (tx) => gateAllows(tx, check.gate, check.userId)))
      }
      expect(results).toEqual(expected.gates)
    }
  })
})
