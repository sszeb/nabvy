import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { LocationPoint } from '@nabvy/contracts/modules/location'
import type { Queryable } from '@nabvy/db'
import { listingHash } from '@nabvy/listing-suppression'
import { drizzle } from 'drizzle-orm/pglite'
import { defaultDeps, type SellerReplyReportsDeps } from '../../src/index'

// An in-process Postgres (PGlite) with the real migrations of every module this module reads or
// whose functions its SQL calls: core, audit-log, switches, better-auth and account (standing and
// profiles), listing-ingest and detail-evidence (what listing_suppression.is_suppressed() joins
// against), listing-suppression, listing-feedback (v_bought_for_reports), then this module.
// copy-advert, pickup-location and city-pages are read through injected deps here (`testDeps`);
// the full set runs on real Postgres in `pnpm db:dry-run`
// (packages/db/tests/seller-reply-reports.test.sql).

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))
const SUPABASE_STUBS = fileURLToPath(
  new URL('../../../../supabase/tests/supabase-stubs.sql', import.meta.url),
)

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

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [
    SUPABASE_STUBS,
    ...migrationFiles('core'),
    ...migrationFiles('audit-log'),
    ...migrationFiles('switches'),
    ...migrationFiles('better-auth'),
    ...migrationFiles('account'),
    ...migrationFiles('listing-ingest'),
    ...migrationFiles('detail-evidence'),
    ...migrationFiles('listing-suppression'),
    ...migrationFiles('listing-feedback'),
    ...migrationFiles('seller-reply-reports'),
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
  account: 'on',
  'seller-reply-reports': 'on',
} as const

/** A better_auth user (for account_active) with an account profile created `ageDays` before `now`. */
export async function seedUser(
  db: TestDatabase,
  userId: string,
  ageDays: number,
  now: Date,
): Promise<void> {
  await db.sql(
    `insert into better_auth."user" (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`,
    [userId, userId, `${userId}@example.com`],
  )
  await db.sql(
    `insert into account.user_profiles (user_id, created_at) values ($1, $2::timestamptz - make_interval(days => $3))
     on conflict (user_id) do update set created_at = excluded.created_at`,
    [userId, now.toISOString(), ageDays],
  )
}

/** A bare listing-ingest identity (no gateway job behind it); returns its ID. */
export async function seedListing(db: TestDatabase, sourceListingId: string): Promise<string> {
  const [row] = await db.sql(
    `insert into listing_ingest.listings
       (source, source_listing_id, card_hash, title, first_fetched_at, last_seen_at, availability, item_job_id, item_seq)
     values ('facebook', $1, repeat('0', 64), 'A listing', now(), now(), 'live', 0, 0)
     returning id::text as id`,
    [sourceListingId],
  )
  if (!row) throw new Error('seedListing: no row')
  return String(row.id)
}

export async function suppressListing(db: TestDatabase, sourceListingId: string): Promise<void> {
  await db.sql(
    `insert into listing_suppression.entries (request_id, kind, value) values (nabvy_core.uuidv7(), 'listing_hash', $1)`,
    [listingHash('facebook', sourceListingId)],
  )
}

export interface SeedReason {
  reason: string
  detail?: string | null
  secondAnswer?: string | null
  placeId?: string | null
}

/** Inserts a report as the migration superuser (the aggregator's input, bypassing the gate). */
export async function seedReport(
  db: TestDatabase,
  input: {
    listingId: string
    userId: string
    createdAt: Date
    reasons: SeedReason[]
    shippingOffered?: boolean | null
    withdrawnAt?: Date | null
  },
): Promise<string> {
  const [row] = await db.sql(
    `insert into seller_reply_reports.reports
       (source, listing_id, reporter_user_id, listing_shipping_offered, rule_version, created_at, withdrawn_at, status)
     values ('facebook', $1, $2, $3, 'seller-reply-reports@1', $4, $5, case when $5::timestamptz is null then 'saved' else 'withdrawn' end)
     returning id::text as id`,
    [
      input.listingId,
      input.userId,
      input.shippingOffered ?? null,
      input.createdAt.toISOString(),
      input.withdrawnAt?.toISOString() ?? null,
    ],
  )
  const id = String(row?.id)
  for (const r of input.reasons) {
    await db.sql(
      `insert into seller_reply_reports.report_reasons (report_id, reason, detail, second_answer, reported_place_id)
       values ($1, $2, $3, $4, $5)`,
      [id, r.reason, r.detail ?? null, r.secondAnswer ?? null, r.placeId ?? null],
    )
  }
  return id
}

/** Deps for tests: verified emails, and clusters, points and places from plain maps. */
export function testDeps(
  overrides: {
    unverified?: string[]
    groups?: Record<string, string>
    clusters?: Array<{ key: string; members: string[] }>
    originals?: string[]
    listingPoints?: Record<string, LocationPoint>
    placePoints?: Record<string, LocationPoint>
    gems?: string[]
    faults?: string[]
    opens?: Record<string, Date>
    flags?: Record<string, { messagingEnabled: boolean | null; shippingOffered: boolean | null }>
  } = {},
): SellerReplyReportsDeps {
  return {
    ...defaultDeps,
    async openRecords(_q, _userId, listingIds) {
      const out = new Map()
      for (const id of listingIds) {
        const at = overrides.opens?.[id]
        if (at) out.set(id, { openVia: 'alert', firstOpenedAt: at })
      }
      return out
    },
    async listingFlags(_q, listingIds) {
      const out = new Map()
      for (const id of listingIds) {
        const f = overrides.flags?.[id]
        if (f) out.set(id, { ...f, checkoutEnabled: null, cardHash: null, evidenceHash: null })
      }
      return out
    },
    async reporterAccounts(q, userIds) {
      const facts = await defaultDeps.reporterAccounts(q, userIds)
      return new Map(
        [...facts].map(([id, f]) => [
          id,
          { ...f, emailVerified: !(overrides.unverified ?? []).includes(id) },
        ]),
      )
    },
    linkedGroupOf: async (_q, userIds) =>
      new Map(userIds.map((id) => [id, overrides.groups?.[id] ?? id])),
    async clusters(_q, listingIds) {
      const out = new Map()
      for (const c of overrides.clusters ?? []) {
        if (!c.members.some((m) => listingIds.includes(m))) continue
        for (const m of c.members)
          out.set(m, {
            clusterKey: c.key,
            memberSetHash: `h-${c.members.length}`,
            members: c.members,
          })
      }
      return out
    },
    possibleOriginals: async () => new Set(overrides.originals ?? []),
    listingPoints: async () => new Map(Object.entries(overrides.listingPoints ?? {})),
    placePoints: async () => new Map(Object.entries(overrides.placePoints ?? {})),
    gemCandidates: async () => new Set(overrides.gems ?? []),
    itemFaultStated: async () => new Set(overrides.faults ?? []),
    firstFetchedAt: async () => new Map(),
  }
}

export async function evidence(db: TestDatabase, listingId?: string) {
  return db.sql(
    `select listing_id::text as listing_id, family, scope, persons, weight_sum::float as weight_sum,
       counter_weight::float as counter_weight, level, place_id, distance_band, held, hold_reason
     from seller_reply_reports.listing_evidence ${listingId ? 'where listing_id = $1' : ''}
     order by listing_id, family, scope`,
    listingId ? [listingId] : [],
  )
}

export const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000)
export const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000)
