import { describe, expect, it } from 'vitest'
import {
  APIFY_SETTLE_DELAY_MS,
  MODEL_PRICES_NANO_USD,
  modelCostMicros,
  toGbpMicros,
  unitsToMicros,
} from '../src'
import { type LedgerRow, planModelCall, planRecord, planSettlement, toCall } from '../src/domain'
import { apifyReservation, apifySettlement, haikuCall, ON } from './support/inputs'

const asRow = (planned: ReturnType<typeof planRecord>): LedgerRow => ({
  id: '0192f3a0-0000-7000-8000-000000000001',
  createdAt: planned.at as Date,
  updatedAt: planned.at as Date,
  settledMicros: null,
  settledGbpMicros: null,
  settledAt: null,
  latencyMs: null,
  ...planned,
})

describe('amounts', () => {
  it('turns provider dollars into micros, rounding up without float noise', () => {
    expect(unitsToMicros(0.0177)).toBe(17_700)
    expect(unitsToMicros(0.3363)).toBe(336_300)
    // The recorded run's reading at finish: $0.00029257… rounds up to 293 micros.
    expect(unitsToMicros(0.0002925739708973302)).toBe(293)
    expect(unitsToMicros(0)).toBe(0)
    expect(() => unitsToMicros(-0.01)).toThrow(RangeError)
    expect(() => unitsToMicros(Number.NaN)).toThrow(RangeError)
  })

  it('converts USD to GBP with the rate, rounding up; GBP stays as it is', () => {
    expect(toGbpMicros(17_700, 'USD', 0.75)).toBe(13_275)
    expect(toGbpMicros(17_700, 'USD', 0.79)).toBe(13_983) // not 13 984 from float noise
    expect(toGbpMicros(1, 'USD', 0.75)).toBe(1) // 0.75 rounds up
    expect(toGbpMicros(17_700, 'GBP', 0.75)).toBe(17_700)
    expect(() => toGbpMicros(1, 'USD', 0)).toThrow(RangeError)
  })

  it('prices a model call from the table, rounding up', () => {
    const haiku = MODEL_PRICES_NANO_USD['claude-haiku-4-5-20251001']
    if (!haiku) throw new Error('Haiku 4.5 must be priced')
    // 1200 × $1 + 300 × $5 + 2000 × $0.10 per million = $0.0029.
    expect(modelCostMicros(haikuCall().usage, haiku)).toBe(2_900)
    const one = {
      model: 'x',
      inputTokens: 1,
      outputTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 1,
    }
    expect(modelCostMicros(one, haiku)).toBe(2) // 1.1 micros rounds up
    expect(haiku.cacheWrite5m).toBe(haiku.input * 1.25)
    expect(haiku.cacheWrite1h).toBe(haiku.input * 2)
    expect(haiku.cacheRead).toBe(haiku.input / 10)
  })
})

describe('record', () => {
  it('holds a paid call as a reservation', () => {
    const row = planRecord(apifyReservation(), ON)
    expect(row).toMatchObject({
      kind: 'actor_run',
      reservedMicros: 336_300,
      reservedGbpMicros: 252_225,
      usdGbpRate: '0.750000',
      settledMicros: null,
      settledAt: null,
    })
  })

  it('settles a free eBay or CeX call at zero straight away', () => {
    const row = planRecord(
      apifyReservation({
        provider: 'cex',
        refId: 'cex-1',
        reservedMicros: 0,
        currency: 'GBP',
        status: 'succeeded',
      }),
      ON,
    )
    expect(row).toMatchObject({
      kind: 'api_call',
      settledMicros: 0,
      settledGbpMicros: 0,
      usdGbpRate: '1.000000',
    })
    expect(row.settledAt).toEqual(new Date('2026-09-24T01:40:18.718Z'))
  })

  it('records a model call settled at its token cost, and refuses an unpriced model', () => {
    const planned = planModelCall(haikuCall(), ON)
    expect(planned.ok && planned.value).toMatchObject({
      kind: 'model_call',
      reservedMicros: 2_900,
      settledMicros: 2_900,
      settledGbpMicros: 2_175,
    })
    const unknown = planModelCall(
      haikuCall({ usage: { ...haikuCall().usage, model: 'claude-unknown' } }),
      ON,
    )
    expect(unknown.ok || unknown.error.code).toBe('cost-meter.unknown_model')
  })
})

describe('settle', () => {
  const reserved = asRow(planRecord(apifyReservation(), ON))
  const finished = Date.parse(apifySettlement().finishedAt as string)
  const readAfter = (ms: number) => new Date(finished + ms).toISOString()

  it('refuses an Apify reading taken before the settle delay, and accepts one at it', () => {
    const early = planSettlement(
      reserved,
      apifySettlement({ readAt: readAfter(APIFY_SETTLE_DELAY_MS - 1) }),
      ON,
    )
    expect(early.ok || early.error.code).toBe('cost-meter.not_final')
    const onTime = planSettlement(
      reserved,
      apifySettlement({ readAt: readAfter(APIFY_SETTLE_DELAY_MS) }),
      ON,
    )
    expect(onTime.ok && onTime.value).toMatchObject({
      settledMicros: 17_700,
      settledGbpMicros: 13_275,
    })
    const noFinish = planSettlement(reserved, apifySettlement({ finishedAt: undefined }), ON)
    expect(noFinish.ok || noFinish.error.code).toBe('cost-meter.not_final')
  })

  it('replaces the reservation once: a replay changes nothing, another amount is refused', () => {
    const settled = {
      ...reserved,
      settledMicros: 17_700,
      settledGbpMicros: 13_275,
      settledAt: new Date(),
    }
    const replay = planSettlement(settled, apifySettlement(), ON)
    expect(replay).toEqual({ ok: true, value: null })
    const other = planSettlement(settled, apifySettlement({ settledMicros: 293 }), ON)
    expect(other.ok || other.error.code).toBe('cost-meter.already_settled')
    expect(toCall(settled).countedGbpMicros).toBe(13_275)
    expect(toCall(reserved).countedGbpMicros).toBe(252_225)
  })

  it('refuses a settlement in another currency', () => {
    const wrong = planSettlement(reserved, apifySettlement({ currency: 'GBP' }), ON)
    expect(wrong.ok || wrong.error.code).toBe('cost-meter.mismatch')
  })
})
