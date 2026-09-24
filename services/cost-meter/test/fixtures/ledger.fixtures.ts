import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type CostMeterContext, record, recordModelCall, settle, unitsToMicros } from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage "ledger": each case is a sequence of record, settle and model-call steps run against the
// real migrations (PGlite, as nabvy_pipeline). Amounts are given in provider dollars
// (`reservedUsd`, `settledUsd`) and turned into micros as a caller would; `$run:<path>` reads a
// field of the case's recorded run (fixtures/listings/<run>/run.json).

type Json = Record<string, unknown>
interface Step {
  op: 'record' | 'settle' | 'model'
  input: Json
}
interface Expected {
  steps: {
    ok: boolean
    code?: string
    changed?: boolean
    countedMicros?: number
    countedGbpMicros?: number
  }[]
  rows: number
}

const CASES = new URL('./cases/', import.meta.url)
const RUNS = new URL('../../../../fixtures/listings/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()

function resolve(input: Json, run: Json | undefined): Json {
  const out: Json = {}
  for (const [key, value] of Object.entries(input)) {
    let v = value
    if (typeof v === 'string' && v.startsWith('$run:')) {
      if (!run) throw new Error(`${key} reads the run, but the case names none`)
      v = v
        .slice(5)
        .split('.')
        .reduce<unknown>((node, part) => (node as Json)[part], run)
    }
    if (key === 'reservedUsd') out.reservedMicros = unitsToMicros(v as number)
    else if (key === 'settledUsd') out.settledMicros = unitsToMicros(v as number)
    else out[key] = v
  }
  return out
}

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('ledger', () => {
  it.each(cases)('%s', async (id) => {
    const input = read(new URL(`${id}/input.json`, CASES)) as {
      run?: string
      usdGbpRate: number
      steps: Step[]
    }
    const expected = read(new URL(`${id}/expected.json`, CASES)) as Expected
    const run = input.run ? (read(new URL(`${input.run}/run.json`, RUNS)) as Json) : undefined
    const ctx: CostMeterContext = { state: 'on', usdGbpRate: input.usdGbpRate }

    const outcomes = []
    for (const step of input.steps) {
      const args = resolve(step.input, run)
      const result =
        step.op === 'record'
          ? await record(t.db, args as never, ctx)
          : step.op === 'settle'
            ? await settle(t.db, args as never, ctx)
            : await recordModelCall(t.db, args as never, ctx)
      const refId = String(args.refId)
      const counted = (
        await t.asPipeline('select * from cost_meter.v_costs where ref_id = $1', [refId])
      )[0]
      outcomes.push({
        ok: result.ok,
        ...(result.ok ? { changed: result.value.changed } : { code: result.error.code }),
        ...(counted
          ? {
              countedMicros: Number(counted.settled_micros ?? counted.reserved_micros),
              countedGbpMicros: Number(counted.counted_gbp_micros),
            }
          : {}),
      })
    }
    expect(outcomes).toEqual(expected.steps)
    expect(Number((await t.sql('select count(*) as n from cost_meter.provider_calls'))[0]?.n)).toBe(
      expected.rows,
    )
  })
})
