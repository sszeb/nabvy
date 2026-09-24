import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { onAccountDeleted, scan } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { ctx, EAN_3080TI, photoRef, recordedClient, seed, U1 } from './support/scans'

// The idempotency key of a scan is its client-generated scan ID (rule 8 of docs/design/modules/
// _rules.md for events about requests): a replay writes nothing, calls no model and returns the
// same event key, so a resubmitted form is never charged twice.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db)
}, 60_000)
afterAll(() => db?.close())

const count = async (sql: string, params: unknown[]) =>
  ((await db.sql(sql, params)) as [{ n: number }])[0].n

describe('idempotency', () => {
  it('a replayed photo scan makes no second model call and no second meter row', async () => {
    const vision = recordedClient()
    const input = {
      scanId: randomUUID(),
      userId: U1,
      photo: { ref: photoRef(U1, 'gpu-confident'), mediaType: 'image/jpeg' as const, bytes: 1 },
      at: '2026-09-24T12:00:00.000Z',
    }
    const first = await db.as('nabvy_pipeline', (q) => scan(q, input, { vision }, ctx()))
    const second = await db.as('nabvy_pipeline', (q) => scan(q, input, { vision }, ctx()))
    expect(vision.calls).toHaveLength(1)
    if (!first.ok || !second.ok) throw new Error('scan failed')
    expect(first.value.changed).toBe(true)
    expect(second.value.changed).toBe(false)
    expect(second.value.result).toEqual(first.value.result)
    expect(second.value.event?.key).toBe(first.value.event?.key)
    expect(
      await count(`select count(*)::int as n from scan_recognition.scan_events where id = $1`, [
        input.scanId,
      ]),
    ).toBe(1)
    expect(
      await count(
        `select count(*)::int as n from cost_meter.provider_calls where module = 'scan-recognition'`,
        [],
      ),
    ).toBe(1)
  })

  it('a replayed barcode scan writes nothing new', async () => {
    const input = {
      scanId: randomUUID(),
      userId: U1,
      barcode: EAN_3080TI,
      at: '2026-09-24T12:00:00.000Z',
    }
    const vision = recordedClient()
    const first = await db.as('nabvy_pipeline', (q) => scan(q, input, { vision }, ctx()))
    const second = await db.as('nabvy_pipeline', (q) => scan(q, input, { vision }, ctx()))
    expect(first.ok && first.value.changed).toBe(true)
    expect(second.ok && second.value.changed).toBe(false)
    expect(vision.calls).toHaveLength(0)
  })

  it('account.deleted handled twice deletes the scans once and returns their photos once', async () => {
    const user = randomUUID()
    await db.sql(
      `insert into better_auth."user" (id, name, email) values ($1, 'Gone', 'gone@example.com')`,
      [user],
    )
    const vision = recordedClient()
    await db.as('nabvy_pipeline', (q) =>
      scan(
        q,
        { scanId: randomUUID(), userId: user, barcode: EAN_3080TI, at: '2026-09-24T12:00:00.000Z' },
        { vision },
        ctx(),
      ),
    )
    await db.sql(
      `insert into scan_recognition.scan_events (id, user_id, photo_ref, photo_media_type, method, status, at)
       values ($1, $2, $3, 'image/jpeg', 'none', 'unidentified', now())`,
      [randomUUID(), user, `scans/${user}/kept.jpg`],
    )
    const batch = [{ userId: user }, { userId: user }]
    const first = await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, batch))
    const second = await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, batch))
    expect(first.photoRefs).toEqual([`scans/${user}/kept.jpg`])
    expect(second.photoRefs).toEqual([])
    expect(
      await count(
        `select count(*)::int as n from scan_recognition.scan_events where user_id = $1`,
        [user],
      ),
    ).toBe(0)
    expect(
      await count(
        `select count(*)::int as n from scan_recognition.scan_events where user_id = $1`,
        [U1],
      ),
    ).toBeGreaterThan(0)
  })
})
