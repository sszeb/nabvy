import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'
import type { PastedLinkLookupPorts } from '../../src/index'

// An in-process Postgres (PGlite) with the real migrations of every module this module's reads
// and writes touch: core, audit-log, switches, better-auth (account standing, through
// @nabvy/account's isActive), listing-ingest, detail-evidence, listing-lifecycle,
// listing-suppression and quote-redaction (what app.v_listing_card reads), listing-card (the view
// itself), details-queue (the real enqueue, when a test wants it) and then pasted-link-lookup.
// Built like listing-feedback's test support: `as(role, fn, userId)` runs a transaction as
// nabvy_app or nabvy_pipeline, the way withUser and withPipeline do. The full set, including
// apify-gateway, runs on real Postgres in `pnpm db:dry-run`
// (packages/db/tests/pasted-link-lookup.test.sql).

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
    ...migrationFiles('listing-lifecycle'),
    ...migrationFiles('listing-suppression'),
    ...migrationFiles('quote-redaction'),
    ...migrationFiles('listing-card'),
    ...migrationFiles('details-queue'),
    ...migrationFiles('pasted-link-lookup'),
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

/** Everything app.v_listing_card needs on, plus this module and the details queue. */
export const ALL_ON = {
  pipeline: 'on',
  'listing-ingest': 'on',
  'detail-evidence': 'on',
  'listing-lifecycle': 'on',
  'listing-suppression': 'on',
  'quote-redaction': 'on',
  'listing-card': 'on',
  'details-queue': 'on',
  'pasted-link-lookup': 'on',
} as const

/**
 * Inserts a bare listing-ingest identity directly (no apify-gateway job behind it): enough for
 * app.v_listing_card to show the listing (without details). Returns the listing-ingest ID.
 */
export async function seedListing(
  db: TestDatabase,
  input: { sourceListingId: string; title?: string },
): Promise<string> {
  const [row] = await db.sql(
    `insert into listing_ingest.listings
       (source, source_listing_id, card_hash, price_minor, currency, title, first_fetched_at,
        last_seen_at, town_label, availability, item_job_id, item_seq)
     values ('facebook', $1, repeat('a', 64), 12000, 'GBP', $2, now(), now(), 'Chichester',
        'live', 1, 0)
     returning id`,
    [input.sourceListingId, input.title ?? 'A listing'],
  )
  return row?.id as string
}

/** Inserts a detail-evidence row for a seeded listing, so its card shows a description status. */
export async function seedDetail(
  db: TestDatabase,
  input: { listingId: string; sourceListingId: string },
): Promise<void> {
  await db.sql(
    `insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
       first_seen_at, last_seen_at, item_job_id, item_seq, title, description_status, condition,
       stale_fallback)
     values ('facebook', $1, $2, repeat('b', 64), now(), now(), 1, 0, 'A listing', 'full_verified',
       'used_good', false)`,
    [input.sourceListingId, input.listingId],
  )
  await db.sql(
    `insert into detail_evidence.fetches (source, source_listing_id, listing_id, job_id, seq,
       fetched_at, detail_outcome, description_status, stale_fallback, evidence_hash)
     values ('facebook', $1, $2, 1, 0, now(), 'collected', 'full_verified', false, repeat('b', 64))`,
    [input.sourceListingId, input.listingId],
  )
}

/** Ports that record every enqueue and answer readQueue from a fixed list. */
export function recordingPorts(
  queue: { sourceListingId: string; lane: 'text' | 'photo'; status: string }[] = [],
): PastedLinkLookupPorts & { enqueued: string[][] } {
  const enqueued: string[][] = []
  return {
    enqueued,
    async enqueue(_q, request) {
      enqueued.push([...request.sourceListingIds])
      return { queued: request.sourceListingIds.length, alreadyQueued: 0, skipped: 0 }
    },
    async readQueue(_q, sourceListingIds) {
      return queue
        .filter((item) => sourceListingIds.includes(item.sourceListingId))
        .map((item) => ({ ...item, status: item.status as 'failed' }))
    },
  }
}
