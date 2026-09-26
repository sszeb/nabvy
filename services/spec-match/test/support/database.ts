import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { WantManagerCriterion } from '@nabvy/contracts/modules/want-manager'
import type { Queryable } from '@nabvy/db'
import { record as recordEvidence } from '@nabvy/detail-evidence'
import { assess } from '@nabvy/listing-assessment'
import { ingest } from '@nabvy/listing-ingest'
import {
  createRecordedPartsClient,
  PARTS_AI_PROMPT_VERSION,
  type PartsAiResponse,
  run as runAi,
} from '@nabvy/parts-ai'
import { type PartsRecordDeps, record as recordParts } from '@nabvy/parts-record'
import { run as runRules } from '@nabvy/parts-rules'
import { recompute } from '@nabvy/spend-governor'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, audit-log, switches,
// cost-meter, apify-gateway, listing-ingest, detail-evidence, product-catalogue, parts-rules,
// spend-governor, details-queue, quote-redaction, parts-ai, parts-record, listing-assessment,
// listing-suppression, noise-filter, better-auth, account, usage-ledger, subscriptions,
// run-coverage, city-pages, want-manager and this module. Built like noise-filter's test support. Used as
// nabvy_pipeline, the role the module runs as. PGlite has no pg_net, PostGIS, pgvector or pg_trgm, so `create extension` lines are
// skipped, and a stand-in `extensions.similarity` that never matches keeps product-catalogue's
// fuzzy tier out of these tests (it runs on real Postgres in `pnpm db:dry-run`).

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
    'product-catalogue',
    'parts-rules',
    'spend-governor',
    'details-queue',
    'quote-redaction',
    'parts-ai',
    'parts-record',
    'listing-assessment',
    'listing-suppression',
    'noise-filter',
    'better-auth',
    'account',
    'usage-ledger',
    'subscriptions',
    'run-coverage',
    'city-pages',
    'want-manager',
    'spec-match',
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

type Json = Record<string, unknown>

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_app, the web app's role, then returns to the pipeline role. */
  asApp(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_app with `app.user_id` set, as withUser does. */
  asUser(userId: string, query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs `fn` on Drizzle as nabvy_app with `app.user_id` set, then returns to the pipeline role. */
  withUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>
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
  await pg.exec(`create schema if not exists extensions;
    create function extensions.similarity(text, text) returns real
      language sql immutable as 'select 0::real';
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
      await pg.exec('reset role; set role nabvy_app')
      try {
        return (await pg.query<Record<string, unknown>>(query, params)).rows
      } finally {
        await pg.exec('reset role; set role nabvy_pipeline')
      }
    },
    async asUser(userId, query, params = []) {
      await pg.exec('reset role; set role nabvy_app')
      await pg.query(`select set_config('app.user_id', $1, false)`, [userId])
      try {
        return (await pg.query<Record<string, unknown>>(query, params)).rows
      } finally {
        await pg.exec(
          `select set_config('app.user_id', '', false); reset role; set role nabvy_pipeline`,
        )
      }
    },
    async withUser(userId, fn) {
      await pg.exec('reset role; set role nabvy_app')
      await pg.query(`select set_config('app.user_id', $1, false)`, [userId])
      try {
        return await fn(drizzle(pg) as unknown as Queryable)
      } finally {
        await pg.exec(
          `select set_config('app.user_id', '', false); reset role; set role nabvy_pipeline`,
        )
      }
    },
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
  'product-catalogue': 'on',
  'parts-rules': 'on',
  'cost-meter': 'on',
  'spend-governor': 'on',
  'details-queue': 'on',
  'quote-redaction': 'on',
  anthropic: 'on',
  'parts-ai': 'on',
  'parts-record': 'on',
  'listing-assessment': 'on',
  'listing-suppression': 'on',
  'noise-filter': 'on',
  'want-manager': 'on',
  'spec-match': 'on',
} as const

/**
 * Stores rows as a collected job, lets listing-ingest ingest it, detail-evidence record it and
 * parts-rules run over it, as the live pipeline does before `parts-rules.ran` reaches this
 * module. Returns the listing IDs the `ran` event carries.
 */
export async function ruled(
  t: TestDatabase,
  recorded: RecordedRun,
  rows: Json[] = recorded.dataset,
): Promise<string[]> {
  const jobId = await t.collected(recorded, rows)
  const ingested = await ingest(t.db, { jobId, kind: 'search' })
  if (!ingested.ok) throw new Error(ingested.error.message)
  const recordedJob = await recordEvidence(t.db, { jobId })
  if (!recordedJob.ok) throw new Error(recordedJob.error.message)
  const rules = await runRules(t.db, { listingIds: recordedJob.value.changed })
  if (!rules.ok) throw new Error(rules.error.message)
  return rules.value.ran
}

/** The priced model the recorded responses stand for (cost-meter's table). */
export const MODEL = 'claude-haiku-4-5'

/**
 * Runs parts-ai over these listings with responses recorded per source listing ID (keyed by
 * each listing's current evidence hash, the client's trace key), as the live pipeline does before
 * `parts-ai.extracted` reaches parts-record. A listing with no recorded response is one the
 * model call failed for: parts-ai writes nothing and the sweep would try again. Returns the
 * listing IDs the `extracted` event carries.
 */
export async function extracted(
  t: TestDatabase,
  listingIds: string[],
  responses: Record<string, PartsAiResponse>,
): Promise<string[]> {
  await openThrottle(t)
  const rows = await t.asPipeline(
    `select l.source_listing_id as sid, c.evidence_hash
     from detail_evidence.v_current c join listing_ingest.v_listings l on l.id = c.listing_id`,
  )
  const byHash: Record<string, PartsAiResponse> = {}
  for (const row of rows) {
    const response = responses[row.sid as string]
    if (response) byHash[row.evidence_hash as string] = response
  }
  const client = createRecordedPartsClient(MODEL, {
    promptVersion: PARTS_AI_PROMPT_VERSION,
    responses: byHash,
  })
  const result = await runAi(t.db, { listingIds }, { client }, { usdGbpRate: USD_GBP_RATE })
  if (!result.ok) throw new Error(result.error.message)
  return result.value.events.flatMap((e) => (e.payload as { listingIds: string[] }).listingIds)
}

/** Computes spend-governor's throttle now, so it reads its level instead of `hold-new`. */
export async function openThrottle(t: TestDatabase): Promise<void> {
  const result = await recompute(t.db, { now: new Date().toISOString(), usdGbpRate: USD_GBP_RATE })
  if (!result.ok) throw new Error(result.error.message)
}

/** A synthetic rate for cost-meter (the tests' only one). */
export const USD_GBP_RATE = 0.75

/**
 * Runs the whole upstream chain the live pipeline runs before `parts-record.recorded` reaches
 * listing-assessment: ingest, detail-evidence, parts-rules, parts-record on `ran`, parts-ai with the
 * recorded responses and parts-record again on `extracted`. Returns the listing IDs the last
 * `recorded` event carries.
 */
export async function recorded(
  t: TestDatabase,
  run: RecordedRun,
  rows: Json[] = run.dataset,
  responses: Record<string, PartsAiResponse> = {},
  deps: PartsRecordDeps = {},
): Promise<string[]> {
  const listingIds = await ruled(t, run, rows)
  const onRan = await recordParts(t.db, { listingIds }, deps)
  if (!onRan.ok) throw new Error(onRan.error.message)
  const withAi = await extracted(t, listingIds, responses)
  if (withAi.length > 0) {
    const onExtracted = await recordParts(t.db, { listingIds: withAi }, deps)
    if (!onExtracted.ok) throw new Error(onExtracted.error.message)
  }
  return onRan.value.recorded
}

/**
 * Runs the whole upstream chain up to listing-assessment, as the live pipeline does before
 * `listing-assessment.assessed` reaches this module. Returns the listing IDs that event carries.
 */
export async function assessed(
  t: TestDatabase,
  run: RecordedRun,
  rows: Json[] = run.dataset,
  responses: Record<string, PartsAiResponse> = {},
  deps: PartsRecordDeps = {},
): Promise<string[]> {
  const listingIds = await recorded(t, run, rows, responses, deps)
  const result = await assess(t.db, { listingIds, now: new Date() })
  if (!result.ok) throw new Error(result.error.message)
  return result.value.assessed
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

/** A want as a test seeds it: want-manager's own tables, written as the migration superuser. */
export interface WantSeed {
  userId?: string
  lat?: number
  lng?: number
  radiusKm?: number
  centreId?: string | null
  priceCapMinor?: number | null
  currency?: 'GBP' | 'EUR'
  deliveryMethods?: ('collection' | 'posted')[]
  active?: boolean
  criteria: WantManagerCriterion[]
}

/** Chichester, where the recorded run searched (fixtures/listings/facebook/runs/…/README.md). */
export const CHICHESTER = { lat: 50.8376, lng: -0.7749 }

/** Stores a want and its criteria the way want-manager's `upsertWant` leaves them. */
export async function seedWant(
  t: TestDatabase,
  w: WantSeed,
): Promise<{ wantId: string; userId: string }> {
  const userId = w.userId ?? randomUUID()
  const [row] = await t.sql(
    `insert into want_manager.wants (user_id, lat, lng, radius_km, centre_id, price_cap_minor,
       currency, active, cadence_seconds, delivery_methods, version_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 3600, $9::text[], $10) returning id`,
    [
      userId,
      w.lat ?? CHICHESTER.lat,
      w.lng ?? CHICHESTER.lng,
      w.radiusKm ?? 50,
      w.centreId ?? null,
      w.priceCapMinor ?? null,
      w.currency ?? 'GBP',
      w.active ?? true,
      w.deliveryMethods ?? ['collection'],
      createHash('sha256').update(randomUUID()).digest('hex'),
    ],
  )
  const wantId = String(row?.id)
  for (const [position, c] of w.criteria.entries()) {
    await t.sql(
      `insert into want_manager.criteria (want_id, user_id, position, part_type, catalogue_id,
         family, min_attr, or_better)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        wantId,
        userId,
        position,
        c.partType,
        c.catalogueId,
        c.family,
        c.minAttr === null ? null : JSON.stringify(c.minAttr),
        c.orBetter,
      ],
    )
  }
  return { wantId, userId }
}

/** A catalogue criterion, the shape want-manager stores. */
export const part = (
  partType: 'gpu' | 'cpu',
  catalogueId: string | null,
  family: string | null = null,
  orBetter = false,
): WantManagerCriterion => ({ partType, catalogueId, family, minAttr: null, orBetter })

/** A sized criterion (RAM or storage). */
export const sized = (
  partType: 'ram' | 'storage',
  minAttr: { sizeGb?: number; generation?: string },
): WantManagerCriterion => ({ partType, catalogueId: null, family: null, minAttr, orBetter: false })
