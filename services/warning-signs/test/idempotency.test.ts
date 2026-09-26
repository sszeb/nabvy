import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { erase, evaluate, evaluateGroups } from '../src'
import {
  createTestDatabase,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from './support/database'

// A replay writes nothing and publishes the same key; a new input writes a new evaluation; an
// evaluation that finds nothing clears the shown facts; inputs returning to an earlier state
// reuse the earlier evaluation; index updates re-evaluate the group's listings; batches over 500
// are refused; erasure removes everything.

const A = '00000000-0000-4000-8006-000000000001'
const B = '00000000-0000-4000-8006-000000000002'
const counts = async (t: TestDatabase) => {
  const [e] = await t.sql('select count(*)::int as n from warning_signs.evaluations')
  const [f] = await t.sql('select count(*)::int as n from warning_signs.facts')
  return { evaluations: e?.n, facts: f?.n }
}
const codes = async (t: TestDatabase, id: string) =>
  (
    await t.sqlAs(
      'nabvy_pipeline',
      'select code from warning_signs.v_facts where listing_id = $1 order by 1',
      [id],
    )
  ).map((r) => r.code)

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await switchOn(t, UPSTREAM)
  await setSwitch(t, 'on')
})
afterEach(async () => {
  await t.close()
})

const run = (listingIds: string[], now = new Date('2026-09-26T10:00:00Z')) =>
  t.as('nabvy_pipeline', (q) => evaluate(q, { listingIds, now }))

describe('idempotency', () => {
  it('a replay writes nothing and yields the same event key', async () => {
    await seed(t, [
      { id: A, description: 'Sold as seen, collection from Chichester only please.', cautions: [] },
      { id: B, description: 'Great card, collection from Chichester only please.', cautions: [] },
    ])
    const first = await run([A, B])
    const before = await counts(t)
    const second = await run([B, A, A], new Date('2026-09-26T11:00:00Z'))
    expect(await counts(t)).toEqual(before)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.value.written).toBe(0)
    expect(second.value.current).toBe(2)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    const [row] = await t.sql('select min(found_at) as at from warning_signs.facts')
    expect((row?.at as Date | undefined)?.toISOString()).toBe('2026-09-26T10:00:00.000Z')
  })

  it('a new version writes a new evaluation; nothing found clears the facts; a return reuses', async () => {
    await seed(t, [
      { id: A, description: 'Sold as seen, collection from Chichester only please.', cautions: [] },
    ])
    const first = await run([A])
    expect(await codes(t, A)).toEqual(['untested_text'])
    await seed(t, [
      {
        id: A,
        version: 1,
        description: 'Tested and working, collection from Chichester.',
        cautions: [],
      },
    ])
    const second = await run([A], new Date('2026-09-26T11:00:00Z'))
    expect(await codes(t, A)).toEqual([])
    expect(second.ok && second.value.written).toBe(1)
    expect(second.ok && first.ok && second.value.events[0]?.key).not.toBe(
      first.ok && first.value.events[0]?.key,
    )
    await seed(t, [
      {
        id: A,
        version: 0,
        card: 0,
        description: 'Sold as seen, collection from Chichester only please.',
        cautions: [],
      },
    ])
    await t.sql(
      `update detail_evidence.fetches set fetched_at = now() + interval '1 hour'
       where listing_id = $1 and job_id = 1`,
      [A],
    )
    const third = await run([A], new Date('2026-09-26T12:00:00Z'))
    expect(third.ok && third.value.written).toBe(0)
    expect(await counts(t)).toEqual({ evaluations: 2, facts: 1 })
    expect(await codes(t, A)).toEqual(['untested_text'])
  })

  it('an index update re-evaluates the group listings', async () => {
    await seed(t, [
      {
        id: A,
        description: 'Great card, collection from Chichester only please.',
        cautions: [],
        priceMinor: 30000,
        groups: [{ key: 'g-idem', median: 40000, n: 12 }],
      },
    ])
    await run([A])
    expect(await codes(t, A)).toEqual([])
    await t.sql(
      `update asking_price_index.stats set median = 60000, as_of = as_of + interval '1 hour'`,
    )
    const r = await t.as('nabvy_pipeline', (q) =>
      evaluateGroups(q, { groupKeys: ['g-idem'], now: new Date() }),
    )
    expect(r.ok && r.value.found).toEqual([A])
    expect(await codes(t, A)).toEqual(['ask_far_below_similar'])
  })

  it('refuses a batch over 500 and erases every row of a listing', async () => {
    const many = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-4000-8006-${(i + 100).toString(16).padStart(12, '0')}`,
    )
    const r = await run(many)
    expect(!r.ok && r.error.code).toBe('warning-signs.too_many_listings')
    await seed(t, [
      { id: A, description: 'Sold as seen, collection from Chichester only please.', cautions: [] },
    ])
    await run([A])
    const removed = await t.as('nabvy_pipeline', (q) => erase(q, [A]))
    expect(removed).toBe(1)
    expect(await counts(t)).toEqual({ evaluations: 0, facts: 0 })
  })
})
