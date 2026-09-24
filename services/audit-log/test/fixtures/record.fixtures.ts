import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { record } from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `record`: each case is one record() call against the real migrations (PGlite), as the
// role it names. Expected: exactly one row with the given columns, or no row and the refusal code.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  role: z.enum(['nabvy_app', 'nabvy_pipeline']),
  sessionUserId: z.string().optional(),
  entry: z.record(z.string(), z.unknown()),
})
const Expected = z.union([
  z.strictObject({ rows: z.literal(1), row: z.record(z.string(), z.unknown()) }),
  z.strictObject({ rows: z.literal(0), refused: z.string() }),
])

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

describe('record', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const countRows = async () =>
      Number((await db.sql('select count(*) as n from audit_log.entries'))[0]?.n)
    const before = await countRows()
    const outcome = await db
      .as(input.role, (tx) => record(tx, input.entry as never), input.sessionUserId)
      .then(
        ({ id }) => ({ id }),
        (error: { code?: string }) => ({ refused: error.code }),
      )
    expect(await countRows()).toBe(before + expected.rows)
    if (expected.rows === 1) {
      expect(outcome).toHaveProperty('id')
      const [row] = await db.sql('select * from audit_log.entries where id = $1', [
        (outcome as { id: string }).id,
      ])
      expect(row).toMatchObject(expected.row)
    } else {
      expect(outcome).toEqual({ refused: expected.refused })
    }
  })
})
