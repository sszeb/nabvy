import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { record } from '@nabvy/detail-evidence'
import { ingest } from '@nabvy/listing-ingest'
import { drizzle } from 'drizzle-orm/pglite'
import { applyEvent } from '../../src'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, switches, cost-meter,
// apify-gateway, listing-ingest, detail-evidence, details-queue and this module. Built like
// detail-evidence's test support: the other modules write their own tables through their exported
// functions (ingest, record, enqueue), and this module reads their views. Used as nabvy_pipeline,
// the role the module runs as. PGlite has
// no pg_net, PostGIS, pgvector or pg_trgm, so `create extension` lines are skipped; the full set
// runs in `pnpm db:dry-run`.

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
  /** Sets switches the way an admin would. */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
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
  'details-queue': 'on',
  'listing-lifecycle': 'on',
} as const

/**
 * Stores rows as a collected job, lets listing-ingest ingest it and detail-evidence record it, as
 * the live pipeline does on `run-collected`. Returns the job ID and both modules' events.
 */
export async function collectedJob(
  t: TestDatabase,
  recorded: RecordedRun,
  rows: Json[],
  kind: 'search' | 'details',
): Promise<{ jobId: number; cardChanged: string[][]; unresolved: string[][] }> {
  const jobId = await t.collected(recorded, rows)
  const ingested = await ingest(t.db, { jobId, kind })
  if (!ingested.ok) throw new Error(ingested.error.message)
  const recordedDetails = await record(t.db, { jobId })
  if (!recordedDetails.ok) throw new Error(recordedDetails.error.message)
  const payloads = (events: { type: string; payload: unknown }[], type: string) =>
    events
      .filter((e) => e.type === type)
      .map((e) => (e.payload as { listingIds: string[] }).listingIds)
  return {
    jobId,
    cardChanged: payloads(ingested.value.events, 'listing-ingest.card-changed'),
    unresolved: payloads(recordedDetails.value.events, 'detail-evidence.unresolved'),
  }
}

/** Rows with one listing's fields replaced (synthetic edits). */
export function withFields(rows: Json[], listingId: string, fields: Json): Json[] {
  return rows.map((row) => (row.listingId === listingId ? { ...row, ...fields } : row))
}

/** The same rows collected at a later time (a later run of the same page). */
export function later(rows: Json[], collectedAt: string): Json[] {
  return rows.map((row) => (row.recordType === 'listing' ? { ...row, collectedAt } : row))
}

/** A details run's row for a removed ID: the documented `directItemUnresolved` shape. */
export function unresolvedRow(listingId: string, collectedAt: string): Json {
  return {
    recordType: 'listing',
    listingId,
    collectedAt,
    detailAttempted: true,
    detailAttempts: 1,
    detailOutcome: 'extraction-error',
    directItemUnresolved: true,
  }
}

/** listing-ingest's listing UUID of each source listing ID. */
export async function listingIdsBySource(t: TestDatabase): Promise<Map<string, string>> {
  const rows = await t.asPipeline('select id, source_listing_id from listing_ingest.v_listings')
  return new Map(rows.map((r) => [r.source_listing_id as string, r.id as string]))
}

/** One collected job of a fixture case. */
export interface JobStep {
  kind: 'search' | 'details'
  collectedAt: string
  /** Rows of these listing IDs are left out (a sweep that missed them). */
  drop?: string[]
  /** Only these listing IDs' rows (a details run of chosen IDs). */
  only?: string[]
  edits?: { listingId: string; fields: Json }[]
  /** Rows replaced by the removed-ID shape (synthetic). */
  unresolved?: string[]
}

/** The rows of a job step, built from the recorded rows. */
export function rowsFor(step: JobStep, dataset: Json[]): Json[] {
  let rows = dataset.filter((row) => row.recordType === 'listing')
  if (step.only) {
    const keep = new Set([...step.only, ...(step.unresolved ?? [])])
    rows = rows.filter((row) => keep.has(String(row.listingId)))
  }
  if (step.drop) rows = rows.filter((row) => !step.drop?.includes(String(row.listingId)))
  rows = later(rows, step.collectedAt)
  for (const edit of step.edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)
  for (const id of step.unresolved ?? []) {
    rows = rows.map((row) => (row.listingId === id ? unresolvedRow(id, step.collectedAt) : row))
  }
  return rows
}

/**
 * Collects, ingests and records a job, then applies its `card-changed` and `unresolved` events as
 * the handlers would (keyed like the senders' keys). Returns how many listings were announced.
 */
export async function runJob(
  t: TestDatabase,
  recorded: RecordedRun,
  step: JobStep,
): Promise<number> {
  const job = await collectedJob(t, recorded, rowsFor(step, recorded.dataset), step.kind)
  const batches = [
    ...job.cardChanged.map((ids, i) => ({
      ids,
      key: `listing-ingest.card-changed:${job.jobId}:${i}`,
    })),
    ...job.unresolved.map((ids, i) => ({
      ids,
      key: `detail-evidence.unresolved:${job.jobId}:${i}`,
    })),
  ]
  let announced = 0
  for (const batch of batches) {
    const result = await applyEvent(t.db, { listingIds: batch.ids, key: batch.key })
    if (!result.ok) throw new Error(result.error.message)
    announced += result.value.changed.length
  }
  return announced
}
