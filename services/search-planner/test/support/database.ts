import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the real migrations of every module this module reads:
// core, audit-log, switches, then want-manager and what its views read (better-auth, account,
// usage-ledger, subscriptions, product-catalogue, city-pages), then search-planner. `as(role, fn)`
// runs a transaction as nabvy_pipeline the way withPipeline does. PGlite has no PostGIS,
// pgvector or pg_trgm, so `create extension` lines are skipped; the full set runs on real
// Postgres in `pnpm db:dry-run` (packages/db/tests/search-planner.test.sql).

const root = fileURLToPath(new URL('../../../../', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(root, 'packages/db/migrations', module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export type Role = 'postgres' | 'nabvy_app' | 'nabvy_pipeline'

export interface TestDatabase {
  /** Runs `fn` in one transaction as `role`; commits unless `fn` throws. */
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>): Promise<T>
  /** Runs SQL as the migration superuser. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [
    join(root, 'supabase/tests/supabase-stubs.sql'),
    ...[
      'core',
      'audit-log',
      'switches',
      'better-auth',
      'account',
      'usage-ledger',
      'subscriptions',
      'product-catalogue',
      'city-pages',
      'want-manager',
      'search-planner',
    ].flatMap(migrationFiles),
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
    async as(role, fn) {
      return db.transaction(async (tx) => {
        if (role !== 'postgres') await tx.execute(`set local role ${role}`)
        return fn(tx as unknown as Queryable)
      })
    },
    async sql(query, params = []) {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
    },
    close: () => pg.close(),
  }
}

export type SwitchState = 'off' | 'shadow' | 'on'

export async function setSwitches(db: TestDatabase, states: Record<string, SwitchState>) {
  for (const [name, value] of Object.entries(states)) {
    await db.sql(
      `insert into switches.switches (name, kind, state) values ($1, 'module', $2)
       on conflict (name) do update set state = excluded.state`,
      [name, value],
    )
  }
}

/** Everything this module reads, readable; want-manager in shadow so admin pairs are allowed. */
export const READY = {
  'search-planner': 'on',
  'want-manager': 'shadow',
  'city-pages': 'on',
  subscriptions: 'on',
  'product-catalogue': 'on',
} as const

/** A city page and a centre on it. */
export async function seedCentre(
  db: TestDatabase,
  input: { cityPageId: string; verified?: boolean; active?: boolean },
): Promise<void> {
  await db.sql(
    `insert into city_pages.city_pages (city_page_id, name, lat, lng, coord_source, first_seen_at)
     values ($1, $1, 50.8, -0.8, 'seed', now()) on conflict (city_page_id) do nothing`,
    [input.cityPageId],
  )
  await db.sql(
    `insert into city_pages.centres (city_page_id, active, verified, country, currency, area_km)
     values ($1, $2, $3, 'GB', 'GBP', 100)
     on conflict (city_page_id) do update set active = excluded.active, verified = excluded.verified`,
    [input.cityPageId, input.active ?? true, input.verified ?? true],
  )
}

/**
 * A want at a centre, written directly as the superuser (want-manager's own write path is its
 * business): one criterion per family. `paid` gives the user an active paid entitlement.
 */
export async function seedWant(
  db: TestDatabase,
  input: { centreId: string; families: string[]; paid?: boolean; active?: boolean },
): Promise<{ wantId: string; userId: string }> {
  const userId = randomUUID()
  const wantId = randomUUID()
  if (input.paid) {
    await db.sql(
      `insert into subscriptions.entitlements
         (user_id, tier, status, areas, wants, channels, last_event_id, last_event_at)
       values ($1, 'pro', 'active', 1, 10, '{telegram}', 'evt_test', now())`,
      [userId],
    )
  }
  await db.sql(
    `insert into want_manager.wants
       (id, user_id, lat, lng, radius_km, centre_id, currency, active, cadence_seconds,
        delivery_methods, version_hash)
     values ($1, $2, 50.8, -0.8, 50, $3, 'GBP', $4, 900, '{collection}', $5)`,
    [
      wantId,
      userId,
      input.centreId,
      input.active ?? true,
      createHash('sha256').update(wantId).digest('hex'),
    ],
  )
  for (const [position, family] of input.families.entries()) {
    await db.sql(
      `insert into want_manager.criteria (want_id, user_id, position, part_type, family)
       values ($1, $2, $3, 'gpu', $4)`,
      [wantId, userId, position, family],
    )
  }
  return { wantId, userId }
}

export async function deleteWant(db: TestDatabase, wantId: string): Promise<void> {
  await db.sql('delete from want_manager.wants where id = $1', [wantId])
}

/** An account the audit log accepts as an actor (better_auth.user). */
export async function seedAdmin(db: TestDatabase): Promise<string> {
  const id = randomUUID()
  await db.sql(`insert into better_auth."user" (id, name, email) values ($1, 'admin', $2)`, [
    id,
    `${id}@example.test`,
  ])
  return id
}

export async function planTerms(db: TestDatabase) {
  return db.sql(
    `select centre_id, term, origin, class, want_count, paid_want_count, in_budget, rank
     from search_planner.plan_terms order by centre_id, term, origin`,
  )
}
