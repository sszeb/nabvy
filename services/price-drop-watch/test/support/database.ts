import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { ingest } from '@nabvy/listing-ingest'
import { drizzle } from 'drizzle-orm/pglite'
import { applyEvent } from '../../src'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, switches, cost-meter,
// apify-gateway, listing-ingest, detail-evidence, details-queue, listing-lifecycle,
// listing-suppression, relist-merge and this module. Built like listing-lifecycle's test
// support: the other modules write their own tables through their exported functions (here just
// `ingest`); relist-merge groups and listing-suppression entries this module's own fixtures need
// are seeded with direct SQL (as the migration role), since no fixture here exercises their own
// matching logic — that is their own module's job. Used as nabvy_pipeline. PGlite has no pg_net,
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
    'details-queue',
    'listing-lifecycle',
    'listing-suppression',
    'relist-merge',
    'price-drop-watch',
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

type Json = Record<string, unknown>

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. `applyEvent`, `tick`,
   * `accountDeletedEvent`, `erase` and `ingest` all run on this: pipeline functions. */
  db: Queryable
  /**
   * Runs `fn` in one transaction as `nabvy_app`, with `app.user_id` set locally, as `withUser`
   * does. `watch()`/`unwatch()` are called through this, never `db` directly: `nabvy_pipeline` has
   * no insert/update grant on `watches` (packages/db/README.md, "Roles, withUser and RLS").
   */
  asApp<T>(userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T>
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_pipeline. */
  asPipeline(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_app, with `app.user_id` set for the call. */
  asUser(userId: string, query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Sets switches the way an admin would. */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  /** Stores a collected job the way the gateway leaves one, as listing-lifecycle's support does. */
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
  const db = drizzle(pg)
  return {
    db: db as unknown as Queryable,
    asApp: async (userId, fn) =>
      db.transaction(async (tx) => {
        await tx.execute('set local role nabvy_app')
        await tx.execute(`select set_config('app.user_id', '${userId}', true)`)
        return fn(tx as unknown as Queryable)
      }),
    sql: asOwner,
    asPipeline: async (query, params = []) =>
      (await pg.query<Record<string, unknown>>(query, params)).rows,
    asUser: async (userId, query, params = []) => {
      await pg.exec('set role nabvy_app')
      try {
        await pg.query('select set_config($1, $2, true)', ['app.user_id', userId])
        return (await pg.query<Record<string, unknown>>(query, params)).rows
      } finally {
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

/** Every switch this module reads, and those of the modules whose views it reads, on. */
export const ALL_ON = {
  'apify-gateway': 'on',
  apify: 'on',
  pipeline: 'on',
  'listing-ingest': 'on',
  'detail-evidence': 'on',
  'details-queue': 'on',
  'listing-lifecycle': 'on',
  'listing-suppression': 'on',
  'relist-merge': 'on',
  'price-drop-watch': 'on',
} as const

/** Rows with one listing's fields replaced (synthetic edits). */
export function withFields(rows: Json[], listingId: string, fields: Json): Json[] {
  return rows.map((row) => (row.listingId === listingId ? { ...row, ...fields } : row))
}

/** The same rows collected at a later time (a later run of the same page). */
export function later(rows: Json[], collectedAt: string): Json[] {
  return rows.map((row) => (row.recordType === 'listing' ? { ...row, collectedAt } : row))
}

/** One collected job of a fixture case: a search sweep, optionally with price edits. */
export interface JobStep {
  collectedAt: string
  edits?: { listingId: string; fields: Json }[]
}

/** The rows of a job step, built from the recorded rows. */
export function rowsFor(step: JobStep, dataset: Json[]): Json[] {
  let rows = dataset.filter((row) => row.recordType === 'listing')
  rows = later(rows, step.collectedAt)
  for (const edit of step.edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)
  return rows
}

/**
 * Collects and ingests a job, then applies its `card-changed` events through price-drop-watch's
 * `applyEvent`, keyed like the handler would key them. Returns the watch IDs announced.
 */
export async function runJob(
  t: TestDatabase,
  recorded: RecordedRun,
  step: JobStep,
): Promise<string[]> {
  const jobId = await t.collected(recorded, rowsFor(step, recorded.dataset))
  const ingested = await ingest(t.db, { jobId, kind: 'search' })
  if (!ingested.ok) throw new Error(ingested.error.message)
  const batches = ingested.value.events
    .filter((e) => e.type === 'listing-ingest.card-changed')
    .map((e, i) => ({
      ids: (e.payload as { listingIds: string[] }).listingIds,
      key: `listing-ingest.card-changed:${jobId}:${i}`,
    }))
  const announced: string[] = []
  for (const batch of batches) {
    const report = await applyEvent(t.db, { listingIds: batch.ids, key: batch.key })
    for (const event of report.events) {
      announced.push(...(event.payload as { watchIds: string[] }).watchIds)
    }
  }
  return announced
}

/** listing-ingest's listing UUID of each source listing ID. */
export async function listingIdsBySource(t: TestDatabase): Promise<Map<string, string>> {
  const rows = await t.asPipeline('select id, source_listing_id from listing_ingest.v_listings')
  return new Map(rows.map((r) => [r.source_listing_id as string, r.id as string]))
}

/** Puts two listings in one relist-merge group directly (bypassing `merge()`'s own matching,
 * which is that module's own job to test), for the group-dedupe fixture. */
export async function seedRelistGroup(t: TestDatabase, listingIds: string[]): Promise<void> {
  const [group] = await t.sql('insert into relist_merge.groups default values returning id')
  const groupId = group?.id
  for (const [i, listingId] of listingIds.entries()) {
    await t.sql(
      `insert into relist_merge.members (group_id, listing_id, basis, matched_listing_id,
         input_fetched_at)
       values ($1, $2, $3, $4, now())`,
      [groupId, listingId, i === 0 ? 'origin' : 'description', i === 0 ? null : listingIds[0]],
    )
  }
}
