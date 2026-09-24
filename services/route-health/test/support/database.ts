import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the core, switches and route-health migrations applied
// (same pattern as services/incidents/test/support/database.ts). No apify-gateway or Supabase
// stand-ins: only the apify-gateway module may write `apify_gateway.jobs`
// (services/apify-gateway/test/conventions.test.ts), so this harness never seeds one — tests of
// the apify-gateway.run-collected handler inject a fake `RunCollectedReader` instead
// (test/handlers.test.ts). PGlite has no PostGIS, pgvector or pg_trgm, so `create extension` lines
// are skipped; the full set runs in `pnpm db:dry-run`.

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
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Sets switches the way an admin would (switches.set is tested in its own module). */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  close(): Promise<void>
}

const modules = ['core', 'switches', 'route-health']

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of modules.flatMap(migrationFiles)) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  const db = drizzle(pg) as unknown as Queryable
  await pg.exec('set role nabvy_pipeline')
  return {
    async as(role, fn) {
      await pg.exec(role === 'postgres' ? 'reset role' : `set role ${role}`)
      try {
        return await fn(db)
      } finally {
        await pg.exec('set role nabvy_pipeline')
      }
    },
    db,
    async switches(states) {
      await pg.exec('reset role')
      try {
        for (const [name, value] of Object.entries(states)) {
          await pg.query(
            `insert into switches.switches (name, kind, state)
             values ($1, case when $1 = 'pipeline' then 'global' else 'module' end, $2)
             on conflict (name) do update set state = excluded.state`,
            [name, value],
          )
        }
      } finally {
        await pg.exec('set role nabvy_pipeline')
      }
    },
    close: () => pg.close(),
  }
}

/** Every switch route-health's handler reads, on. */
export const ALL_ON = { 'route-health': 'on' } as const
