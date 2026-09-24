import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the real core, audit-log, switches, better-auth, account
// and product-events migrations applied, so tests run against the real tables, grants, RLS and
// view (same pattern as services/account/test/support/database.ts). product-events depends on
// account for consent (getProfile), and account itself needs audit-log and better-auth to apply
// (services/account/test/support/database.ts). PGlite has no PostGIS, pgvector or pg_trgm, so
// core's `create extension` lines are skipped; nothing here needs them. The full migration set
// runs on real Postgres in `pnpm db:dry-run`.

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
    ...migrationFiles('account'),
    ...migrationFiles('product-events'),
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
