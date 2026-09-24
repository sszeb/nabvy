import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { requestDeletion } from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `delete`: account deletion requests, purged within 24 hours (docs/security.md:11). Each
// case calls requestDeletion() `requestTimes` times and checks the last call's outcome.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  userId: z.string(),
  requestTimes: z.number().int().min(1).max(2).default(1),
})
const Expected = z.union([
  z.strictObject({ requested: z.literal(true), purgeAfterHours: z.number() }),
  z.strictObject({ refused: z.string() }),
])

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
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('account', 'module', 'on')`,
  )
}, 60_000)
afterAll(() => db.close())

describe('delete', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    let outcome: { requested: true; purgeAfterHours: number } | { refused: string } = {
      refused: 'not-run',
    }
    for (let i = 0; i < input.requestTimes; i++) {
      outcome = await db
        .as('nabvy_app', (tx) => requestDeletion(tx, { userId: input.userId }), input.userId)
        .then(({ request }) => ({
          requested: true as const,
          purgeAfterHours:
            (new Date(request.purgeBy).getTime() - new Date(request.requestedAt).getTime()) /
            3_600_000,
        }))
        .catch((error: { code?: string }) => ({ refused: error.code ?? 'unknown' }))
    }
    if ('requested' in expected) {
      expect(outcome).toMatchObject({ requested: true })
      expect((outcome as { purgeAfterHours: number }).purgeAfterHours).toBeCloseTo(
        expected.purgeAfterHours,
        1,
      )
    } else {
      expect(outcome).toEqual({ refused: expected.refused })
    }
  })
})
