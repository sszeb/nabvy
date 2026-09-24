import { randomUUID } from 'node:crypto'
import { parseEvent } from '@nabvy/contracts'
import {
  events,
  ScanRecognitionIdentifiedEvent,
  ScanRecognitionResult,
  ScanRecognitionScan,
  ScanRecognitionUserScan,
} from '@nabvy/contracts/modules/scan-recognition'
import { vScans, vUserScans } from '@nabvy/db/schema/scan-recognition'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scan } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { ctx, photoRef, recordedClient, seed, U1 } from './support/scans'

// View row types are written by hand in Zod (no drizzle-zod in the repo yet, the same choice
// product-catalogue and cost-meter made); these tests keep them equal to the Drizzle views and
// to what the database returns.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db)
}, 60_000)
afterAll(() => db?.close())

const iso = (value: unknown) => (value === null ? null : new Date(value as string).toISOString())

describe('contracts', () => {
  it('view row schemas have exactly the Drizzle view columns', () => {
    expect(Object.keys(getViewConfig(vScans).selectedFields).sort()).toEqual(
      Object.keys(ScanRecognitionScan.shape).sort(),
    )
    expect(Object.keys(getViewConfig(vUserScans).selectedFields).sort()).toEqual(
      Object.keys(ScanRecognitionUserScan.shape).sort(),
    )
  })

  it('the identified event carries the scan ID only, and view rows and results parse', async () => {
    const outcome = await db.as('nabvy_pipeline', (q) =>
      scan(
        q,
        {
          scanId: randomUUID(),
          userId: U1,
          photo: { ref: photoRef(U1, 'gpu-confident'), mediaType: 'image/png', bytes: 5 },
        },
        { vision: recordedClient() },
        ctx(),
      ),
    )
    if (!outcome.ok) throw new Error(outcome.error.message)
    ScanRecognitionResult.parse(outcome.value.result)
    const event = parseEvent(events, JSON.parse(JSON.stringify(outcome.value.event)))
    expect(ScanRecognitionIdentifiedEvent.parse(event.payload)).toEqual({
      scanId: outcome.value.result.scanId,
    })

    const internal = await db.as('nabvy_pipeline', (q) => q.select().from(vScans))
    for (const row of internal) {
      ScanRecognitionScan.parse({ ...row, at: iso(row.at), identifiedAt: iso(row.identifiedAt) })
    }
    const own = await db.as('nabvy_app', (q) => q.select().from(vUserScans), U1)
    expect(own.length).toBeGreaterThan(0)
    for (const row of own) ScanRecognitionUserScan.parse({ ...row, at: iso(row.at) })
  })
})
