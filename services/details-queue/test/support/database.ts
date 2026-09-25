import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { ApifyGatewaySubmitRunInput } from '@nabvy/contracts/modules/apify-gateway'
import type { SpendGovernorLevel } from '@nabvy/contracts/modules/spend-governor'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'
import type { DetailsQueuePorts } from '../../src'

// An in-process Postgres (PGlite) with the core, switches and details-queue migrations applied,
// used as nabvy_pipeline. Other modules' published views are stand-in tables with only the
// columns this module reads (as spend-governor's tests do): only apify-gateway may write its own
// tables (services/apify-gateway/test/conventions.test.ts), so this harness never creates them.
// The gateway, route-health and spend-governor calls come through fake ports (`fakePorts`).

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

const STAND_INS = `
create schema apify_gateway;
create table apify_gateway.v_jobs (id integer primary key, tags jsonb not null default '{}');
create table apify_gateway.v_rows (
  job_id integer not null, seq integer not null, record_type text, listing_id text,
  item jsonb not null, primary key (job_id, seq));
create schema listing_ingest;
create table listing_ingest.v_listings (
  id uuid primary key, source text not null, source_listing_id text not null);
create table listing_ingest.v_sightings (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null, job_id integer not null,
  kind text not null, seen_at timestamptz not null);
grant usage on schema apify_gateway, listing_ingest to nabvy_pipeline;
grant select on all tables in schema apify_gateway, listing_ingest to nabvy_pipeline;
`

type Json = Record<string, unknown>

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Sets switches the way an admin would (switches.set is tested in its own module). */
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  /** Stores a job's rows in the `v_rows` stand-in, the way a collected job shows them. */
  rows(jobId: number, rows: Json[]): Promise<void>
  /** A listing listing-ingest shows, with its first sighting and that job's tags. */
  listing(l: {
    id: string
    sourceListingId: string
    jobId: number
    kind: 'search' | 'detail'
    tags?: Json
    seenAt?: string
  }): Promise<void>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of ['core', 'switches', 'details-queue'].flatMap(migrationFiles)) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  await pg.exec(STAND_INS)
  const db = drizzle(pg) as unknown as Queryable
  await pg.exec('set role nabvy_pipeline')
  const asSuper = async <T>(fn: () => Promise<T>): Promise<T> => {
    await pg.exec('reset role')
    try {
      return await fn()
    } finally {
      await pg.exec('set role nabvy_pipeline')
    }
  }
  return {
    db,
    sql: (query, params = []) =>
      asSuper(async () => (await pg.query<Record<string, unknown>>(query, params)).rows),
    switches: (states) =>
      asSuper(async () => {
        for (const [name, value] of Object.entries(states)) {
          await pg.query(
            `insert into switches.switches (name, kind, state)
             values ($1, case when $1 = 'pipeline' then 'global' else 'module' end, $2)
             on conflict (name) do update set state = excluded.state`,
            [name, value],
          )
        }
      }),
    rows: (jobId, rows) =>
      asSuper(async () => {
        for (const [seq, item] of rows.entries()) {
          await pg.query(
            'insert into apify_gateway.v_rows (job_id, seq, record_type, listing_id, item) values ($1, $2, $3, $4, $5)',
            [jobId, seq, item.recordType ?? null, item.listingId ?? null, JSON.stringify(item)],
          )
        }
      }),
    listing: (l) =>
      asSuper(async () => {
        await pg.query(
          `insert into apify_gateway.v_jobs (id, tags) values ($1, $2) on conflict (id) do nothing`,
          [l.jobId, JSON.stringify(l.tags ?? {})],
        )
        await pg.query(
          `insert into listing_ingest.v_listings (id, source, source_listing_id) values ($1, 'facebook', $2)
           on conflict (id) do nothing`,
          [l.id, l.sourceListingId],
        )
        await pg.query(
          'insert into listing_ingest.v_sightings (listing_id, job_id, kind, seen_at) values ($1, $2, $3, $4)',
          [l.id, l.jobId, l.kind, l.seenAt ?? '2026-09-24T02:00:00Z'],
        )
      }),
    close: () => pg.close(),
  }
}

/** Every switch the queue reads, on. */
export const ALL_ON = { 'details-queue': 'on', pipeline: 'on' } as const

export interface FakePorts extends DetailsQueuePorts {
  /** Every run submitted, in order. */
  submitted: ApifyGatewaySubmitRunInput[]
  /** Calls to each port, in order: proves the throttle is read before any submit. */
  calls: string[]
  level: SpendGovernorLevel
  route: 'graphql' | 'page'
  /** Job states the gateway reports, by job ID. */
  jobs: Map<
    number,
    {
      status: 'pending' | 'running' | 'succeeded' | 'failed' | 'refused'
      announcedAt: string | null
    }
  >
  refuse: boolean
}

/** The gateway, route-health and spend-governor, faked: job IDs count from 1. */
export function fakePorts(): FakePorts {
  const ports: FakePorts = {
    submitted: [],
    calls: [],
    level: 'none',
    route: 'graphql',
    jobs: new Map(),
    refuse: false,
    async submitRun(_q, request) {
      ports.calls.push('submitRun')
      if (ports.refuse) {
        return { ok: false, error: { code: 'apify-gateway.refused', message: 'refused (test)' } }
      }
      ports.submitted.push(request)
      const jobId = ports.submitted.length
      ports.jobs.set(jobId, { status: 'pending', announcedAt: null })
      return { ok: true, value: { jobId, reserveUsd: '0.1000' } }
    },
    async readJobs(_q, jobIds) {
      ports.calls.push('readJobs')
      return jobIds.flatMap((id) => {
        const job = ports.jobs.get(id)
        return job ? [{ id, ...job }] : []
      })
    },
    async recommendRoute() {
      ports.calls.push('recommendRoute')
      return { route: ports.route }
    },
    async readThrottle() {
      ports.calls.push('readThrottle')
      return { level: ports.level }
    },
  }
  return ports
}

/** `count` Facebook-shaped numeric IDs from `start`. */
export const ids = (count: number, start = 1_000_000_000_000_000) =>
  Array.from({ length: count }, (_, i) => String(start + i))

/** A detail row as the actor returns it, with only the fields the queue reads. */
export const row = (listingId: string, fields: Json = {}): Json => ({
  recordType: 'listing',
  listingId,
  detailOutcome: 'collected',
  descriptionStatus: 'full_verified',
  ...fields,
})

const FIXTURES = new URL('../../../../fixtures/listings/', import.meta.url)
/** A recorded run's dataset, e.g. `facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`. */
export const loadDataset = (run: string): Json[] =>
  JSON.parse(readFileSync(new URL(`${run}/dataset.json`, FIXTURES), 'utf8'))

export const RECORDED = 'facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k'
