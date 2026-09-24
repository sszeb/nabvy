import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with core, switches and waitlist migrations applied, so tests
// run against the real tables, grants and view (same pattern as
// services/incidents/test/support/database.ts). waitlist depends on switches (module.json), so its
// view can filter on switches.state('waitlist'). PGlite has no PostGIS, pgvector or pg_trgm, so
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

export interface TestDatabase {
  /** Runs `fn` as `role` (superuser by default), then resets back afterwards. */
  as<T>(
    role: 'postgres' | 'nabvy_app' | 'nabvy_pipeline',
    fn: (db: Queryable) => Promise<T>,
  ): Promise<T>
  close(): Promise<void>
}

/** `modules` beyond `core`, applied in order (each must list its own deps in `dependsOn`). */
export async function createTestDatabase(
  modules: string[] = ['switches', 'waitlist'],
): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [...migrationFiles('core'), ...modules.flatMap(migrationFiles)]) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  const db = drizzle(pg)
  return {
    async as(role, fn) {
      await pg.exec(role === 'postgres' ? 'reset role' : `set role ${role}`)
      try {
        return await fn(db as unknown as Queryable)
      } finally {
        await pg.exec('reset role')
      }
    },
    close: () => pg.close(),
  }
}
