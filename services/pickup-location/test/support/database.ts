import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { record } from '@nabvy/detail-evidence'
import { ingest } from '@nabvy/listing-ingest'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, audit-log, switches,
// cost-meter, apify-gateway, listing-ingest, detail-evidence, run-coverage, city-pages,
// location, listing-suppression and this module. Built like parts-rules' test support. Used as
// nabvy_pipeline, the role the module runs as. PGlite has no pg_net, PostGIS, pgvector or
// pg_trgm, so `create extension` lines are skipped (the full set runs on real Postgres in
// `pnpm db:dry-run`).

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

type Json = Record<string, unknown>

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
  /**
   * Stores a collected job the way the gateway leaves one: a succeeded `collect` job with its run
   * object, item count and RUN_SUMMARY, and every row. Returns the job ID.
   */
  collected(run: RecordedRun, rows?: Json[]): Promise<number>
  close(): Promise<void>
}

export interface RecordedRun {
  apifyRunId: string
  run: Json
  dataset: Json[]
  runSummary: Json
}

export interface SyntheticPage {
  cityPageId: string
  name: string
  towns?: string[]
  lat?: number
  lng?: number
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
    async collected(recorded, rows = recorded.dataset) {
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

/**
 * Stores rows as a collected job, lets listing-ingest ingest it and detail-evidence record it, as
 * the live pipeline does before `detail-evidence.changed` reaches this module. Returns the listing
 * IDs the `changed` event carries.
 */
export async function detailed(
  t: TestDatabase,
  recorded: RecordedRun,
  rows: Json[] = recorded.dataset,
): Promise<string[]> {
  const jobId = await t.collected(recorded, rows)
  const ingested = await ingest(t.db, { jobId, kind: 'search' })
  if (!ingested.ok) throw new Error(ingested.error.message)
  const recordedJob = await record(t.db, { jobId })
  if (!recordedJob.ok) throw new Error(recordedJob.error.message)
  return recordedJob.value.changed
}

/** The listing ID of each source listing ID, from listing-ingest's view. */
export async function listingIdsBySource(t: TestDatabase): Promise<Map<string, string>> {
  const rows = await t.asPipeline('select id, source_listing_id from listing_ingest.v_listings')
  return new Map(rows.map((r) => [r.source_listing_id as string, r.id as string]))
}

/** A deep copy of rows with one listing's fields replaced (synthetic edits). */
export function withFields(rows: Json[], listingId: string, fields: Json): Json[] {
  return rows.map((row) => (row.listingId === listingId ? { ...row, ...fields } : row))
}

/**
 * A synthetic listing row built from the recorded run's first listing (`"synthetic": true` in
 * the case's input): its title, description, location text, city page and coordinates replaced.
 * The city page is set where listing-ingest reads it (sourceFields.search.location.reverse_geocode
 * .city_page.id) and the coordinates where detail-evidence reads them (locationCoordinates).
 */
export function syntheticListing(
  base: Json,
  fields: {
    listingId: string
    title: string
    description: string | null
    location: string | null
    cityPageId: string | null
    coordinates?: { latitude: number; longitude: number } | null
    deliveryTypes?: string[]
  },
): Json {
  const search = ((base.sourceFields as Json | undefined)?.search as Json | undefined) ?? {}
  const reverse = fields.cityPageId
    ? {
        reverse_geocode: { city: fields.location, state: '', city_page: { id: fields.cityPageId } },
      }
    : null
  return {
    ...base,
    listingId: fields.listingId,
    title: fields.title,
    description: fields.description,
    descriptionStatus: fields.description ? 'full_verified' : 'none',
    descriptionComplete: fields.description !== null,
    location: fields.location,
    deliveryTypes: fields.deliveryTypes ?? ['IN_PERSON'],
    conflicts: [],
    locationCoordinates: fields.coordinates ? { ...fields.coordinates, precision: 'coarse' } : null,
    locationDetails: reverse ?? null,
    sourceFields: {
      ...(base.sourceFields as Json),
      search: { ...search, location: reverse ?? { reverse_geocode: { city: fields.location } } },
    },
  }
}
