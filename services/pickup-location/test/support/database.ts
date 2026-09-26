import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, audit-log, switches,
// cost-meter, apify-gateway, listing-ingest, detail-evidence, run-coverage, city-pages,
// location, listing-suppression and this module. Used as nabvy_pipeline, the role the module
// runs as. Synthetic listings are written straight into listing-ingest's and detail-evidence's
// tables as the migration superuser (the shape packages/db/tests/listing-suppression.test.sql
// uses), never through the gateway: this module reads those modules' views only. PGlite has no
// pg_net, PostGIS, pgvector or pg_trgm, so `create extension` lines are skipped (the full set
// runs on real Postgres in `pnpm db:dry-run`).

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const sqlIn = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(root, dir, name))

const FILES = [
  join(root, 'supabase/tests/supabase-stubs.sql'),
  ...sqlIn('supabase/migrations'),
  ...[
    'core',
    'audit-log',
    'switches',
    'cost-meter',
    'apify-gateway',
    'listing-ingest',
    'detail-evidence',
    'run-coverage',
    'city-pages',
    'location',
    'listing-suppression',
    'pickup-location',
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_pipeline. */
  asPipeline(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_app (the web app's role), then returns to the pipeline role. */
  asApp(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Sets switches the way an admin would. */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  /** Stores city pages the way city-pages leaves them (the gazetteer this module reads). */
  cityPages(pages: SyntheticPage[]): Promise<void>
  close(): Promise<void>
}

export interface SyntheticPage {
  cityPageId: string
  name: string
  towns?: string[]
  lat?: number
  lng?: number
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  await pg.exec(`create schema if not exists extensions;
    grant usage on schema extensions to public;`)
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  await pg.exec('set role nabvy_pipeline')
  const asRole = async (role: string, query: string, params: unknown[] = []) => {
    await pg.exec('reset role')
    if (role !== 'postgres') await pg.exec(`set role ${role}`)
    try {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
    } finally {
      await pg.exec('reset role')
      await pg.exec('set role nabvy_pipeline')
    }
  }
  const asOwner = (query: string, params: unknown[] = []) => asRole('postgres', query, params)
  return {
    db: drizzle(pg) as unknown as Queryable,
    sql: asOwner,
    asPipeline: async (query, params = []) =>
      (await pg.query<Record<string, unknown>>(query, params)).rows,
    asApp: (query, params = []) => asRole('nabvy_app', query, params),
    async switches(states) {
      for (const [name, value] of Object.entries(states)) {
        await asOwner(
          `insert into switches.switches (name, kind, state)
           values ($1, case when $1 in ('apify', 'anthropic', 'ebay', 'cex') then 'provider'
                            when $1 = 'pipeline' then 'global' else 'module' end, $2)
           on conflict (name) do update set state = excluded.state`,
          [name, value],
        )
      }
    },
    async cityPages(pages) {
      for (const p of pages) {
        await asOwner(
          `insert into city_pages.city_pages (city_page_id, name, towns, lat, lng, coord_source, first_seen_at)
           values ($1, $2, $3::text[], $4, $5, 'seed', now())
           on conflict (city_page_id) do update
             set name = excluded.name, towns = excluded.towns, lat = excluded.lat, lng = excluded.lng`,
          [p.cityPageId, p.name, p.towns ?? [], p.lat ?? null, p.lng ?? null],
        )
      }
    },
    close: () => pg.close(),
  }
}

/** Every switch the module reads, and those of the modules whose views it reads, on. */
export const ALL_ON = {
  'apify-gateway': 'on',
  apify: 'on',
  pipeline: 'on',
  'listing-ingest': 'on',
  'detail-evidence': 'on',
  'city-pages': 'on',
  location: 'on',
  'listing-suppression': 'on',
  'pickup-location': 'on',
} as const

/** A synthetic listing: what listing-ingest and detail-evidence would hold for it. */
export interface SyntheticListing {
  listingId: string
  title: string
  description: string | null
  location: string | null
  cityPageId: string | null
  coordinates?: { latitude: number; longitude: number } | null
  deliveryTypes?: string[]
  /** The collection time of this version; a later one is a newer version of the same listing. */
  collectedAt?: string
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
let nextJobId = 1000

/**
 * Stores synthetic listings the way the live pipeline leaves them before
 * `detail-evidence.changed` reaches this module: one listing-ingest row per listing (kept on a
 * second call), and one evidence row and one fetch per version (the evidence hash is the title
 * and description hashed, as detail-evidence's own key is; a later `collectedAt` is a newer
 * version). Returns the listing IDs the `changed` event carries, in the order given.
 */
export async function detailed(t: TestDatabase, listings: SyntheticListing[]): Promise<string[]> {
  const ids: string[] = []
  for (const [i, l] of listings.entries()) {
    const at = l.collectedAt ?? '2026-09-24T01:40:00.000Z'
    const jobId = nextJobId++
    const cardHash = sha256(`card:${l.listingId}:${l.title}`)
    const evidenceHash = sha256(`${l.title}\n${l.description ?? ''}`)
    const [row] = await t.sql(
      `insert into listing_ingest.listings (source, source_listing_id, card_hash, price_minor,
         currency, title, first_fetched_at, last_seen_at, city_page_id, town_label,
         delivery_types, availability, item_job_id, item_seq)
       values ('facebook', $1, $2, 20000, 'GBP', $3, $4, $4, $5, $6, $7::text[], 'live', 1, $8)
       on conflict (source, source_listing_id) do update set last_seen_at = excluded.last_seen_at
       returning id`,
      [
        l.listingId,
        cardHash,
        l.title,
        at,
        l.cityPageId,
        l.location,
        l.deliveryTypes ?? ['IN_PERSON'],
        i,
      ],
    )
    const id = String(row?.id)
    ids.push(id)
    await t.sql(
      `insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
         first_seen_at, last_seen_at, item_job_id, item_seq, title, description,
         description_status, lat, lng)
       values ('facebook', $1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict do nothing`,
      [
        l.listingId,
        id,
        evidenceHash,
        at,
        jobId,
        0,
        l.title,
        l.description,
        l.description ? 'full_verified' : 'missing',
        l.coordinates?.latitude ?? null,
        l.coordinates?.longitude ?? null,
      ],
    )
    await t.sql(
      `insert into detail_evidence.fetches (source, source_listing_id, listing_id, job_id, seq,
         fetched_at, detail_outcome, description_status, evidence_hash)
       values ('facebook', $1, $2, $3, $4, $5, 'collected', $6, $7)`,
      [l.listingId, id, jobId, 0, at, l.description ? 'full_verified' : 'missing', evidenceHash],
    )
  }
  return ids
}
