import { loadEnv } from '@nabvy/config'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type DbHandle, withUser } from '../src/index'

// The RLS test from task 0.3's definition of done, through the real withUser helper: a query
// outside withUser returns nothing, inside it only that user's rows. Runs when DATABASE_URL
// points at a local database with the migrations applied (CI job "Migration dry-run"; locally
// after pnpm db:dry-run); skipped otherwise. It connects as that URL's user and switches to
// nabvy_app, so the URL must be the migration role's.

function localDatabaseUrl(): string | undefined {
  try {
    const url = loadEnv(['database']).DATABASE_URL
    const host = new URL(url).hostname
    return ['localhost', '127.0.0.1', '[::1]', ''].includes(host) ? url : undefined
  } catch {
    return undefined
  }
}

const url = localDatabaseUrl()
const userA = '00000000-0000-7000-8000-0000000000a1'
const userB = '00000000-0000-7000-8000-0000000000b2'

describe.skipIf(!url)('withUser against Postgres', () => {
  let admin: DbHandle
  let app: DbHandle

  beforeAll(async () => {
    admin = createDb(url as string, { max: 1 })
    // One connection, so the no-leak test really reuses the connection withUser used.
    app = createDb(url as string, { max: 1, options: '-c role=nabvy_app' })
    await admin.db.execute(
      sql.raw(`
      drop schema if exists with_user_probe cascade;
      create schema with_user_probe;
      create table with_user_probe.notes (
        id uuid primary key default nabvy_core.uuidv7(),
        user_id uuid not null,
        body text not null
      );
      grant usage on schema with_user_probe to nabvy_app;
      grant select, insert on with_user_probe.notes to nabvy_app;
      select nabvy_core.enable_user_rls('with_user_probe.notes');
      insert into with_user_probe.notes (user_id, body)
        values ('${userA}', 'a1'), ('${userA}', 'a2'), ('${userB}', 'b1');
    `),
    )
  })

  afterAll(async () => {
    await admin?.db.execute(sql.raw('drop schema if exists with_user_probe cascade'))
    await Promise.all([admin?.pool.end(), app?.pool.end()])
  })

  const bodies = (rows: { rows: Record<string, unknown>[] }) => rows.rows.map((r) => r.body).sort()

  it('returns nothing outside withUser', async () => {
    const rows = await app.db.execute(sql`select body from with_user_probe.notes`)
    expect(rows.rows).toEqual([])
  })

  it('returns only the user’s rows inside withUser', async () => {
    const a = await withUser(
      userA,
      (tx) => tx.execute(sql`select body from with_user_probe.notes`),
      app.db,
    )
    const b = await withUser(
      userB,
      (tx) => tx.execute(sql`select body from with_user_probe.notes`),
      app.db,
    )
    expect(bodies(a)).toEqual(['a1', 'a2'])
    expect(bodies(b)).toEqual(['b1'])
  })

  it('does not leak the user to the next transaction on the same connection', async () => {
    await withUser(userA, (tx) => tx.execute(sql`select 1`), app.db)
    const client = await app.pool.connect()
    try {
      const after = await client.query('select body from with_user_probe.notes')
      expect(after.rows).toEqual([])
    } finally {
      client.release()
    }
  })

  it('refuses writes for another user and IDs that are not UUIDs', async () => {
    await expect(
      withUser(
        userA,
        (tx) =>
          tx.execute(sql`insert into with_user_probe.notes (user_id, body) values (${userB}, 'x')`),
        app.db,
      ),
    ).rejects.toThrow()
    await expect(withUser("' or true --", async () => 1, app.db)).rejects.toThrow()
  })
})
