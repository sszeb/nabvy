import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the real core, switches and quote-redaction migrations
// applied, used as nabvy_app (the role callers use to read a quote). PGlite has no PostGIS,
// pgvector or pg_trgm; nothing here uses them. The full set runs in `pnpm db:dry-run`.

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_app. */
  db: Queryable
  /** Runs SQL as the migration superuser, for example to change a switch. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [
    ...migrationFiles('core'),
    ...migrationFiles('switches'),
    ...migrationFiles('quote-redaction'),
  ]) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  await pg.exec('set role nabvy_app')
  return {
    db: drizzle(pg) as unknown as Queryable,
    async sql(query, params = []) {
      await pg.exec('reset role')
      try {
        return (await pg.query<Record<string, unknown>>(query, params)).rows
      } finally {
        await pg.exec('set role nabvy_app')
      }
    },
    close: () => pg.close(),
  }
}
