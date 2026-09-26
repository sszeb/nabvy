import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { onAccountDeleted, submit } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedDetail,
  seedListing,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

// docs/security.md: a user sees only their own rows, through withUser; the app may insert only a
// fresh request stamped with server time; the account.deleted purge removes every row of a user;
// a request is answered at once when the card is already visible with its details; the daily
// limit counts on server time; a restricted account is refused.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'
const ID = '12345678901234567'
const LINK = `https://www.facebook.com/marketplace/item/${ID}/`

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(async () => {
  await setSwitches(db, ALL_ON)
  await db.sql('delete from pasted_link_lookup.requests')
  await db.sql('delete from detail_evidence.fetches')
  await db.sql('delete from detail_evidence.evidence')
  await db.sql('delete from listing_ingest.listings')
})

const rows = (result: unknown) => (result as Record<string, unknown>[]).length

describe('row-level security', () => {
  it('a user reads only their own requests, in the view and in the table', async () => {
    await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    await db.as('nabvy_app', (q) => submit(q, { userId: U2, url: LINK }), U2)
    const mine = await db.as(
      'nabvy_app',
      async (q) =>
        (await q.execute('select request_id from app.v_pasted_link_lookup_requests')) as unknown,
      U1,
    )
    expect(rows((mine as { rows: unknown[] }).rows)).toBe(1)
    const table = await db.as(
      'nabvy_app',
      async (q) => (await q.execute('select id from pasted_link_lookup.requests')) as unknown,
      U1,
    )
    expect(rows((table as { rows: unknown[] }).rows)).toBe(1)
    const none = await db.as(
      'nabvy_app',
      async (q) => (await q.execute('select id from pasted_link_lookup.requests')) as unknown,
    )
    expect(rows((none as { rows: unknown[] }).rows)).toBe(0)
  })

  it('a user cannot insert for another user, backdate a request, or record a failure', async () => {
    const attempt = (sql: string) =>
      db
        .as('nabvy_app', (q) => q.execute(sql), U1)
        .then(() => 'inserted')
        .catch((e: Error & { cause?: Error }) => {
          const text = `${e.message} ${e.cause?.message ?? ''}`
          return /policy|permission|denied/i.test(text) ? 'refused' : text
        })
    expect(
      await attempt(
        `insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status)
         values ('${U2}', 'facebook', '1', 'queued')`,
      ),
    ).toBe('refused')
    expect(
      await attempt(
        `insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status, requested_at)
         values ('${U1}', 'facebook', '2', 'queued', now() - interval '2 days')`,
      ),
    ).toBe('refused')
    expect(
      await attempt(
        `insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status, outcome)
         values ('${U1}', 'facebook', '3', 'failed', 'expired')`,
      ),
    ).toBe('refused')
    expect(
      await attempt(
        `update pasted_link_lookup.requests set status = 'failed' where user_id = '${U1}'`,
      ),
    ).toBe('refused')
  })

  it('answers at once when the card is already visible with its details', async () => {
    const listingId = await seedListing(db, { sourceListingId: ID })
    await seedDetail(db, { listingId, sourceListingId: ID })
    const outcome = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.value.status).toBe('ready')
    expect(outcome.value.listingId).toBe(listingId)
    const [row] = await db.sql(
      `select status, ready_at is not null as ready from pasted_link_lookup.requests where user_id = $1`,
      [U1],
    )
    expect(row).toEqual({ status: 'ready', ready: true })
  })

  it('a visible card without details is queued, with its listing recorded', async () => {
    const listingId = await seedListing(db, { sourceListingId: ID })
    const outcome = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.value.status).toBe('queued')
    expect(outcome.value.listingId).toBe(listingId)
  })

  it('refuses a link that is not a Marketplace item, and a restricted account', async () => {
    const bad = await db.as(
      'nabvy_app',
      (q) => submit(q, { userId: U1, url: 'https://www.gumtree.com/p/1' }),
      U1,
    )
    expect(bad.ok ? 'ok' : bad.error.code).toBe('pasted-link-lookup.invalid_link')
    await db.sql(`update better_auth."user" set banned = true where id = $1`, [U1])
    const banned = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    expect(banned.ok ? 'ok' : banned.error.code).toBe('pasted-link-lookup.account_restricted')
    await db.sql(`update better_auth."user" set banned = false where id = $1`, [U1])
  })

  it('the daily limit counts the last 24 hours on server time', async () => {
    for (let i = 1; i <= 20; i += 1) {
      await db.sql(
        `insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status, requested_at)
         values ($1, 'facebook', $2, 'queued', now() - interval '1 hour')`,
        [U1, `9${String(i).padStart(3, '0')}`],
      )
    }
    const limited = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    expect(limited.ok ? 'ok' : limited.error.code).toBe('pasted-link-lookup.rate_limited')
    await db.sql(
      `update pasted_link_lookup.requests set requested_at = now() - interval '25 hours' where user_id = $1`,
      [U1],
    )
    const allowed = await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    expect(allowed.ok).toBe(true)
    const other = await db.as('nabvy_app', (q) => submit(q, { userId: U2, url: LINK }), U2)
    expect(other.ok).toBe(true)
  })

  it('account.deleted purges every request of the user, and only theirs; twice is fine', async () => {
    await db.as('nabvy_app', (q) => submit(q, { userId: U1, url: LINK }), U1)
    await db.as('nabvy_app', (q) => submit(q, { userId: U2, url: LINK }), U2)
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }]))
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }]))
    const left = await db.sql('select user_id from pasted_link_lookup.requests')
    expect(left).toEqual([{ user_id: U2 }])
  })
})
