import { AttributionRecord, events } from '@nabvy/contracts/modules/attribution'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureAttribution, inMemoryPartnerClient } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000d1'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'attribution', 'on')
  await addUsers(db, U1)
}, 60_000)
afterAll(() => db.close())

describe('contracts', () => {
  it('declares its module name and publishes no events (card: "Outputs")', () => {
    expect(events.module).toBe('attribution')
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it('the captured record parses as AttributionRecord (rule 3: the view row, never typed twice)', async () => {
    const result = await db.as('nabvy_pipeline', (tx) =>
      captureAttribution(
        tx,
        { userId: U1, utmSource: 'yt', affiliateClickId: 'click_c1' },
        { partnerClient: inMemoryPartnerClient() },
      ),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      AttributionRecord.parse(result.value)
      expect(result.value.affiliatePartnerId).toBe('partner_click_c1')
    }
  })
})
