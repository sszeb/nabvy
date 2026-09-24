import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the real core, audit-log, switches, cost-meter,
// better-auth, usage-ledger and pricing-console migrations applied, so the tests exercise the
// actual tables, grants, policies, triggers, views and seeded policy. better-auth and
// usage-ledger are here for the UsageLedgerPolicy test (grants go through the real ledger).
// PGlite has no PostGIS, pgvector or pg_trgm; nothing here uses them, so their `create
// extension` lines are skipped. The full set runs on real Postgres in `pnpm db:dry-run`
// (packages/db/tests/pricing-console.test.sql).

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

const MODULES = [
  'core',
  'audit-log',
  'switches',
  'cost-meter',
  'better-auth',
  'usage-ledger',
  'pricing-console',
]

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

const texts = MODULES.flatMap(migrationFiles).map((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^create extension /i.test(line))
    .join('\n')
    .replaceAll('--> statement-breakpoint', ''),
)

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const text of texts) await pg.exec(text)
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

/** Adds users to better_auth (the admin actor, and users the ledger checks). */
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

/** Records `count` settled calls of `gbpMicros` each in the cost meter, as the provider did. */
export async function addCosts(
  db: TestDatabase,
  provider: 'apify' | 'anthropic',
  module: string,
  gbpMicros: number,
  count: number,
): Promise<void> {
  const kind = provider === 'apify' ? 'actor_run' : 'model_call'
  for (let i = 0; i < count; i++) {
    await db.sql(
      `insert into cost_meter.provider_calls
         (module, provider, kind, ref_id, currency, reserved_micros, settled_micros, usd_gbp_rate,
          reserved_gbp_micros, settled_gbp_micros, settled_at, status, at)
       values ($1, $2, $3, $4, 'GBP', $5, $5, 1, $5, $5, now(), 'succeeded', now())`,
      [module, provider, kind, `${provider}-${module}-${gbpMicros}-${i}`, gbpMicros],
    )
  }
}

/** Audit rows written for a target (the superuser can read audit_log.entries). */
export async function auditRows(
  db: TestDatabase,
  target: string,
): Promise<{ action: string; actor_user_id: string }[]> {
  return (await db.sql(
    'select action, actor_user_id from audit_log.entries where target = $1 order by at, id',
    [target],
  )) as { action: string; actor_user_id: string }[]
}

export const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
export const USER_A = '00000000-0000-4000-8000-0000000000a1'
export const USER_B = '00000000-0000-4000-8000-0000000000b1'
