import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { reconcileSeen } from '@nabvy/city-pages'
import type { Queryable } from '@nabvy/db'
import { ingest } from '@nabvy/listing-ingest'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, switches, cost-meter,
// apify-gateway, listing-ingest, city-pages, details-queue and this module. Built like
// relist-merge's test support. Used as nabvy_pipeline, the role the module runs as. PGlite has no
// pg_net, PostGIS, pgvector or pg_trgm, so `create extension` lines are skipped; the full set runs
// in `pnpm db:dry-run`.

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
    'switches',
    'cost-meter',
    'apify-gateway',
    'listing-ingest',
    'city-pages',
    'details-queue',
    'details-selector',
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

export type Json = Record<string, unknown>

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_pipeline. */
  asPipeline(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Sets switches the way an admin would. */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  /** Stores rows as a succeeded, collected gateway job. Returns the job ID. */
  collected(run: RecordedRun, rows: Json[]): Promise<number>
  close(): Promise<void>
}

export interface RecordedRun {
  apifyRunId: string
  run: Json
  dataset: Json[]
  runSummary: Json
}

const FIXTURES = new URL('../../../../fixtures/listings/', import.meta.url)
const read = (path: string) => JSON.parse(readFileSync(new URL(path, FIXTURES), 'utf8'))

/** A recorded run, e.g. `facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`. */
export function loadRun(run: string): RecordedRun {
  const meta = read(`${run}/run.json`)
  return {
    apifyRunId: meta.apifyRunId,
    run: meta.run,
    dataset: read(`${run}/dataset.json`),
    runSummary: read(`${run}/run-summary.json`),
  }
}

export const RECORDED = 'facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k'

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
    asPipeline: async (query, params = []) =>
      (await pg.query<Record<string, unknown>>(query, params)).rows,
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
    async collected(recorded, rows) {
      const [job] = await asOwner(
        `insert into apify_gateway.jobs (kind, input, status, apify_run_id, result)
         values ('collect', $1::jsonb, 'succeeded', $2, $3::jsonb) returning id`,
        [
          JSON.stringify({ apifyRunId: recorded.apifyRunId }),
          recorded.apifyRunId,
          JSON.stringify({
            ...recorded.run,
            id: recorded.apifyRunId,
            itemCount: rows.length,
            runSummary: recorded.runSummary,
          }),
        ],
      )
      const jobId = Number(job?.id)
      await asOwner(
        `insert into apify_gateway.items (job_id, seq, item)
         select $1, (ord - 1)::integer, value
         from jsonb_array_elements($2::jsonb) with ordinality as t (value, ord)`,
        [jobId, JSON.stringify(rows)],
      )
      return jobId
    },
    close: () => pg.close(),
  }
}

/** Every switch the module reads, and its upstream modules' (so their views show rows), on. */
export const ALL_ON = {
  'apify-gateway': 'on',
  apify: 'on',
  pipeline: 'on',
  'listing-ingest': 'on',
  'city-pages': 'on',
  'details-queue': 'on',
  'details-selector': 'on',
} as const

/**
 * Runs rows through the live pipeline's upstream stages: stored as a collected job, ingested by
 * listing-ingest, then reconciled by city-pages (so a listing's city page has an area-membership
 * row once it is a known page). Returns the listing IDs of the rows, in the rows' order.
 */
export async function upstream(t: TestDatabase, recorded: RecordedRun, rows: Json[]) {
  const jobId = await t.collected(recorded, rows)
  const ingested = await ingest(t.db, { jobId, kind: 'search' })
  if (!ingested.ok) throw new Error(ingested.error.message)
  await reconcileSeen(t.db)
  return listingIdsOf(
    t,
    rows.map((row) => String(row.listingId)),
  )
}

/** listing-ingest's listing UUIDs for these source IDs, in the same order. */
export async function listingIdsOf(t: TestDatabase, sourceIds: string[]): Promise<string[]> {
  const rows = await t.sql(
    `select id, source_listing_id from listing_ingest.listings where source_listing_id = any($1)`,
    [sourceIds],
  )
  const idOf = new Map(rows.map((row) => [String(row.source_listing_id), String(row.id)]))
  return sourceIds.flatMap((id) => (idOf.has(id) ? [idOf.get(id) as string] : []))
}

/** The recorded run's listing rows. */
export const listingRows = (recorded: RecordedRun) =>
  recorded.dataset.filter((row) => row.recordType === 'listing')

/**
 * Armagh: a seeded city page with its own coordinate (54.3192, -6.6193), about 54 km from
 * Belfast's centre (109312942421526, reported at 54.597, -5.93), inside its 100 km `area_km`. A
 * verified centre's own city page has no coordinate of its own in the seed (only its `centres`
 * row does), so a page like this, not the centre itself, is what "in area" needs.
 */
export const IN_AREA_CITY_PAGE_ID = '105718279462647'

/** A city page never in the seed: card-added with no coordinate, so it can never be "in area". */
export const UNKNOWN_CITY_PAGE_ID = '9999999999999999'

/** Points a recorded row's reverse-geocoded city page at a different ID (as relist-merge's tests do). */
export function withCityPage(row: Json, cityPageId: string, displayName = 'Test'): Json {
  const copy = structuredClone(row)
  const location = ((copy.sourceFields as Json).search as Json).location as Json
  ;(location.reverse_geocode as Json).city_page = { id: cityPageId, display_name: displayName }
  return copy
}

/** Overrides a recorded row's category. `null` clears it (an unknown category). */
export function withCategory(row: Json, categoryId: string | null): Json {
  return { ...structuredClone(row), categoryId }
}

/** Overrides a recorded row's title. */
export function withTitle(row: Json, title: string): Json {
  return { ...structuredClone(row), title }
}

/** Overrides a recorded row's delivery types (`deliveryTypes`, the actor's raw field). */
export function withDeliveryTypes(row: Json, deliveryTypes: string[]): Json {
  return { ...structuredClone(row), deliveryTypes }
}

/** Overrides a recorded row's Facebook listing ID, so several test rows never collide. */
export function withListingId(row: Json, listingId: string): Json {
  const copy = structuredClone(row) as Json
  copy.listingId = listingId
  copy.url = `https://www.facebook.com/marketplace/item/${listingId}/`
  copy.listingUrl = `https://www.facebook.com/marketplace/item/${listingId}/`
  return copy
}
