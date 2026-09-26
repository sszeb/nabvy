import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  captureAttribution,
  getAttribution,
  inMemoryPartnerClient,
  reverseSale,
  trackSale,
} from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000f1'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await addUsers(db, U1)
}, 60_000)
afterAll(() => db.close())

const deps = () => ({ partnerClient: inMemoryPartnerClient() })
const capture = () =>
  db.as('nabvy_pipeline', (tx) => captureAttribution(tx, { userId: U1 }, deps()))
const attribution = () =>
  db.as('nabvy_pipeline', (tx) => tx.execute('select * from attribution.v_attributions'))

describe('attribution off (no seed row: the switch reads off)', () => {
  it('refuses sign-up capture with a clear message and writes nothing', async () => {
    const result = await capture()
    expect(result).toMatchObject({ ok: false, error: { code: 'attribution.off' } })
    expect(!result.ok && result.error.message).toMatch(/paused/)
    expect(await db.sql('select * from attribution.utm_attributions')).toEqual([])
  })

  it('refuses trackSale and getAttribution too; v_attributions has no rows', async () => {
    const sale = await db.as('nabvy_pipeline', (tx) =>
      trackSale(
        tx,
        {
          userId: U1,
          invoiceId: 'in_off',
          kind: 'subscription',
          amountMinor: 900,
          currency: 'GBP',
        },
        deps(),
      ),
    )
    expect(sale).toMatchObject({ ok: false, error: { code: 'attribution.off' } })
    const read = await db.as('nabvy_pipeline', (tx) => getAttribution(tx, U1))
    expect(read).toMatchObject({ ok: false, error: { code: 'attribution.off' } })
    expect((await attribution()).rows).toEqual([])
  })
})

describe('shadow and on', () => {
  it('shadow writes and shows rows in the internal view', async () => {
    await setSwitch(db, 'attribution', 'shadow')
    const result = await capture()
    expect(result.ok).toBe(true)
    expect((await attribution()).rows).toHaveLength(1)
  })

  it('shadow refuses trackSale and reverseSale (money moves only when on) and records nothing', async () => {
    const sale = await db.as('nabvy_pipeline', (tx) =>
      trackSale(
        tx,
        {
          userId: U1,
          invoiceId: 'in_shadow',
          kind: 'subscription',
          amountMinor: 900,
          currency: 'GBP',
        },
        deps(),
      ),
    )
    expect(sale).toMatchObject({ ok: false, error: { code: 'attribution.not_on' } })
    expect(!sale.ok && sale.error.message).toMatch(/not live/)
    const reversal = await db.as('nabvy_pipeline', (tx) =>
      reverseSale(tx, { userId: U1, stripeEventId: 'evt_shadow', reason: 'chargeback' }, deps()),
    )
    expect(reversal).toMatchObject({ ok: false, error: { code: 'attribution.not_on' } })
    expect(await db.sql('select * from attribution.partner_events')).toEqual([])
  })

  it('on serves getAttribution as before', async () => {
    await setSwitch(db, 'attribution', 'on')
    const read = await db.as('nabvy_pipeline', (tx) => getAttribution(tx, U1))
    expect(read.ok && read.value?.userId).toBe(U1)
  })
})
