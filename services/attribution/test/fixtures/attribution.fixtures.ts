import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { captureAttribution, inMemoryPartnerClient, reverseSale, trackSale } from '../../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from '../support/database'

// Stage `attribution`: the card's tests (docs/design/modules/attribution.md, "Tests and
// fixtures"; docs/affiliates.md, "Tests") as scripted, synthetic, single-actor cases run on the
// real migrations: a lead is tracked once per user, a sale once per invoice, a chargeback or a
// legally required refund reverses, and a user with no click ID and no code makes no partner
// call at all. The multi-actor give-£5-get-£5 pair is covered in test/attribution.test.ts instead
// (this runner assigns one generated user per case, as usage-ledger's own fixtures do).

const CaptureStep = z.strictObject({
  capture: z.strictObject({
    affiliateClickId: z.string().nullable().optional(),
    affiliateCode: z.string().nullable().optional(),
  }),
})
const SaleStep = z.strictObject({
  sale: z.strictObject({
    invoiceId: z.string(),
    kind: z.enum(['subscription', 'topup']),
    amountMinor: z.number().int(),
  }),
})
const ReverseStep = z.strictObject({
  reverse: z.strictObject({ stripeEventId: z.string(), reason: z.enum(['chargeback', 'refund']) }),
})
const Step = z.union([CaptureStep, SaleStep, ReverseStep])

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  steps: z.array(Step).min(1),
})
const Outcome = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(true), trackedSale: z.boolean(), creditedReferral: z.boolean() }),
  z.strictObject({ ok: z.literal(true), reversed: z.boolean() }),
  z.strictObject({ refused: z.string() }),
])
const Expected = z.strictObject({
  outcomes: z.array(Outcome),
  /** Rows left in `partner_events` for this case's user. */
  partnerEventsCount: z.number().int().min(0),
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
  await setSwitch(db, 'attribution', 'on')
}, 60_000)
afterAll(() => db.close())

describe('attribution', () => {
  it.each(
    cases.map((c, i) => ({
      ...c,
      userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    })),
  )('$id', async ({ input, expected, userId }) => {
    await addUsers(db, userId)
    const deps = { partnerClient: inMemoryPartnerClient() }
    const outcomes: z.infer<typeof Outcome>[] = []
    for (const step of input.steps) {
      const result =
        'capture' in step
          ? await db.as('nabvy_pipeline', (tx) =>
              captureAttribution(tx, { userId, ...step.capture }, deps),
            )
          : 'sale' in step
            ? await db.as('nabvy_pipeline', (tx) =>
                trackSale(tx, { userId, ...step.sale, currency: 'GBP' }, deps),
              )
            : await db.as('nabvy_pipeline', (tx) =>
                reverseSale(tx, { userId, ...step.reverse }, deps),
              )
      outcomes.push(
        result.ok
          ? 'trackedSale' in result.value || 'reversed' in result.value
            ? { ok: true, ...result.value }
            : { ok: true }
          : { refused: result.error.code },
      )
    }
    expect(outcomes).toEqual(expected.outcomes)
    const [row] = await db.sql(
      `select count(*)::int as n from attribution.partner_events where user_id = $1`,
      [userId],
    )
    expect(row?.n).toBe(expected.partnerEventsCount)
  })
})
