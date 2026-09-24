import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { chargeUsage, grant, reverseCharge } from '../../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from '../support/database'

// Stage `ledger`: the card's tests (bucket order; refusal at zero; reversal on failure; a repeated
// grant() with the same refId writes once) as scripted, synthetic cases run on the real
// migrations. Each step runs in its own transaction: grants as the pipeline (Stripe webhook,
// monthly job), charges and reversals as the web app inside withUser. Expiry is given in hours
// from now, so a case can hold an already-expired bucket.

const GrantStep = z.strictObject({
  grant: z.strictObject({
    kind: z.enum(['allowance', 'taste', 'referral', 'topup']),
    credits: z.number().int(),
    refId: z.string(),
    cashMinor: z.number().int().optional(),
    expiresInHours: z.number().nullable().optional(),
  }),
})
const ChargeStep = z.strictObject({
  charge: z.strictObject({ action: z.string(), credits: z.number().int(), refId: z.string() }),
})
const ReverseStep = z.strictObject({ reverse: z.strictObject({ refId: z.string() }) })
const Step = z.union([GrantStep, ChargeStep, ReverseStep])

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  steps: z.array(Step).min(1),
})
const Outcome = z.union([
  z.strictObject({ changed: z.boolean() }),
  z.strictObject({
    refused: z.string(),
    balance: z.number().int().optional(),
    required: z.number().int().optional(),
  }),
])
const Expected = z.strictObject({
  outcomes: z.array(Outcome),
  /** Remaining credits per grant refId. */
  buckets: z.record(z.string(), z.number().int()),
  /** Spendable balance at the end (unexpired buckets only). */
  balance: z.number().int(),
})

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

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
}, 60_000)
afterAll(() => db.close())

describe('ledger', () => {
  it.each(
    cases.map((c, i) => ({
      ...c,
      userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    })),
  )('$id', async ({ input, expected, userId }) => {
    await addUsers(db, userId)
    const outcomes: z.infer<typeof Outcome>[] = []
    for (const step of input.steps) {
      const result =
        'grant' in step
          ? await db.as('nabvy_pipeline', (tx) =>
              grant(tx, {
                userId,
                kind: step.grant.kind,
                credits: step.grant.credits,
                refId: step.grant.refId,
                cashMinor: step.grant.cashMinor ?? 0,
                expiresAt:
                  step.grant.expiresInHours == null
                    ? null
                    : new Date(Date.now() + step.grant.expiresInHours * 3_600_000).toISOString(),
              }),
            )
          : 'charge' in step
            ? await db.as('nabvy_app', (tx) => chargeUsage(tx, { userId, ...step.charge }), userId)
            : await db.as(
                'nabvy_app',
                (tx) => reverseCharge(tx, { userId, ...step.reverse }),
                userId,
              )
      outcomes.push(
        result.ok
          ? { changed: result.value.changed }
          : (Object.fromEntries(
              Object.entries({
                refused: result.error.code,
                balance: result.error.balance,
                required: result.error.required,
              }).filter(([, v]) => v !== undefined),
            ) as z.infer<typeof Outcome>),
      )
    }
    expect(outcomes).toEqual(expected.outcomes)

    const rows = await db.sql(
      `select e.ref_id, b.remaining from usage_ledger.buckets b
         join usage_ledger.entries e on e.id = b.id where b.user_id = $1`,
      [userId],
    )
    expect(Object.fromEntries(rows.map((r) => [r.ref_id, r.remaining]))).toEqual(expected.buckets)
    const [live] = await db.sql(
      `select coalesce(sum(remaining), 0)::int as balance from usage_ledger.buckets
         where user_id = $1 and (expires_at is null or expires_at > now())`,
      [userId],
    )
    expect(live?.balance).toBe(expected.balance)
  })
})
