import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chargeUsage, grant } from '../src'
import { addUsers, createTestDatabase, setSwitch, type TestDatabase } from './support/database'

// What the database holds whoever writes (the access migration): nabvy_app cannot mint credit,
// edit a bucket, forge a reversal or see another user's ledger; v_balances and the low-balance
// event; the account check.

const U1 = '00000000-0000-4000-8000-0000000000d1'
const U2 = '00000000-0000-4000-8000-0000000000d2'
const BANNED = '00000000-0000-4000-8000-0000000000d3'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'on')
  await addUsers(db, U1, U2, BANNED)
  await db.sql(`update better_auth."user" set banned = true where id = $1`, [BANNED])
  for (const [userId, refId] of [
    [U1, 'pi_u1'],
    [U2, 'pi_u2'],
    [BANNED, 'pi_b'],
  ] as const) {
    await db.as('nabvy_pipeline', (tx) =>
      grant(tx, { userId, kind: 'topup', credits: 100, refId, cashMinor: 1000 }),
    )
  }
}, 60_000)
afterAll(() => db.close())

/** Drizzle wraps the database error; its message is on `cause`. */
async function refused(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await p.then(
    () => undefined,
    (e: { message: string; cause?: { message?: string } }) => e,
  )
  expect(error, 'expected the database to refuse').toBeDefined()
  expect(`${error?.message} ${error?.cause?.message ?? ''}`).toMatch(pattern)
}

const asApp = <T>(userId: string, sql: string) =>
  db.as(
    'nabvy_app',
    (tx) => (tx as unknown as { execute: (q: string) => Promise<T> }).execute(sql),
    userId,
  )

describe('the database refuses', () => {
  it('a grant from the web app', async () => {
    await refused(
      asApp(
        U1,
        `insert into usage_ledger.entries (user_id, kind, credits, ref_id) values ('${U1}', 'topup', 1000, 'free')`,
      ),
      /row-level security/,
    )
  })

  it('a bucket edit from the web app or the pipeline', async () => {
    await refused(
      asApp(U1, `update usage_ledger.buckets set remaining = 1000`),
      /permission denied/,
    )
    await refused(
      db.as('nabvy_pipeline', (tx) =>
        tx.execute('update usage_ledger.buckets set remaining = 1000'),
      ),
      /permission denied/,
    )
  })

  it('a charge without allocations, at commit', async () => {
    await refused(
      asApp(
        U1,
        `insert into usage_ledger.entries (user_id, kind, credits, action, ref_id) values ('${U1}', 'charge', -5, 'x', 'bare')`,
      ),
      /allocations move 0/,
    )
  })

  it('a reversal that names no charge, or returns more than it took', async () => {
    const r = await db.as(
      'nabvy_app',
      (tx) => chargeUsage(tx, { userId: U1, action: 'scan_live', credits: 3, refId: 'scan:3' }),
      U1,
    )
    expect(r.ok).toBe(true)
    const chargeId = r.ok ? r.value.entry.id : ''
    await refused(
      asApp(
        U1,
        `insert into usage_ledger.entries (user_id, kind, credits, ref_id, reverses_id) values ('${U1}', 'reversal', 50, 'scan:3', '${chargeId}')`,
      ),
      /exactly 3 credits/,
    )
    await refused(
      asApp(
        U1,
        `insert into usage_ledger.entries (user_id, kind, credits, ref_id, reverses_id) values ('${U1}', 'reversal', 0, 'x', '${U2}')`,
      ),
      /names no charge/,
    )
  })

  it('an overdraw even when the application check is skipped', async () => {
    const [b] = await db.sql(`select id from usage_ledger.buckets where user_id = $1`, [U2])
    await refused(
      asApp(
        U2,
        `with e as (insert into usage_ledger.entries (user_id, kind, credits, action, ref_id) values ('${U2}', 'charge', -500, 'x', 'over') returning id)
         insert into usage_ledger.allocations (entry_id, bucket_id, user_id, credits) select id, '${b?.id}', '${U2}', -500 from e`,
      ),
      /buckets_remaining/,
    )
  })

  it('an allocation added later to a committed charge (review of PR #47)', async () => {
    const r = await db.as(
      'nabvy_app',
      (tx) => chargeUsage(tx, { userId: U1, action: 'scan_live', credits: 1, refId: 'scan:late' }),
      U1,
    )
    const chargeId = r.ok ? r.value.entry.id : ''
    // A second bucket: the (entry, bucket) primary key already refuses the charged one.
    await db.as('nabvy_pipeline', (tx) =>
      grant(tx, { userId: U1, kind: 'topup', credits: 10, refId: 'pi_u1_second', cashMinor: 100 }),
    )
    const [b] = await db.sql(
      `select b.id from usage_ledger.buckets b join usage_ledger.entries e on e.id = b.id where e.ref_id = 'pi_u1_second'`,
    )
    await refused(
      asApp(
        U1,
        `insert into usage_ledger.allocations (entry_id, bucket_id, user_id, credits) values ('${chargeId}', '${b?.id}', '${U1}', -1)`,
      ),
      /allocations move -2/,
    )
  })

  it('a charge drawn on an expired bucket, even when the application check is skipped', async () => {
    await db.as('nabvy_pipeline', (tx) =>
      grant(tx, {
        userId: U1,
        kind: 'allowance',
        credits: 10,
        refId: 'allowance:gone',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    )
    const [b] = await db.sql(
      `select id from usage_ledger.buckets where user_id = $1 and kind = 'allowance'`,
      [U1],
    )
    await refused(
      asApp(
        U1,
        `with e as (insert into usage_ledger.entries (user_id, kind, credits, action, ref_id) values ('${U1}', 'charge', -1, 'x', 'from-expired') returning id)
         insert into usage_ledger.allocations (entry_id, bucket_id, user_id, credits) select id, '${b?.id}', '${U1}', -1 from e`,
      ),
      /has expired/,
    )
  })

  it("reading another user's ledger", async () => {
    const rows = await asApp<{ rows: unknown[] }>(U1, `select * from usage_ledger.buckets`)
    expect(rows.rows).toHaveLength(3)
  })
})

describe('charges', () => {
  it('refuse an inactive account', async () => {
    const r = await db.as(
      'nabvy_app',
      (tx) => chargeUsage(tx, { userId: BANNED, action: 'scan_live', credits: 1, refId: 'scan:b' }),
      BANNED,
    )
    expect(r).toMatchObject({ ok: false, error: { code: 'usage-ledger.account_inactive' } })
  })

  it('emit balance-low once, on the charge that crosses the line', async () => {
    const run = (refId: string, credits: number) =>
      db.as(
        'nabvy_app',
        (tx) => chargeUsage(tx, { userId: U2, action: 'scan_live', credits, refId }),
        U2,
      )
    const a = await run('low:1', 50) // 100 → 50: not below 50
    const b = await run('low:2', 1) // 50 → 49: crosses
    const c = await run('low:3', 1) // 49 → 48: already below
    expect([a, b, c].map((r) => (r.ok ? r.value.events.length : -1))).toEqual([0, 1, 0])
    expect(b.ok && b.value.events[0]).toMatchObject({
      type: 'usage-ledger.balance-low',
      payload: { userId: U2, entryId: b.ok ? b.value.entry.id : '' },
    })
  })

  it('record attributed cost, still counted after a reversal (v_balances)', async () => {
    const cost = 1_310_000 // 1.31p, one lone check (docs/decisions.md, "Free tier")
    await db.as(
      'nabvy_app',
      (tx) =>
        chargeUsage(tx, {
          userId: U1,
          action: 'burst_check',
          credits: 0,
          refId: 'check:1',
          costGbpMicros: cost,
        }),
      U1,
    )
    const [row] = (
      await db.as('nabvy_pipeline', (tx) =>
        tx.execute(`select * from usage_ledger.v_balances where user_id = '${U1}'`),
      )
    ).rows as Record<string, unknown>[]
    expect(row).toMatchObject({
      credits: 106,
      topup_credits: 106,
      funding_credits: 106,
      attributed_cost_gbp_micros: cost,
    })
  })
})
