import { CostMeterCall, events } from '@nabvy/contracts/modules/cost-meter'
import { vCosts } from '@nabvy/db/schema/cost-meter'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readCosts, record, recordModelCall } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'
import { apifyReservation, haikuCall, ON } from './support/inputs'

let t: TestDatabase
beforeAll(async () => {
  t = await createTestDatabase()
  await record(t.db, apifyReservation(), ON)
  await recordModelCall(t.db, haikuCall(), ON)
})
afterAll(async () => {
  await t.close()
})

const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

describe('contracts', () => {
  it('publishes no events', () => {
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it('declares v_costs with exactly the CostMeterCall fields', () => {
    const columns = Object.keys(getViewConfig(vCosts).selectedFields)
    expect(columns.sort()).toEqual(Object.keys(CostMeterCall.shape).sort())
  })

  it('returns v_costs rows that parse as CostMeterCall and match readCosts', async () => {
    const rows = await t.asPipeline('select * from cost_meter.v_costs order by at, id')
    const fromView = rows.map((row) =>
      CostMeterCall.parse(
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            camel(key),
            value instanceof Date
              ? value.toISOString()
              : typeof value === 'string' && /micros$/.test(key)
                ? Number(value)
                : value,
          ]),
        ),
      ),
    )
    expect(fromView).toEqual(await readCosts(t.db, { since: new Date(0) }, ON))
    expect(fromView.map((row) => row.countedGbpMicros)).toEqual([252_225, 2_175])
  })
})
