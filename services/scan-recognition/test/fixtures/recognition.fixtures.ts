import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { scan } from '../../src/index'
import { createTestDatabase, type TestDatabase } from '../support/database'
import { ctx, photoRef, recordedClient, seed, U1 } from '../support/scans'

// Stage `recognition`: every case in cases/ runs through scan() on the real migrations
// (README.md, "Fixtures and pass rate"). All cases are synthetic until a vision key exists and
// real scans are recorded; each notes.md gives the evidence for its expected answer.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  barcode: z.string().optional(),
  photo: z.string().optional(),
  priorSpendGbpMicros: z.int().nonnegative().optional(),
})
const Expected = z.union([
  z.strictObject({
    status: z.string(),
    method: z.string(),
    identified: z.string().nullable(),
    candidates: z.array(z.string()),
    confidence: z.number().nullable(),
    modelCalled: z.boolean(),
    event: z.boolean(),
  }),
  z.strictObject({ error: z.string(), modelCalled: z.literal(false) }),
])

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir).sort()

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db)
}, 60_000)
afterAll(() => db?.close())

describe('scan-recognition recognition (fixture cases)', () => {
  it.each(cases)('%s', async (id) => {
    const input = Input.parse(read(id, 'input.json'))
    const expected = Expected.parse(read(id, 'expected.json'))
    // Each case scans as a fresh user so earlier cases' spend never reaches its cap.
    const userId = randomUUID()
    await db.sql(`insert into better_auth."user" (id, name, email) values ($1, 'Case', $2)`, [
      userId,
      `${id}@example.com`,
    ])
    if (input.priorSpendGbpMicros) {
      await db.sql(
        `insert into scan_recognition.scan_events
           (id, user_id, method, status, model_called, model_ref, output_valid, cost_gbp_micros, at)
         values ($1, $2, 'vision', 'unidentified', true, 'msg_prior', false, $3, $4)`,
        [randomUUID(), userId, input.priorSpendGbpMicros, '2026-09-24T11:00:00.000Z'],
      )
    }
    const vision = recordedClient()
    // Recorded responses are keyed under U1's folder; this case's own folder maps to the same.
    const photo = input.photo
      ? { ref: photoRef(userId, input.photo), mediaType: 'image/jpeg' as const, bytes: 250_000 }
      : undefined
    const client = {
      model: vision.model,
      calls: vision.calls,
      recognise: (request: Parameters<typeof vision.recognise>[0]) =>
        vision.recognise({
          ...request,
          photo: { ...request.photo, ref: photoRef(U1, input.photo ?? '') },
        }),
    }
    const outcome = await db.as('nabvy_pipeline', (q) =>
      scan(
        q,
        {
          scanId: randomUUID(),
          userId,
          ...(input.barcode ? { barcode: input.barcode } : {}),
          ...(photo ? { photo } : {}),
          at: '2026-09-24T12:00:00.000Z',
        },
        { vision: client },
        ctx(),
      ),
    )
    expect(vision.calls.length > 0).toBe(expected.modelCalled)
    if ('error' in expected) {
      expect(outcome.ok ? 'ok' : outcome.error.code).toBe(expected.error)
      return
    }
    if (!outcome.ok) throw new Error(outcome.error.message)
    const { result, event } = outcome.value
    expect({
      status: result.status,
      method: result.method,
      identified: result.identified,
      candidates: result.candidates,
      confidence: result.confidence,
      modelCalled: result.modelCalled,
      event: event !== undefined,
    }).toEqual(expected)
  })
})
