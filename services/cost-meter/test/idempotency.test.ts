import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { record, recordModelCall, settle } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'
import { apifyReservation, apifySettlement, haikuCall, ON } from './support/inputs'

// The real migrations on PGlite, as nabvy_pipeline: every write is safe to repeat, keyed on
// (provider, ref_id), and the database itself refuses a second settlement.

let t: TestDatabase
beforeAll(async () => {
  t = await createTestDatabase()
})
afterAll(async () => {
  await t.close()
})

const count = async () =>
  Number((await t.sql('select count(*) as n from cost_meter.provider_calls'))[0]?.n)

describe('idempotency on (provider, ref_id)', () => {
  it('records a run once however often it is recorded', async () => {
    const first = await record(t.db, apifyReservation(), ON)
    const second = await record(t.db, apifyReservation(), ON)
    expect(first.ok && first.value.changed).toBe(true)
    expect(second.ok && second.value.changed).toBe(false)
    expect(first.ok && second.ok && second.value.call).toEqual(first.ok && first.value.call)
    expect(await count()).toBe(1)
  })

  it('refuses a replay that describes another call under the same ref', async () => {
    const other = await record(t.db, apifyReservation({ module: 'crawl-planner' }), ON)
    expect(other.ok || other.error.code).toBe('cost-meter.mismatch')
    expect(await count()).toBe(1)
  })

  it('settles once: the replay writes nothing, another amount is refused', async () => {
    const early = await settle(
      t.db,
      apifySettlement({ settledMicros: 293, readAt: '2026-09-24T01:40:44.010Z' }),
      ON,
    )
    expect(early.ok || early.error.code).toBe('cost-meter.not_final')

    const first = await settle(t.db, apifySettlement(), ON)
    expect(first.ok && first.value).toMatchObject({
      changed: true,
      call: { settledMicros: 17_700, countedGbpMicros: 13_275 },
    })
    const before = await t.sql('select updated_at from cost_meter.provider_calls')

    const replay = await settle(t.db, apifySettlement(), ON)
    expect(replay.ok && replay.value.changed).toBe(false)
    const other = await settle(t.db, apifySettlement({ settledMicros: 20_000 }), ON)
    expect(other.ok || other.error.code).toBe('cost-meter.already_settled')
    expect(await t.sql('select updated_at from cost_meter.provider_calls')).toEqual(before)
  })

  it('refuses a settlement for a call never recorded', async () => {
    const missing = await settle(t.db, apifySettlement({ refId: 'never-recorded' }), ON)
    expect(missing.ok || missing.error.code).toBe('cost-meter.not_found')
  })

  it('records a model call once', async () => {
    await recordModelCall(t.db, haikuCall(), ON)
    const again = await recordModelCall(t.db, haikuCall(), ON)
    expect(again.ok && again.value).toMatchObject({
      changed: false,
      call: { settledMicros: 2_900 },
    })
    expect(await count()).toBe(2)
  })

  it('has the database refuse a second settlement or a changed reservation', async () => {
    await expect(
      t.asPipeline(
        `update cost_meter.provider_calls set settled_micros = 1, settled_gbp_micros = 1 where ref_id = 'VkryjpwS6U2GBDh3k'`,
      ),
    ).rejects.toThrow(/already settled/)
    await expect(
      t.asPipeline(
        `update cost_meter.provider_calls set reserved_micros = 1 where ref_id = 'VkryjpwS6U2GBDh3k'`,
      ),
    ).rejects.toThrow(/never change/)
    await expect(t.asPipeline('delete from cost_meter.provider_calls')).rejects.toThrow(
      /permission denied/,
    )
  })
})
