import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, audit-log, switches,
// cost-meter, apify-gateway, listing-ingest, run-coverage and this module. Used as
// nabvy_pipeline, the role the module runs as. PGlite has no pg_net, PostGIS, pgvector or
// pg_trgm, so `create extension` lines are skipped; the full set runs in `pnpm db:dry-run`
// (packages/db/tests/city-pages.test.sql).

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
    'run-coverage',
    'city-pages',
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Sets switches the way an admin would. */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  /**
   * Stores a run-coverage search outcome directly (bypassing the handler, which this module does
   * not call): the minimum a `verify()` test needs — status, kind and the reported controls.
   */
  searchOutcome(row: {
    jobId: number
    searchIndex: number
    centreId: string
    kind: 'newest' | 'sweep'
    status: 'complete' | 'capped' | 'degraded'
    controlLatitude?: number | null
    controlLongitude?: number | null
  }): Promise<void>
  /**
   * Stores a listing-ingest listing directly (bypassing `ingest`, which this module does not
   * call): the minimum `v_city_pages_seen` needs — a city page and a town label.
   */
  seenListing(row: {
    sourceListingId: string
    cityPageId: string
    townLabel: string | null
  }): Promise<void>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  await pg.exec('set role nabvy_pipeline')
  const asOwner = async (query: string, params: unknown[] = []) => {
    await pg.exec('reset role')
    try {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
    } finally {
      await pg.exec('set role nabvy_pipeline')
    }
  }
  return {
    db: drizzle(pg) as unknown as Queryable,
    sql: asOwner,
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
    async searchOutcome(row) {
      await asOwner(
        `insert into run_coverage.search_outcomes
           (job_id, search_index, centre_id, term, kind, route, stop_reason, listings, status,
            control_latitude, control_longitude, collected_at)
         values ($1, $2, $3, 'test', $4, 'http',
           case when $5 = 'complete' then 'source-no-new-listings' else 'page-cap' end,
           1, $5, $6, $7, now())`,
        [
          row.jobId,
          row.searchIndex,
          row.centreId,
          row.kind,
          row.status,
          row.controlLatitude ?? null,
          row.controlLongitude ?? null,
        ],
      )
    },
    async seenListing(row) {
      const cardHash = createHash('sha256').update(row.sourceListingId).digest('hex')
      await asOwner(
        `insert into listing_ingest.listings
           (source, source_listing_id, card_hash, title, first_fetched_at, last_seen_at,
            city_page_id, town_label, availability, item_job_id, item_seq)
         values ('facebook', $1, $4, 'Test listing', now(), now(), $2, $3, 'live', 1, 0)`,
        [row.sourceListingId, row.cityPageId, row.townLabel, cardHash],
      )
    },
    close: () => pg.close(),
  }
}

/** Every switch this module (and its hard dependencies) reads, on. */
export const ALL_ON = {
  'city-pages': 'on',
  'listing-ingest': 'on',
  'run-coverage': 'on',
  pipeline: 'on',
} as const
