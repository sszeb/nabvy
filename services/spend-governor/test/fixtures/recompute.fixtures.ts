import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recompute } from '../../src'
import {
  ALL_ON,
  createTestDatabase,
  type SeedCall,
  type SeedJob,
  seed,
  type TestDatabase,
} from '../support/database'

// Stage "recompute": each case seeds cost-meter's ledger and the gateway's jobs as those modules
// write them, runs one recompute through the real migrations (PGlite, as nabvy_pipeline), reads
// v_budgets and v_throttle, then recomputes again at the same time, which must write nothing.

interface Input {
  now: string
  usdGbpRate: number
  calls: SeedCall[]
  jobs: SeedJob[]
}
interface Expected {
  first: { written: string[]; eventKeys: string[] }
  committed: Record<string, number | null>
  throttle: { budget: string; level: string; reason: string }[]
}

const CASES = new URL('./cases/recompute/', import.meta.url)
const read = <T>(url: URL) => JSON.parse(readFileSync(url, 'utf8')) as T
const cases = readdirSync(CASES).sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('recompute', () => {
  it.each(cases)('%s', async (id) => {
    const input = read<Input>(new URL(`${id}/input.json`, CASES))
    const expected = read<Expected>(new URL(`${id}/expected.json`, CASES))
    await seed(t, { calls: input.calls, jobs: input.jobs, rate: input.usdGbpRate })
    const args = { now: input.now, usdGbpRate: input.usdGbpRate }

    const first = await recompute(t.db, args)
    if (!first.ok) throw new Error(first.error.message)
    // v_throttle compares valid_until with now(): the case's `now` is in the past, so read it as
    // of the case's time by checking the stored rows' validity window instead.
    await t.sql(`update spend_governor.throttle set valid_until = now() + interval '1 hour'`)
    const committed = Object.fromEntries(
      (await t.asPipeline('select name, committed_micros from spend_governor.v_budgets')).map(
        (r) => [r.name, r.committed_micros === null ? null : Number(r.committed_micros)],
      ),
    )
    const throttle = await t.asPipeline(
      'select budget, level, reason from spend_governor.v_throttle order by budget',
    )
    const second = await recompute(t.db, args)
    if (!second.ok) throw new Error(second.error.message)

    expect({
      first: { written: first.value.written, eventKeys: first.value.events.map((e) => e.key) },
      committed,
      throttle,
    }).toEqual(expected)
    expect(second.value).toEqual({ written: [], events: [] })
  })
})
