import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the real core and better-auth migrations applied, so the
// tests run Better Auth against the actual tables and grants, as the nabvy_auth role. PGlite has
// no PostGIS, pgvector or pg_trgm; nothing here uses them, so their `create extension` lines are
// skipped. The full migration set runs on real Postgres in `pnpm db:dry-run`.

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export interface TestDatabase {
  pg: PGlite
  /** Drizzle on the one PGlite connection, which runs as nabvy_auth between `as` calls. */
  db: ReturnType<typeof drizzle>
  /** Runs `fn` as another role (the migration superuser by default), then back to nabvy_auth. */
  as<T>(
    role: 'postgres' | 'nabvy_app' | 'nabvy_pipeline',
    fn: (db: Queryable) => Promise<T>,
  ): Promise<T>
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [...migrationFiles('core'), ...migrationFiles('better-auth')]) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  await pg.exec('set role nabvy_auth')
  const db = drizzle(pg)
  return {
    pg,
    db,
    async as(role, fn) {
      await pg.exec(role === 'postgres' ? 'reset role' : `set role ${role}`)
      try {
        return await fn(db as unknown as Queryable)
      } finally {
        await pg.exec('set role nabvy_auth')
      }
    },
    async sql(query, params = []) {
      await pg.exec('reset role')
      try {
        return (await pg.query<Record<string, unknown>>(query, params)).rows
      } finally {
        await pg.exec('set role nabvy_auth')
      }
    },
    close: () => pg.close(),
  }
}
