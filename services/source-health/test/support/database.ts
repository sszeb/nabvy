import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the core, switches and source-health migrations applied
// (same pattern as services/route-health/test/support/database.ts). No apify-gateway, route-health
// or run-coverage stand-ins: only their own modules may write their tables
// (services/apify-gateway/test/conventions.test.ts), so tests of the apify-gateway.run-collected
// handler inject a fake RunCollectedReader instead (test/handlers.test.ts). PGlite has no PostGIS,
// pgvector or pg_trgm, so `create extension` lines are skipped; the full set runs in
// `pnpm db:dry-run`.

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export interface TestDatabase {
  db: Queryable
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  close(): Promise<void>
}

const modules = ['core', 'switches', 'source-health']

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

/** Every switch source-health's handler reads, on. */
export const ALL_ON = { 'source-health': 'on' } as const
