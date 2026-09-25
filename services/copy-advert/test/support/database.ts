import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { reconcileSeen } from '@nabvy/city-pages'
import type { Queryable } from '@nabvy/db'
import { record } from '@nabvy/detail-evidence'
import { ingest } from '@nabvy/listing-ingest'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, switches, cost-meter,
// apify-gateway, listing-ingest, detail-evidence, city-pages, listing-suppression and this module.
// Built like listing-suppression's test support. Used as nabvy_pipeline, the role the module runs
// as. PGlite has no pg_net, PostGIS or pgvector, so those `create extension` lines are skipped;
// unlike every other acquisition module's test support, this one *does* need pg_trgm (S3/S5's
// near-duplicate and text-copy detection), so it is loaded as a PGlite contrib extension and its
// own `create extension` line is kept. The full migration set, with the real extensions, runs on
// real Postgres in `pnpm db:dry-run` (packages/db/tests/copy-advert.test.sql).

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
    'detail-evidence',
    'city-pages',
    'listing-suppression',
    'copy-advert',
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

type Json = Record<string, unknown>

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_app. */
  asApp(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_pipeline. */
  asPipeline(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /**
   * Runs `fn` with a Drizzle `Queryable` as `nabvy_app`, with `app.user_id` set (as `withUser`
   * does), so row-level security applies. For calling exported functions such as `report()` that
   * are meant to run inside `withUser`, not as the pipeline role.
   */
  asAppQuery<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>
  /** Sets switches the way an admin would. */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  /** Stores a collected job the way the gateway leaves one. Returns the job ID. */
  collected(run: RecordedRun, rows?: Json[]): Promise<number>
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
  const pg = new PGlite({ extensions: { pg_trgm } })
  // `alter role ... set search_path` (core migration) only takes effect on a real login as that
  // role; this harness emulates roles with `set role` on one shared connection, which does not
  // reapply it, so pg_trgm's `%` operator (in the `extensions` schema) would not resolve unless
  // set explicitly here, once, for the session (unaffected by later `set role`/`reset role`).
  await pg.exec('set search_path = "$user", public, extensions')
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line) || /pg_trgm/i.test(line))
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
    async asApp(query, params = []) {
      await pg.exec('set role nabvy_app')
      try {
        return (await pg.query<Record<string, unknown>>(query, params)).rows
      } finally {
        await pg.exec('set role nabvy_pipeline')
      }
    },
    asPipeline: async (query, params = []) =>
      (await pg.query<Record<string, unknown>>(query, params)).rows,
    async asAppQuery(userId, fn) {
      await pg.exec('set role nabvy_app')
      await pg.query(`select set_config('app.user_id', $1, false)`, [userId])
      try {
        return await fn(drizzle(pg) as unknown as Queryable)
      } finally {
        await pg.query(`select set_config('app.user_id', '', false)`)
        await pg.exec('set role nabvy_pipeline')
      }
    },
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

/** Every switch this module and its hard dependencies need, on. */
export const ALL_ON = {
  'apify-gateway': 'on',
  apify: 'on',
  pipeline: 'on',
  'listing-ingest': 'on',
  'detail-evidence': 'on',
  'city-pages': 'on',
  'listing-suppression': 'on',
  'copy-advert': 'on',
} as const

/**
 * Stores rows as a collected job, lets listing-ingest ingest it, detail-evidence record it and
 * city-pages reconcile any new city page, as the live pipeline does. Returns the job ID and the
 * listing IDs the run introduced or touched.
 */
export async function collectedAndRecorded(
  t: TestDatabase,
  recorded: RecordedRun,
  rows: Json[] = recorded.dataset,
): Promise<{ jobId: number; listingIds: string[] }> {
  const jobId = await t.collected(recorded, rows)
  const ingested = await ingest(t.db, { jobId, kind: 'search' })
  if (!ingested.ok) throw new Error(ingested.error.message)
  const details = await record(t.db, { jobId })
  if (!details.ok) throw new Error(details.error.message)
  await reconcileSeen(t.db)
  const listingIds = [
    ...new Set([
      ...ingested.value.firstSeen,
      ...ingested.value.cardChanged,
      ...details.value.changed,
    ]),
  ]
  return { jobId, listingIds }
}

/** listing-ingest's listing ID of a source listing ID. */
export async function listingIdOf(t: TestDatabase, sourceListingId: string): Promise<string> {
  const [row] = await t.asPipeline(
    `select id::text as id from listing_ingest.v_listings
     where source = 'facebook' and source_listing_id = $1`,
    [sourceListingId],
  )
  if (!row) throw new Error(`listing ${sourceListingId} is not ingested`)
  return String(row.id)
}

/** A deep copy of rows with one listing's fields replaced (synthetic edits). */
export function withFields(rows: Json[], listingId: string, fields: Json): Json[] {
  return rows.map((row) => (String(row.listingId) === listingId ? { ...row, ...fields } : row))
}

/**
 * A deep copy of `row` as a new listing ID in a different city page and town (a synthetic copy
 * advert, posted again). `location` sets both the town label listing-ingest reads (`row.location`)
 * and the reverse-geocoded city page's display name.
 */
export function duplicateListing(
  row: Json,
  input: { listingId: string; cityPageId: string; location: string; listedAt?: number },
): Json {
  const clone = structuredClone(row) as Json & {
    sourceFields?: { search?: { location?: { reverse_geocode?: { city_page?: Json } } } }
  }
  clone.listingId = Number(input.listingId)
  clone.location = input.location
  if (input.listedAt !== undefined) clone.listedAt = input.listedAt
  const cityPage = clone.sourceFields?.search?.location?.reverse_geocode?.city_page
  if (cityPage) {
    cityPage.id = input.cityPageId
    cityPage.display_name = input.location
  }
  return clone
}
