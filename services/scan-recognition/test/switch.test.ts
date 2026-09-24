import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { confirm, scan } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import {
  ALL_ON,
  ctx,
  EAN_3080TI,
  photoRef,
  recordedClient,
  seed,
  setSwitches,
  U1,
} from './support/scans'

// Rule 11 of docs/design/modules/_rules.md. Off: scan mode is unavailable, nothing is written and
// both views are empty. Shadow: scans run and write, v_scans has rows, v_user_scans has none.
// Paid work fails closed when cost-meter or the model provider is off. No module reads this
// module yet, so there is no reader's fixture suite to run with it off (README.md).

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db)
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const photoScan = () => ({
  scanId: randomUUID(),
  userId: U1,
  photo: { ref: photoRef(U1, 'gpu-confident'), mediaType: 'image/jpeg' as const, bytes: 1 },
})
const scans = async () =>
  (
    (await db.sql(`select count(*)::int as n from scan_recognition.scan_events`)) as [{ n: number }]
  )[0].n
const internal = () =>
  db.as('nabvy_pipeline', (q) => q.execute('select * from scan_recognition.v_scans'))
const userFacing = () =>
  db.as('nabvy_app', (q) => q.execute('select * from scan_recognition.v_user_scans'), U1)
const rows = (result: unknown) => (result as { rows: unknown[] }).rows

describe('switch', () => {
  it('off: refuses scans and confirmations, writes nothing, and both views are empty', async () => {
    const { scanId } = photoScan()
    await db.as('nabvy_pipeline', (q) =>
      scan(q, { scanId, userId: U1, barcode: EAN_3080TI }, { vision: recordedClient() }, ctx()),
    )
    await setSwitches(db, { 'scan-recognition': 'off' })
    const before = await scans()
    const vision = recordedClient()
    const refused = await db.as('nabvy_pipeline', (q) => scan(q, photoScan(), { vision }, ctx()))
    expect(refused.ok ? 'ok' : refused.error.code).toBe('scan-recognition.off')
    expect(vision.calls).toHaveLength(0)
    expect(await scans()).toBe(before)
    const confirmRefused = await db.as(
      'nabvy_app',
      (q) => confirm(q, { scanId, userId: U1, catalogueId: 'gpu:nvidia:rtx-3080-ti:12gb' }),
      U1,
    )
    expect(confirmRefused.ok ? 'ok' : confirmRefused.error.code).toBe('scan-recognition.off')
    expect(rows(await internal())).toHaveLength(0)
    expect(rows(await userFacing())).toHaveLength(0)
  })

  it('shadow: runs and writes, internal rows only', async () => {
    await setSwitches(db, { 'scan-recognition': 'shadow' })
    const outcome = await db.as('nabvy_pipeline', (q) =>
      scan(q, photoScan(), { vision: recordedClient() }, ctx()),
    )
    expect(outcome.ok).toBe(true)
    expect(rows(await internal()).length).toBeGreaterThan(0)
    expect(rows(await userFacing())).toHaveLength(0)
  })

  it('shadow: confirm is refused, as the user cannot see the scan', async () => {
    const outcome = await db.as('nabvy_pipeline', (q) =>
      scan(
        q,
        {
          ...photoScan(),
          photo: { ref: photoRef(U1, 'gpu-unsure'), mediaType: 'image/jpeg' as const, bytes: 1 },
        },
        { vision: recordedClient() },
        ctx(),
      ),
    )
    if (!outcome.ok) throw new Error(outcome.error.message)
    await setSwitches(db, { 'scan-recognition': 'shadow' })
    const refused = await db.as(
      'nabvy_app',
      (q) =>
        confirm(q, {
          scanId: outcome.value.result.scanId,
          userId: U1,
          catalogueId: 'gpu:nvidia:rtx-3080-ti:12gb',
        }),
      U1,
    )
    expect(refused.ok ? 'ok' : refused.error.code).toBe('scan-recognition.off')
  })

  it('on: the user sees their own scans', async () => {
    expect(rows(await userFacing()).length).toBeGreaterThan(0)
  })

  it.each(['cost-meter', 'anthropic'])(
    '%s off: a photo scan pauses before the call; a barcode still works',
    async (name) => {
      await setSwitches(db, { [name]: 'off' })
      const vision = recordedClient()
      const paused = await db.as('nabvy_pipeline', (q) => scan(q, photoScan(), { vision }, ctx()))
      expect(paused.ok ? 'ok' : paused.error.code).toBe('scan-recognition.paid_work_paused')
      expect(vision.calls).toHaveLength(0)
      const byBarcode = await db.as('nabvy_pipeline', (q) =>
        scan(q, { scanId: randomUUID(), userId: U1, barcode: EAN_3080TI }, { vision }, ctx()),
      )
      expect(byBarcode.ok && byBarcode.value.result.status).toBe('identified')
    },
  )

  it('product-catalogue off: candidates resolve to nothing, so the scan is unidentified', async () => {
    await setSwitches(db, { 'product-catalogue': 'off' })
    const outcome = await db.as('nabvy_pipeline', (q) =>
      scan(q, photoScan(), { vision: recordedClient() }, ctx()),
    )
    expect(outcome.ok && outcome.value.result.status).toBe('unidentified')
  })
})
