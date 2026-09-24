import { grantAllowance, grantTopup } from '@nabvy/usage-ledger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkFloor, setPolicy, usageLedgerPolicy } from '../src'
import {
  ADMIN,
  addUsers,
  createTestDatabase,
  setSwitch,
  type TestDatabase,
  USER_A,
} from './support/database'

// What the database holds whoever writes, the seeded policy, and the UsageLedgerPolicy that
// usage-ledger grants with.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await addUsers(db, ADMIN, USER_A)
  await setSwitch(db, 'pricing-console', 'on')
}, 60_000)
afterAll(() => db.close())

const fails = (p: Promise<unknown>) => expect(p).rejects.toThrow()

describe('seeded initial policy', () => {
  it('passes its own floor', async () => {
    expect(await db.as('nabvy_pipeline', (q) => checkFloor(q))).toEqual([])
  })

  it('publishes the ladder, prices, settings and free policy', async () => {
    const ladder = await db.as('nabvy_pipeline', (q) =>
      q.execute(
        'select tier, base_cadence_minutes, floor_cadence_minutes, bundled_credits from pricing_console.v_ladder order by tier',
      ),
    )
    expect(ladder.rows).toEqual([
      {
        tier: 'business',
        base_cadence_minutes: 15,
        floor_cadence_minutes: 1,
        bundled_credits: 80000,
      },
      { tier: 'max', base_cadence_minutes: 15, floor_cadence_minutes: 1, bundled_credits: 24000 },
      { tier: 'pro', base_cadence_minutes: 30, floor_cadence_minutes: 5, bundled_credits: 6000 },
      {
        tier: 'starter',
        base_cadence_minutes: 120,
        floor_cadence_minutes: 60,
        bundled_credits: 1200,
      },
    ])
    const [margin] = await db.sql(
      `select value from pricing_console.v_settings where setting = 'min-margin-bps'`,
    )
    expect(margin?.value).toBe(20000)
    const [free] = await db.sql(
      'select window_count, lifetime_cap_pence from pricing_console.v_free_policy',
    )
    expect(free).toEqual({ window_count: 3, lifetime_cap_pence: 200 })
    const prices = await db.sql('select count(*)::int as n from pricing_console.v_prices')
    expect(prices[0]?.n).toBe(11)
  })
})

describe('the table', () => {
  it('is append-only, numbered without gaps, never effective in the past', async () => {
    await fails(db.sql(`update pricing_console.policy_rows set reason = 'x'`))
    await fails(db.sql(`delete from pricing_console.policy_rows where kind = 'tier'`))
    await fails(db.sql('truncate pricing_console.policy_rows'))
    await fails(
      db.sql(
        `insert into pricing_console.policy_rows (kind, key, version, value) values ('setting', 'vat-bps', 3, '{"value": 2000}')`,
      ),
    )
    await fails(
      db.sql(
        `insert into pricing_console.policy_rows (kind, key, version, value, effective_at) values ('setting', 'vat-bps', 2, '{"value": 2000}', now() - interval '1 hour')`,
      ),
    )
    await fails(
      db.sql(
        `insert into pricing_console.policy_rows (kind, key, version, value, target_user_id) values ('offer', 'x', 1, '{"userId": null}', '${USER_A}')`,
      ),
    )
  })

  it('refuses writes from the web app and hides other users’ offers from it', async () => {
    await fails(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `insert into pricing_console.policy_rows (kind, key, version, value) values ('setting', 'z', 1, '{"value": 1}')`,
          ),
        USER_A,
      ),
    )
    const offer = {
      userId: ADMIN,
      segment: null,
      item: 'price:export' as const,
      discountBps: 1000,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    }
    const r = await db.as('nabvy_pipeline', (q) =>
      setPolicy(q, { actorUserId: ADMIN, kind: 'offer', key: 'for-admin', value: offer }),
    )
    expect(r.ok).toBe(true)
    const seen = await db.as(
      'nabvy_app',
      (q) => q.execute(`select key from pricing_console.policy_rows where kind = 'offer'`),
      USER_A,
    )
    expect(seen.rows).toEqual([])
    const own = await db.as(
      'nabvy_app',
      (q) => q.execute(`select key from pricing_console.policy_rows where kind = 'offer'`),
      ADMIN,
    )
    expect(own.rows).toEqual([{ key: 'for-admin' }])
    await fails(
      db.as('nabvy_app', (q) => q.execute('select * from pricing_console.v_ladder'), USER_A),
    )
  })

  it('refuses a change taking effect in the past, and keeps a future one until its time', async () => {
    const past = await db.as('nabvy_pipeline', (q) =>
      setPolicy(q, {
        actorUserId: ADMIN,
        kind: 'setting',
        key: 'vat-bps',
        value: { value: 2000 },
        effectiveAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    expect(past.ok ? null : past.error.code).toBe('pricing-console.invalid')
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const later = await db.as('nabvy_pipeline', (q) =>
      setPolicy(q, {
        actorUserId: ADMIN,
        kind: 'price',
        key: 'export',
        value: { unit: 'each', credits: 60, costBasis: null, costUnits: 1 },
        effectiveAt: future,
      }),
    )
    expect(later.ok).toBe(true)
    const [row] = await db.sql(`select credits from pricing_console.v_prices where item = 'export'`)
    expect(row?.credits).toBe(50)
  })
})

describe('review of PR #55', () => {
  const offer = (userId: string | null, segment: string | null) => ({
    userId,
    segment,
    item: 'price:export' as const,
    discountBps: 1000,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  })
  const set = (key: string, value: unknown, effectiveAt?: string) =>
    db.as('nabvy_pipeline', (q) =>
      setPolicy(q, {
        actorUserId: ADMIN,
        kind: 'offer',
        key,
        value: value as never,
        ...(effectiveAt ? { effectiveAt } : {}),
      }),
    )
  const code = (r: Awaited<ReturnType<typeof set>>) => (r.ok ? 'ok' : r.error.code)

  it('an offer never changes whom it is for, in code and in the database', async () => {
    expect(code(await set('promo', offer(null, 'all')))).toBe('ok')
    expect(code(await set('promo', offer(USER_A, null)))).toBe('pricing-console.invalid')
    expect(code(await set('gift', offer(USER_A, null)))).toBe('ok')
    expect(code(await set('gift', offer(null, 'all')))).toBe('pricing-console.invalid')
    await fails(
      db.sql(
        `insert into pricing_console.policy_rows (kind, key, version, value, target_user_id)
         select kind, key, 2, jsonb_set(value, '{userId}', to_jsonb($1::text)), $1::uuid
         from pricing_console.policy_rows where kind = 'offer' and key = 'promo'`,
        [USER_A],
      ),
    )
    await fails(
      db.sql(
        `insert into pricing_console.policy_rows (kind, key, version, value)
         select kind, key, 2, jsonb_set(value, '{userId}', 'null'), value
         from pricing_console.policy_rows where kind = 'offer' and key = 'gift'`,
      ),
    )
  })

  it('a change never takes effect before a version already scheduled', async () => {
    const soon = new Date(Date.now() + 7_200_000).toISOString()
    const change = (credits: number, effectiveAt?: string) =>
      db.as('nabvy_pipeline', (q) =>
        setPolicy(q, {
          actorUserId: ADMIN,
          kind: 'price',
          key: 'boost-24h',
          value: { unit: 'each', credits, costBasis: null, costUnits: 1 },
          ...(effectiveAt ? { effectiveAt } : {}),
        }),
      )
    expect((await change(160, soon)).ok).toBe(true)
    const now = await change(170)
    expect(now.ok && now.value.row.effectiveAt).toBe(soon) // follows the scheduled version
    const early = await change(180, new Date(Date.now() + 60_000).toISOString())
    expect(early.ok ? null : early.error.code).toBe('pricing-console.invalid')
    await fails(
      db.sql(
        `insert into pricing_console.policy_rows (kind, key, version, value)
         select kind, key, version + 1, value from pricing_console.policy_rows
         where kind = 'price' and key = 'boost-24h' order by version desc limit 1`,
      ),
    )
  })

  it('keeps tier and bundle keys short enough for the ledger’s policy version', async () => {
    const r = await db.as('nabvy_pipeline', (q) =>
      setPolicy(q, {
        actorUserId: ADMIN,
        kind: 'bundle',
        key: 'a-very-long-bundle-key-over-24',
        value: { tier: null, grossMinor: 1000, discountBps: 0 },
      }),
    )
    expect(r.ok ? null : r.error.code).toBe('pricing-console.invalid')
  })

  it('lets the web app read a basis cost, never choose its own window', async () => {
    await fails(
      db.as(
        'nabvy_app',
        (q) => q.execute(`select pricing_console.measured_cost('apify', null, 7, 1)`),
        USER_A,
      ),
    )
    const r = await db.as(
      'nabvy_app',
      (q) => q.execute(`select pricing_console.basis_cost('check') as c`),
      USER_A,
    )
    expect(r.rows).toEqual([{ c: null }])
  })
})

describe('UsageLedgerPolicy', () => {
  it('values allowances and top-ups through the real ledger, with the policy version', async () => {
    const allowance = await db.as('nabvy_pipeline', (q) =>
      grantAllowance(
        q,
        {
          userId: USER_A,
          plan: 'pro',
          refId: 'allowance:sub_1@2026-09',
          cashMinor: 2317,
          expiresAt: '2026-10-24T00:00:00.000Z',
        },
        usageLedgerPolicy,
      ),
    )
    expect(allowance.ok && allowance.value.entry).toMatchObject({
      credits: 6000,
      policyVersion: 'pricing-console:tier/pro@1',
    })
    const topup = await db.as('nabvy_pipeline', (q) =>
      grantTopup(
        q,
        { userId: USER_A, plan: 'starter', refId: 'pi_1', cashMinor: 786 },
        usageLedgerPolicy,
      ),
    )
    expect(topup.ok && topup.value.entry).toMatchObject({
      credits: 994,
      policyVersion: 'pricing-console:tier/starter@1',
    })
    const unknown = await db.as('nabvy_pipeline', (q) =>
      usageLedgerPolicy.bundleCredits(q, 'platinum'),
    )
    expect(unknown).toBeNull()
  })
})
