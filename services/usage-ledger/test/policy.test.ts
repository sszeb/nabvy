import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grantAllowance, grantTopup, type UsageLedgerPolicy } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

// Policy-priced grants (docs/decisions.md, "Paid ladder"): bundle and top-up values come from an
// injected pricing-console policy; the ledger holds no number of its own.

const U1 = '00000000-0000-4000-8000-0000000000a1'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await addUsers(db, U1)
}, 60_000)
afterAll(() => db.close())

/** A test policy: the values are arbitrary, standing in for pricing-console rows. */
function policy(bundle: number, perPenny: number, version: string): UsageLedgerPolicy {
  return {
    bundleCredits: async (_q, plan) =>
      plan === 'pro' ? { credits: bundle, policyVersion: version } : null,
    topupCredits: async (_q, plan, cashMinor) =>
      plan === 'pro' ? { credits: cashMinor * perPenny, policyVersion: version } : null,
  }
}

const expiresAt = new Date(Date.now() + 30 * 24 * 3_600_000).toISOString()
const entries = () =>
  db.sql(
    `select kind, credits, policy_version from usage_ledger.entries where user_id = $1 order by at`,
    [U1],
  )

describe('policy-priced grants', () => {
  it('refuse without a pricing policy (pricing-console not built) and write nothing', async () => {
    const r = await db.as('nabvy_pipeline', (tx) =>
      grantAllowance(tx, {
        userId: U1,
        plan: 'pro',
        refId: 'allowance:p1',
        cashMinor: 2400,
        expiresAt,
      }),
    )
    expect(r).toMatchObject({ ok: false, error: { code: 'usage-ledger.no_policy' } })
    expect(await entries()).toEqual([])
  })

  it('value the bundle and the top-up from the policy and record its version', async () => {
    const v1 = policy(6000, 2, 'v1')
    await db.as('nabvy_pipeline', (tx) =>
      grantAllowance(
        tx,
        { userId: U1, plan: 'pro', refId: 'allowance:p1', cashMinor: 2400, expiresAt },
        v1,
      ),
    )
    await db.as('nabvy_pipeline', (tx) =>
      grantTopup(tx, { userId: U1, plan: 'pro', refId: 'pi_t1', cashMinor: 500 }, v1),
    )
    expect(await entries()).toEqual([
      { kind: 'allowance', credits: 6000, policy_version: 'v1' },
      { kind: 'topup', credits: 1000, policy_version: 'v1' },
    ])
  })

  it('a replay after a price change keeps the first value; other cash is refused', async () => {
    const v2 = policy(9999, 5, 'v2')
    const replay = await db.as('nabvy_pipeline', (tx) =>
      grantTopup(tx, { userId: U1, plan: 'pro', refId: 'pi_t1', cashMinor: 500 }, v2),
    )
    expect(replay.ok && replay.value).toMatchObject({
      changed: false,
      entry: { credits: 1000, policyVersion: 'v1' },
    })
    const other = await db.as('nabvy_pipeline', (tx) =>
      grantTopup(tx, { userId: U1, plan: 'pro', refId: 'pi_t1', cashMinor: 900 }, v2),
    )
    expect(other).toMatchObject({ ok: false, error: { code: 'usage-ledger.mismatch' } })
  })

  it('a plan the policy does not know is refused', async () => {
    const r = await db.as('nabvy_pipeline', (tx) =>
      grantTopup(
        tx,
        { userId: U1, plan: 'unknown', refId: 'pi_x', cashMinor: 500 },
        policy(1, 1, 'v1'),
      ),
    )
    expect(r).toMatchObject({ ok: false, error: { code: 'usage-ledger.no_policy' } })
  })
})
