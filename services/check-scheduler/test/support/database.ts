import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { ApifyGatewaySubmitRunInput } from '@nabvy/contracts/modules/apify-gateway'
import type {
  SearchPlannerOneOffRun,
  SearchPlannerPlan,
  SearchPlannerSetOneOffStatusInput,
} from '@nabvy/contracts/modules/search-planner'
import type { SpendGovernorLevel } from '@nabvy/contracts/modules/spend-governor'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'
import type { CheckSchedulerPorts } from '../../src'

// An in-process Postgres (PGlite) with the core, switches and check-scheduler migrations applied,
// used as nabvy_pipeline. Other modules' published views that this module reads from SQL
// (run-coverage's v_search_coverage, listing-ingest's v_sightings and v_listings) are stand-in
// tables with only the columns read, as details-queue's tests do. search-planner,
// spend-governor, source-health and apify-gateway come through fake ports (`fakePorts`): no test
// ever submits a live run. The full migration set runs on real Postgres in `pnpm db:dry-run`
// (packages/db/tests/check-scheduler.test.sql).

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

const STAND_INS = `
create schema run_coverage;
create table run_coverage.v_search_coverage (
  id uuid primary key, job_id integer not null, centre_id text, term text, status text not null);
create schema listing_ingest;
create table listing_ingest.v_listings (id uuid primary key, first_fetched_at timestamptz not null);
create table listing_ingest.v_sightings (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null, job_id integer not null);
grant usage on schema run_coverage, listing_ingest to nabvy_pipeline;
grant select on all tables in schema run_coverage, listing_ingest to nabvy_pipeline;
`

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs `fn` in one transaction, as a scheduler task does inside withPipeline. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  switches(states: Record<string, 'off' | 'shadow' | 'on'>): Promise<void>
  /** A search run-coverage judged, in the `v_search_coverage` stand-in. */
  search(s: {
    id: string
    jobId: number
    centreId: string
    term: string
    status: string
  }): Promise<void>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of ['core', 'switches', 'check-scheduler'].flatMap(migrationFiles)) {
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
    tx: (fn) => db.transaction((tx) => fn(tx as unknown as Queryable)),
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
    search: (s) =>
      asSuper(async () => {
        await pg.query(
          'insert into run_coverage.v_search_coverage (id, job_id, centre_id, term, status) values ($1, $2, $3, $4, $5)',
          [s.id, s.jobId, s.centreId, s.term, s.status],
        )
      }),
    close: () => pg.close(),
  }
}

/** Every switch the scheduler reads, on. */
export const ALL_ON = { 'check-scheduler': 'on', pipeline: 'on' } as const

type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'refused'

export interface FakePorts extends CheckSchedulerPorts {
  /** Every run submitted, in order. */
  submitted: ApifyGatewaySubmitRunInput[]
  /** Calls to each port, in order: proves the throttle is read before any submit. */
  calls: string[]
  level: SpendGovernorLevel
  maxChecksPerDay: number
  plan: SearchPlannerPlan[]
  oneOffs: SearchPlannerOneOffRun[]
  statusChanges: SearchPlannerSetOneOffStatusInput[]
  jobs: Map<number, JobStatus>
  refuse: boolean
}

/** Chichester and Belfast: city-pages' seeded centres; Chichester is the recorded run's cityId. */
export const CHICHESTER = '115935195086622'
export const BELFAST = '109312942421526'

export const pair = (
  centreId: string,
  term: string,
  cls: 'narrow' | 'broad',
  paidWantCount: number,
  rank: number,
): SearchPlannerPlan => ({
  centreId,
  term,
  class: cls,
  origins: ['wants'],
  wantCount: Math.max(1, paidWantCount),
  paidWantCount,
  rank,
})

/** search-planner, spend-governor, source-health and the gateway, faked: job IDs count from 1. */
export function fakePorts(): FakePorts {
  const ports: FakePorts = {
    submitted: [],
    calls: [],
    level: 'none',
    maxChecksPerDay: 50,
    plan: [],
    oneOffs: [],
    statusChanges: [],
    jobs: new Map(),
    refuse: false,
    async submitRun(_q, request) {
      ports.calls.push('submitRun')
      if (ports.refuse) {
        return { ok: false, error: { code: 'apify-gateway.refused', message: 'refused (test)' } }
      }
      ports.submitted.push(request)
      const jobId = ports.submitted.length
      ports.jobs.set(jobId, 'pending')
      return { ok: true, value: { jobId, reserveUsd: '0.0100' } }
    },
    async readJobs(_q, jobIds) {
      ports.calls.push('readJobs')
      const at = '2026-09-25T12:00:00.000Z'
      return jobIds.flatMap((id) => {
        const status = ports.jobs.get(id)
        if (!status) return []
        return [
          {
            id,
            kind: 'run' as const,
            runKind: 'search' as const,
            status,
            tags: {},
            input: {},
            memoryMb: 512,
            timeoutSecs: 180,
            reserveUsd: '0.0100',
            costUsd: null,
            apifyRunId: null,
            itemCount: null,
            error: null,
            startedAt: null,
            finishedAt: null,
            settledAt: null,
            announcedAt: null,
            createdAt: at,
            updatedAt: at,
          },
        ]
      })
    },
    async readThrottle() {
      ports.calls.push('readThrottle')
      return { level: ports.level }
    },
    async recommendRampStage() {
      ports.calls.push('recommendRampStage')
      return {
        stage: 0,
        maxChecksPerDay: ports.maxChecksPerDay,
        startedAt: '2026-09-24T00:00:00.000Z',
        advancedBy: null,
      }
    },
    async listPlan() {
      ports.calls.push('listPlan')
      return ports.plan
    },
    async listOneOffRuns() {
      ports.calls.push('listOneOffRuns')
      return ports.oneOffs
    },
    async setOneOffRunStatus(_q, input) {
      ports.statusChanges.push(input)
      const run = ports.oneOffs.find((o) => o.id === input.id)
      if (run) run.status = input.status
    },
  }
  return ports
}
