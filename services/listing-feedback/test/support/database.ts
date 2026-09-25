import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { listingHash } from '@nabvy/listing-suppression'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the real migrations of every module this module's writes
// touch: core, audit-log, switches, better-auth (account standing, through @nabvy/account's
// isActive), listing-ingest and detail-evidence (schemas listing_suppression.is_suppressed()
// joins against, even when a test seeds no rows in them) and listing-suppression itself, then
// listing-feedback. Built like scan-recognition's test support: `as(role, fn, userId)` runs a
// transaction as nabvy_app or nabvy_pipeline, the way withUser and withPipeline do. The full set,
// including apify-gateway, runs on real Postgres in `pnpm db:dry-run`
// (packages/db/tests/listing-feedback.test.sql).

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
  /** Runs `fn` in one transaction as `role`; with `userId`, as withUser does. */
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>, userId?: string): Promise<T>
  /** Runs SQL as the migration superuser. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

const SUPABASE_STUBS = fileURLToPath(
  new URL('../../../../supabase/tests/supabase-stubs.sql', import.meta.url),
)

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [
    SUPABASE_STUBS,
    ...migrationFiles('core'),
    ...migrationFiles('audit-log'),
    ...migrationFiles('switches'),
    ...migrationFiles('better-auth'),
    ...migrationFiles('listing-ingest'),
    ...migrationFiles('detail-evidence'),
    ...migrationFiles('listing-suppression'),
    ...migrationFiles('listing-feedback'),
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
    close: () => pg.close(),
  }
}

/** Registers a user in better_auth, the way better_auth.account_active() needs to find them. */
export async function seedUser(db: TestDatabase, userId: string, email: string): Promise<void> {
  await db.sql(
    `insert into better_auth."user" (id, name, email) values ($1, $2, $3)
     on conflict (id) do nothing`,
    [userId, email, email],
  )
}

export async function setSwitches(
  db: TestDatabase,
  states: Record<string, 'off' | 'shadow' | 'on'>,
): Promise<void> {
  for (const [name, value] of Object.entries(states)) {
    await db.sql(
      `insert into switches.switches (name, kind, state) values ($1, 'module', $2)
       on conflict (name) do update set state = excluded.state`,
      [name, value],
    )
  }
}

export const ALL_ON = {
  'listing-ingest': 'on',
  'detail-evidence': 'on',
  'listing-suppression': 'on',
  'listing-feedback': 'on',
} as const

/**
 * Inserts a bare listing-ingest identity directly (no apify-gateway job behind it): enough for
 * `listing_suppression.is_suppressed()` to resolve a named-listing hash, without replaying a
 * collected run. Returns the listing-ingest ID.
 */
export async function seedListing(
  db: TestDatabase,
  input: { source?: string; sourceListingId: string; title?: string },
): Promise<string> {
  const source = input.source ?? 'facebook'
  const [row] = await db.sql(
    `insert into listing_ingest.listings
       (source, source_listing_id, card_hash, title, first_fetched_at, last_seen_at,
        availability, item_job_id, item_seq)
     values ($1, $2, repeat('0', 64), $3, now(), now(), 'live', 0, 0)
     returning id::text as id`,
    [source, input.sourceListingId, input.title ?? 'A listing'],
  )
  if (!row) throw new Error('seedListing: insert returned no row')
  return String(row.id)
}

/** Records a suppression request naming this listing by source and source listing ID. */
export async function suppressListing(
  db: TestDatabase,
  requestId: string,
  source: string,
  sourceListingId: string,
): Promise<void> {
  await db.sql(
    `insert into listing_suppression.entries (request_id, kind, value) values ($1, 'listing_hash', $2)
     on conflict do nothing`,
    [requestId, listingHash(source, sourceListingId)],
  )
}
