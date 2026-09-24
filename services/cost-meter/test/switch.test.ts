import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readCosts, record, recordModelCall, settle } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'
import { apifyReservation, apifySettlement, haikuCall, OFF, ON, SHADOW } from './support/inputs'

// Rule 11: off writes nothing and shows nothing. The cost meter fails closed: `record` answers
// `cost-meter.off`, so a paying module pauses instead of spending unmetered. No module reads the
// ledger yet (spend-governor and ops-metrics come later), so no reader's fixtures run here.

let t: TestDatabase
beforeAll(async () => {
  t = await createTestDatabase()
})
afterAll(async () => {
  await t.close()
})

const since = new Date('2026-01-01T00:00:00Z')

describe('switch', () => {
  it('off: refuses every write, writes nothing and reads nothing', async () => {
    for (const result of [
      await record(t.db, apifyReservation(), OFF),
      await recordModelCall(t.db, haikuCall(), OFF),
      await settle(t.db, apifySettlement(), OFF),
    ]) {
      expect(result.ok || result.error.code).toBe('cost-meter.off')
    }
    expect(await t.sql('select * from cost_meter.provider_calls')).toEqual([])
    await record(t.db, apifyReservation(), ON)
    expect(await readCosts(t.db, { since }, OFF)).toEqual([])
  })

  it('shadow: runs and writes, and internal reads show rows (the meter has no user-facing view)', async () => {
    const written = await settle(t.db, apifySettlement(), SHADOW)
    expect(written.ok && written.value.changed).toBe(true)
    const rows = await readCosts(t.db, { since }, SHADOW)
    expect(rows.map((row) => row.countedGbpMicros)).toEqual([13_275])
  })

  it('on: reads filter by module', async () => {
    await recordModelCall(t.db, haikuCall(), ON)
    expect(
      (await readCosts(t.db, { since, module: 'listing-assessment' }, ON)).map((row) => row.kind),
    ).toEqual(['model_call'])
    expect(await readCosts(t.db, { since: new Date('2027-01-01T00:00:00Z') }, ON)).toEqual([])
  })
})
