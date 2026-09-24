import { readdirSync, readFileSync } from 'node:fs'
import type { Queryable } from '@nabvy/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { estimate, priceFor, retirePolicy, setPolicy } from '../../src'
import {
  ADMIN,
  addCosts,
  addUsers,
  auditRows,
  createTestDatabase,
  setSwitch,
  type TestDatabase,
  USER_A,
  USER_B,
} from '../support/database'

// Stage `floor`: the card's tests (the floor refuses a price below cost plus margin; an expired
// offer no longer applies; an offer for one user is not shown to another; every change has an
// audit row) and the floor on each ladder value, as scripted synthetic cases run on the real
// migrations and the seeded initial policy. Each case gets a fresh database (policy rows are
// append-only). Admin writes run as the pipeline, prices as the web app inside withUser.
//
// In inputs, "$A" and "$B" are two users and "$now+60s" / "$now-60s" a time relative to the
// step. A `patch` changes some fields of the current value of a row.

const Kind = z.enum(['tier', 'price', 'bundle', 'offer', 'free-tier', 'setting', 'cost-basis'])
const Step = z.union([
  z.strictObject({ set: z.strictObject({ kind: Kind, key: z.string(), value: z.unknown() }) }),
  z.strictObject({
    patch: z.strictObject({
      kind: Kind,
      key: z.string(),
      fields: z.record(z.string(), z.unknown()),
    }),
  }),
  z.strictObject({
    retire: z.strictObject({ kind: z.enum(['tier', 'price', 'bundle', 'offer']), key: z.string() }),
  }),
  z.strictObject({
    price: z.strictObject({
      user: z.enum(['A', 'B']),
      item: z.string(),
      plan: z.string().optional(),
      role: z.enum(['app', 'pipeline']).default('app'),
    }),
  }),
  z.strictObject({
    estimate: z.strictObject({
      plan: z.string(),
      cadenceMinutes: z.int(),
      areaCount: z.int(),
      roundTheClock: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    costs: z.strictObject({
      provider: z.enum(['apify', 'anthropic']),
      module: z.string(),
      gbpMicros: z.int(),
      count: z.int(),
    }),
  }),
  z.strictObject({ wait: z.int().min(1).max(5000) }),
  z.strictObject({ audit: z.string() }),
])
const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  steps: z.array(Step).min(1),
})
const Outcome = z.union([
  z.strictObject({ changed: z.boolean() }),
  z.strictObject({ refused: z.string() }),
  z.strictObject({ amount: z.int(), offer: z.string().nullable(), floored: z.boolean() }),
  z.strictObject({ included: z.boolean(), creditsPerMonth: z.int() }),
  z.strictObject({ audit: z.array(z.string()) }),
])
type Outcome = z.infer<typeof Outcome>
const Expected = z.strictObject({ outcomes: z.array(Outcome) })

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

const USERS = { A: USER_A, B: USER_B }

/** Replaces "$A", "$B" and "$now±Ns" anywhere in a JSON value. */
function resolve(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value === '$A') return USER_A
    if (value === '$B') return USER_B
    const m = /^\$now([+-]\d+)s$/.exec(value)
    return m ? new Date(Date.now() + Number(m[1]) * 1000).toISOString() : value
  }
  if (Array.isArray(value)) return value.map(resolve)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]))
  }
  return value
}

async function currentValue(db: TestDatabase, kind: string, key: string) {
  const [row] = await db.sql(
    'select value from pricing_console.policy_rows where kind = $1 and key = $2 order by version desc limit 1',
    [kind, key],
  )
  return row?.value as Record<string, unknown>
}

const written = (r: Awaited<ReturnType<typeof setPolicy>>): Outcome =>
  r.ok ? { changed: r.value.changed } : { refused: r.error.code }

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await addUsers(db, ADMIN, USER_A, USER_B)
  await setSwitch(db, 'pricing-console', 'on')
  await setSwitch(db, 'cost-meter', 'on')
}, 60_000)
afterEach(() => db.close())

const admin = <T>(fn: (q: Queryable) => Promise<T>) => db.as('nabvy_pipeline', fn)

describe('floor', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const outcomes: Outcome[] = []
    for (const step of input.steps) {
      if ('set' in step || 'patch' in step) {
        const { kind, key } = 'set' in step ? step.set : step.patch
        const value =
          'set' in step
            ? resolve(step.set.value)
            : { ...(await currentValue(db, kind, key)), ...(resolve(step.patch.fields) as object) }
        const change = { actorUserId: ADMIN, kind, key, value, reason: `fixture ${key}` }
        outcomes.push(written(await admin((q) => setPolicy(q, change as never))))
      } else if ('retire' in step) {
        const r = await admin((q) => retirePolicy(q, { actorUserId: ADMIN, ...step.retire }))
        outcomes.push(written(r))
      } else if ('price' in step) {
        const { user, item, plan, role } = step.price
        const userId = USERS[user]
        const input = { userId, item: item as never, plan: plan ?? null }
        const r =
          role === 'app'
            ? await db.as('nabvy_app', (q) => priceFor(q, input), userId)
            : await admin((q) => priceFor(q, input))
        outcomes.push(
          r.ok
            ? { amount: r.value.amount, offer: r.value.offer, floored: r.value.floored }
            : { refused: r.error.code },
        )
      } else if ('estimate' in step) {
        const r = await db.as(
          'nabvy_app',
          (q) => estimate(q, { userId: USER_A, ...step.estimate }),
          USER_A,
        )
        outcomes.push(
          r.ok
            ? { included: r.value.included, creditsPerMonth: r.value.creditsPerMonth }
            : { refused: r.error.code },
        )
      } else if ('costs' in step) {
        const c = step.costs
        await addCosts(db, c.provider, c.module, c.gbpMicros, c.count)
      } else if ('wait' in step) {
        await new Promise((done) => setTimeout(done, step.wait))
      } else {
        outcomes.push({ audit: (await auditRows(db, step.audit)).map((r) => r.action) })
      }
    }
    expect(outcomes).toEqual(expected.outcomes)
  })
})
