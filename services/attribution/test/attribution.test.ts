import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureAttribution, getAttribution, inMemoryPartnerClient, trackSale } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

const STRANGER = '00000000-0000-4000-8000-0000000000a3'
const BANNED = '00000000-0000-4000-8000-0000000000a4'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'attribution', 'on')
  await addUsers(db, STRANGER, BANNED)
  await db.sql(`update better_auth."user" set banned = true where id = $1`, [BANNED])
}, 60_000)
afterAll(() => db.close())

const deps = () => ({ partnerClient: inMemoryPartnerClient() })
const capture = (userId: string, input: Record<string, unknown> = {}) =>
  db.as('nabvy_pipeline', (tx) => captureAttribution(tx, { userId, ...input }, deps()))

const creditsOf = async (userId: string): Promise<number> => {
  const [row] = await db.sql(
    `select coalesce(sum(remaining), 0)::int as credits from usage_ledger.buckets where user_id = $1`,
    [userId],
  )
  return Number(row?.credits ?? 0)
}

describe('sign-up capture', () => {
  it('issues a shareable referral code even with no marketing parameters', async () => {
    const result = await capture(STRANGER)
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.referralCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(result.ok && result.value.referredBy).toBeNull()
  })

  it('drops an unknown referral code rather than failing sign-up', async () => {
    const result = await capture('00000000-0000-4000-8000-0000000000a5', {
      referralCode: 'ZZZZZZZZ',
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.referredBy).toBeNull()
  })

  it('pairs a peer referral code with its owner', async () => {
    const referrer = await capture('00000000-0000-4000-8000-0000000000a6')
    const code = referrer.ok ? referrer.value.referralCode : ''
    await addUsers(db, '00000000-0000-4000-8000-0000000000a7')
    const referred = await capture('00000000-0000-4000-8000-0000000000a7', { referralCode: code })
    expect(referred.ok && referred.value.referredBy).toBe('00000000-0000-4000-8000-0000000000a6')
  })

  it('is idempotent per user: a repeat with the same details changes nothing', async () => {
    const first = await capture('00000000-0000-4000-8000-0000000000a8', { utmSource: 'yt' })
    const second = await capture('00000000-0000-4000-8000-0000000000a8', { utmSource: 'yt' })
    expect(first.ok && second.ok && first.value.referralCode).toBe(
      second.ok && second.value.referralCode,
    )
  })
})

describe('give-£5-get-£5', () => {
  it("credits both sides once, on the referred user's first paid subscription invoice", async () => {
    const r1 = '00000000-0000-4000-8000-0000000000b1'
    const r2 = '00000000-0000-4000-8000-0000000000b2'
    await addUsers(db, r1, r2)
    const owner = await capture(r1)
    const code = owner.ok ? owner.value.referralCode : ''
    await capture(r2, { referralCode: code })

    const before1 = await creditsOf(r1)
    const before2 = await creditsOf(r2)
    const sale = await db.as('nabvy_pipeline', (tx) =>
      trackSale(
        tx,
        { userId: r2, invoiceId: 'in_b1', kind: 'subscription', amountMinor: 900, currency: 'GBP' },
        deps(),
      ),
    )
    expect(sale).toEqual({ ok: true, value: { trackedSale: false, creditedReferral: true } })
    expect(await creditsOf(r1)).toBeGreaterThan(before1)
    expect(await creditsOf(r2)).toBeGreaterThan(before2)

    // A second paid invoice for the same referred user credits nothing further.
    const creditedAfterFirst1 = await creditsOf(r1)
    const creditedAfterFirst2 = await creditsOf(r2)
    const second = await db.as('nabvy_pipeline', (tx) =>
      trackSale(
        tx,
        { userId: r2, invoiceId: 'in_b2', kind: 'subscription', amountMinor: 900, currency: 'GBP' },
        deps(),
      ),
    )
    expect(second.ok && second.value.creditedReferral).toBe(false)
    expect(await creditsOf(r1)).toBe(creditedAfterFirst1)
    expect(await creditsOf(r2)).toBe(creditedAfterFirst2)
  })

  it('never credits from a top-up sale', async () => {
    const r1 = '00000000-0000-4000-8000-0000000000b3'
    const r2 = '00000000-0000-4000-8000-0000000000b4'
    await addUsers(db, r1, r2)
    const owner = await capture(r1)
    const code = owner.ok ? owner.value.referralCode : ''
    await capture(r2, { referralCode: code })
    const sale = await db.as('nabvy_pipeline', (tx) =>
      trackSale(
        tx,
        { userId: r2, invoiceId: 'in_topup', kind: 'topup', amountMinor: 1000, currency: 'GBP' },
        deps(),
      ),
    )
    expect(sale.ok && sale.value.creditedReferral).toBe(false)
  })
})

describe('account standing', () => {
  it('refuses to track a sale for an inactive account', async () => {
    const result = await db.as('nabvy_pipeline', (tx) =>
      trackSale(
        tx,
        {
          userId: BANNED,
          invoiceId: 'in_banned',
          kind: 'subscription',
          amountMinor: 900,
          currency: 'GBP',
        },
        deps(),
      ),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'attribution.account_inactive' } })
  })
})

describe('getAttribution', () => {
  it('returns null for a user never captured', async () => {
    const r = await db.as('nabvy_pipeline', (tx) =>
      getAttribution(tx, '00000000-0000-4000-8000-0000000000c1'),
    )
    expect(r).toEqual({ ok: true, value: null })
  })
})
