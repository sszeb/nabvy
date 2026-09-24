import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { record } from '@nabvy/detail-evidence'
import { ingest } from '@nabvy/listing-ingest'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, switches, cost-meter,
// apify-gateway, listing-ingest, detail-evidence and this module. Built like detail-evidence's
// test support. Used as nabvy_pipeline, the role the module runs as. PGlite has no pg_net,
// PostGIS, pgvector or pg_trgm, so `create extension` lines are skipped; the full set runs in
// `pnpm db:dry-run`.

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
    'relist-merge',
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
  'detail-evidence': 'on',
  'relist-merge': 'on',
} as const

/**
 * Runs rows through the live pipeline's upstream stages: stored as a collected job, ingested by
 * listing-ingest and recorded by detail-evidence. Returns the listing IDs of the rows.
 */
export async function upstream(t: TestDatabase, recorded: RecordedRun, rows: Json[]) {
  const jobId = await t.collected(recorded, rows)
  const ingested = await ingest(t.db, { jobId, kind: 'search' })
  if (!ingested.ok) throw new Error(ingested.error.message)
  const recordedDetails = await record(t.db, { jobId })
  if (!recordedDetails.ok) throw new Error(recordedDetails.error.message)
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

const DAY_S = 24 * 60 * 60

/**
 * A synthetic relist of a recorded row: the same row under a new listing ID, listed `days` after
 * the original and collected an hour after that, with optional field edits.
 */
export function relist(row: Json, newId: string, days: number, fields: Json = {}): Json {
  const listedAt = Number(row.listedAt) + Math.round(days * DAY_S)
  return {
    ...row,
    listingId: newId,
    url: `https://www.facebook.com/marketplace/item/${newId}/`,
    listingUrl: `https://www.facebook.com/marketplace/item/${newId}/`,
    listedAt,
    collectedAt: new Date((listedAt + 3600) * 1000).toISOString(),
    ...fields,
  }
}

/** The recorded run's listing rows. */
export const listingRows = (recorded: RecordedRun) =>
  recorded.dataset.filter((row) => row.recordType === 'listing')
