import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the core, audit-log, switches, better-auth, account,
// product-events, marketing-consent and lifecycle-messaging migrations applied (the same pattern
// as services/marketing-consent/test/support/database.ts): this module reads product_events.v_events
// and account.v_profiles directly and calls marketing-consent's canMarket(), so all three must be
// migrated for a realistic test database. PGlite has no PostGIS, pgvector or pg_trgm; nothing here
// uses them, so their `create extension` lines are skipped. The full migration set runs on real
// Postgres in `pnpm db:dry-run` (packages/db/tests/lifecycle-messaging.test.sql).

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
  /** Runs `fn` in one transaction as `role`; with `userId`, as withUser does (app.user_id set locally). */
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>, userId?: string): Promise<T>
  /** Runs SQL as the migration superuser. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Inserts a minimal better_auth.user row so isActive()/canMarket() see a real account. */
  createUser(input: { userId: string; banned?: boolean; banExpires?: Date | null }): Promise<void>
  /** Inserts a raw product_events row, bypassing track()'s own allowlist -- this module only reads. */
  insertEvent(input: {
    userId: string
    event: string
    properties?: Record<string, unknown>
    at: Date
  }): Promise<void>
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
    ...migrationFiles('marketing-consent'),
    ...migrationFiles('lifecycle-messaging'),
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
    async createUser({ userId, banned = false, banExpires = null }) {
      await pg.query(
        `insert into better_auth."user" (id, name, email, email_verified, banned, ban_expires)
         values ($1, 'Test User', $2, true, $3, $4)
         on conflict (id) do update set banned = excluded.banned, ban_expires = excluded.ban_expires`,
        [userId, `${userId}@example.com`, banned, banExpires],
      )
    },
    async insertEvent({ userId, event, properties = {}, at }) {
      await pg.query(
        `insert into product_events.events (user_id, event, properties, at) values ($1, $2, $3, $4)`,
        [userId, event, JSON.stringify(properties), at.toISOString()],
      )
    },
    close: () => pg.close(),
  }
}
