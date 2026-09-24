import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuditLogRefused, listEntries, record, recordRestrictedRead } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000b2'
const entry = (target: string) => ({
  actorUserId: ADMIN,
  action: 'auth.role-changed',
  target,
  before: { role: 'user' },
  after: { role: 'admin' },
})

let db: TestDatabase
const count = async (where = 'true') =>
  Number((await db.sql(`select count(*) as n from audit_log.entries where ${where}`))[0]?.n)

beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql('create table public.probe (id int primary key)')
  await db.sql('grant insert on public.probe to nabvy_app')
})
afterAll(() => db.close())

describe('record', () => {
  it('writes exactly one row per call, as the web app inside withUser', async () => {
    const before = await count()
    const { id } = await db.as('nabvy_app', (tx) => record(tx, entry(`user:${OTHER}`)), ADMIN)
    expect(await count()).toBe(before + 1)
    const [row] = await db.sql('select * from audit_log.entries where id = $1', [id])
    expect(row).toMatchObject({
      actor_user_id: ADMIN,
      action: 'auth.role-changed',
      target: `user:${OTHER}`,
      before: { role: 'user' },
      after: { role: 'admin' },
      reason: null,
    })
    expect(row?.at).toBeInstanceOf(Date)
  })

  it('writes one row per call from the pipeline too', async () => {
    const before = await count()
    await db.as('nabvy_pipeline', async (tx) => {
      await record(tx, entry('user:1'))
      await record(tx, entry('user:2'))
    })
    expect(await count()).toBe(before + 2)
  })

  it('records a restricted read with its reason', async () => {
    const { id } = await db.as(
      'nabvy_app',
      (tx) =>
        recordRestrictedRead(tx, {
          actorUserId: ADMIN,
          view: 'apify_gateway.v_restricted_rows',
          reason: 'scam report 42',
        }),
      ADMIN,
    )
    expect(await count(`id = '${id}' and reason = 'scam report 42'`)).toBe(1)
  })

  it('refuses the web app recording as anyone but the signed-in user', async () => {
    const before = await count()
    await expect(
      db.as('nabvy_app', (tx) => record(tx, { ...entry('user:1'), actorUserId: OTHER }), ADMIN),
    ).rejects.toMatchObject({ name: 'AuditLogRefused', code: 'audit-log.unavailable' })
    await expect(db.as('nabvy_app', (tx) => record(tx, entry('user:1')))).rejects.toBeInstanceOf(
      AuditLogRefused,
    )
    expect(await count()).toBe(before)
  })

  it('refuses invalid input before touching the database', async () => {
    await expect(
      db.as('nabvy_app', (tx) => record(tx, { ...entry('user:1'), action: 'bad' }), ADMIN),
    ).rejects.toMatchObject({ code: 'audit-log.invalid_entry' })
  })
})

describe('when the row cannot be written, the action is refused', () => {
  it('rolls back the caller’s own write in the same transaction', async () => {
    await db.sql('revoke insert on audit_log.entries from nabvy_app')
    try {
      await expect(
        db.as(
          'nabvy_app',
          async (tx) => {
            await tx.execute(sql`insert into public.probe (id) values (1)`)
            await record(tx, entry('user:1'))
          },
          ADMIN,
        ),
      ).rejects.toMatchObject({ code: 'audit-log.unavailable' })
    } finally {
      await db.sql('grant insert on audit_log.entries to nabvy_app')
    }
    expect(await db.sql('select * from public.probe')).toEqual([])
  })
})

describe('append-only', () => {
  it.each(['nabvy_app', 'nabvy_pipeline'] as const)(
    '%s cannot read, update or delete',
    async (role) => {
      for (const statement of [
        'select * from audit_log.entries',
        'select * from audit_log.v_entries',
        "update audit_log.entries set reason = 'x'",
        'delete from audit_log.entries',
        'truncate audit_log.entries',
      ]) {
        const error = await db
          .as(role, (tx) => tx.execute(sql.raw(statement)), ADMIN)
          .then(
            () => undefined,
            (e: Error) => e,
          )
        expect(String((error?.cause as Error | undefined)?.message), statement).toMatch(
          /permission denied/,
        )
      }
    },
  )

  it('refuses update, delete and truncate even for the table owner', async () => {
    const before = await count()
    await expect(db.sql("update audit_log.entries set reason = 'x'")).rejects.toThrow(/append-only/)
    await expect(db.sql('delete from audit_log.entries')).rejects.toThrow(/append-only/)
    await expect(db.sql('truncate audit_log.entries')).rejects.toThrow(/append-only/)
    expect(await count()).toBe(before)
  })

  it('refuses a restricted read without a reason in the database too', async () => {
    await expect(
      db.sql(
        "insert into audit_log.entries (actor_user_id, action, target) values ($1, 'audit-log.restricted-read', 'view:x.v_restricted_y')",
        [ADMIN],
      ),
    ).rejects.toThrow(/entries_restricted_read_reason/)
  })
})

describe('listEntries', () => {
  it('pages newest first and filters by actor and target', async () => {
    const all = await db.as('postgres', (tx) => listEntries(tx, { limit: 500 }))
    expect(all.length).toBe(await count())
    const ats = all.map((e) => e.at)
    expect([...ats].sort().reverse()).toEqual(ats)
    const mine = await db.as('postgres', (tx) =>
      listEntries(tx, { limit: 500, target: `user:${OTHER}`, actorUserId: ADMIN }),
    )
    expect(mine).toHaveLength(1)
    const first = all[0]
    if (!first) throw new Error('no entries')
    const older = await db.as('postgres', (tx) =>
      listEntries(tx, { limit: 500, before: { at: first.at, id: first.id } }),
    )
    expect(older.length).toBe(all.length - 1)
    expect(older.map((e) => e.id)).not.toContain(first.id)
  })

  it('pages one at a time through rows that share one transaction, each exactly once', async () => {
    const ids = await db.as('nabvy_pipeline', async (tx) => {
      const written: string[] = []
      for (let i = 0; i < 5; i++) written.push((await record(tx, entry(`batch:${i}`))).id)
      return written
    })
    const [{ n }] = (await db.sql(
      "select count(distinct at) as n from audit_log.entries where target like 'batch:%'",
    )) as [{ n: number }]
    expect(Number(n)).toBe(1)
    const seen: string[] = []
    let before: { at: string; id: string } | undefined
    for (;;) {
      const page = await db.as('postgres', (tx) => listEntries(tx, { limit: 1, before }))
      const last = page[0]
      if (!last) break
      seen.push(last.id)
      before = { at: last.at, id: last.id }
    }
    expect(seen).toHaveLength(await count())
    expect(new Set(seen).size).toBe(seen.length)
    for (const id of ids) expect(seen).toContain(id)
  })
})
