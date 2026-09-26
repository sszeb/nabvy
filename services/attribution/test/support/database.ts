import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the real core, audit-log, switches, better-auth,
// usage-ledger and attribution migrations applied, so the tests exercise the actual tables,
// grants, policies and triggers. better-auth is here because trackSale()/reverseSale() check the
// account through `better_auth.account_active` (via @nabvy/account); usage-ledger is here because
// referral credit is a real `grant()` call. PGlite has no PostGIS, pgvector or pg_trgm; nothing
// here uses them, so their `create extension` lines are skipped. The full migration set runs on
// real Postgres in `pnpm db:dry-run` (packages/db/tests/attribution.test.sql).

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export type Role = 'postgres' | 'nabvy_app' | 'nabvy_pipeline'

export interface TestDatabase {
  pg: PGlite
  /**
   * Runs `fn` in one transaction as `role`; with `userId`, as withUser does (app.user_id set
   * locally). The transaction commits unless `fn` throws.
   */
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>, userId?: string): Promise<T>
  /** Runs SQL as the migration superuser. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [
    ...migrationFiles('core'),
    ...migrationFiles('audit-log'),
    ...migrationFiles('switches'),
    ...migrationFiles('better-auth'),
    ...migrationFiles('usage-ledger'),
    ...migrationFiles('attribution'),
  ]) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  const db = drizzle(pg)
  return {
    pg,
    async as(role, fn, userId) {
      return db.transaction(async (tx) => {
        if (role !== 'postgres') await tx.execute(`set local role ${role}`)
        if (userId) await tx.execute(`select set_config('app.user_id', '${userId}', true)`)
        return fn(tx as unknown as Queryable)
      })
    },
    async sql(query, params = []) {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
    },
    close: () => pg.close(),
  }
}

/** Adds users to better_auth so the account check passes. */
export async function addUsers(db: TestDatabase, ...ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.sql(
      `insert into better_auth."user" (id, name, email) values ($1, 'Test', $2) on conflict (id) do nothing`,
      [id, `${id}@example.com`],
    )
  }
}

export async function setSwitch(
  db: TestDatabase,
  name: string,
  state: 'off' | 'shadow' | 'on',
): Promise<void> {
  await db.sql(
    `insert into switches.switches (name, kind, state) values ($1, 'module', $2)
     on conflict (name) do update set state = excluded.state`,
    [name, state],
  )
}
