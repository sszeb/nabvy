import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then core, switches, cost-meter,
// apify-gateway and this module. Used as nabvy_pipeline, the role the governor runs as. PGlite has
// no pg_net, PostGIS, pgvector or pg_trgm, so `create extension` lines are skipped; the full set
// runs in `pnpm db:dry-run`.
//
// Only the gateway may write its tables (its conventions test), and the Edge Function writes run
// states straight into them. So the tests seed gateway runs into a stand-in: a table cloned from
// the real `apify_gateway.v_jobs` (same columns and types), behind a view that replaces v_jobs.
// Postgres refuses `create or replace view` unless every column keeps its name, type and place,
// so the stand-in cannot drift from the gateway's published view.
const STAND_IN = `
  create schema test_gateway;
  create table test_gateway.v_jobs_rows as select * from apify_gateway.v_jobs with no data;
  create or replace view apify_gateway.v_jobs with (security_invoker = true) as
    select * from test_gateway.v_jobs_rows where switches.state('apify-gateway') <> 'off';
  grant usage on schema test_gateway to nabvy_pipeline;
  grant select on test_gateway.v_jobs_rows to nabvy_pipeline;
`

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const sqlIn = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(root, dir, name))

const FILES = [
  join(root, 'supabase/tests/supabase-stubs.sql'),
  ...sqlIn('supabase/migrations'),
  ...['core', 'switches', 'cost-meter', 'apify-gateway', 'spend-governor'].flatMap((m) =>
    sqlIn(`packages/db/migrations/${m}`),
  ),
]

type State = 'off' | 'shadow' | 'on'

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to nabvy_pipeline. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_pipeline. */
  asPipeline(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Sets switches the way an admin would (switches.set is tested in its own module). */
  switches(states: Record<string, State>): Promise<void>
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
  await pg.exec(STAND_IN)
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
    async asPipeline(query, params = []) {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
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
    close: () => pg.close(),
  }
}

/** The switches the governor reads, on (the gateway's too, so v_jobs has rows). */
export const ALL_ON = { 'spend-governor': 'on', 'cost-meter': 'on', 'apify-gateway': 'on' } as const

/** A ledger call as cost-meter would have written it (amounts in USD micros, rate 0.75). */
export interface SeedCall {
  refId: string
  provider?: string
  reservedMicros: number
  settledMicros?: number | null
  at: string
}

/** A gateway run as `v_jobs` would show it. */
export interface SeedJob {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'refused'
  reserveUsd: string
  costUsd?: string | null
  apifyRunId?: string | null
  settledAt?: string | null
  createdAt: string
}

export async function seed(
  t: TestDatabase,
  data: { calls?: SeedCall[]; jobs?: SeedJob[]; rate?: number },
): Promise<void> {
  const rate = data.rate ?? 0.75
  for (const c of data.calls ?? []) {
    const settled = c.settledMicros ?? null
    await t.sql(
      `insert into cost_meter.provider_calls (module, provider, kind, ref_id, currency,
         reserved_micros, settled_micros, usd_gbp_rate, reserved_gbp_micros, settled_gbp_micros,
         settled_at, status, at)
       values ('apify-gateway', $1, case when $1::text = 'anthropic' then 'model_call' else 'actor_run' end,
         $2, 'USD', $3::bigint, $4::bigint, $5::numeric, ceil($3::bigint * $5::numeric),
         ceil($4::bigint * $5::numeric),
         case when $4::bigint is null then null else $6::timestamptz + interval '15 minutes' end,
         case when $4::bigint is null then 'pending' else 'succeeded' end, $6::timestamptz)`,
      [c.provider ?? 'apify', c.refId, c.reservedMicros, settled, rate, c.at],
    )
  }
  let id = 0
  for (const j of data.jobs ?? []) {
    id += 1
    await t.sql(
      `insert into test_gateway.v_jobs_rows (id, kind, run_kind, status, tags, input, reserve_usd,
         cost_usd, apify_run_id, settled_at, created_at, updated_at)
       values ($1, 'run', 'search', $2, '{}'::jsonb, '{}'::jsonb, $3::numeric, $4::numeric, $5,
         $6::timestamptz, $7::timestamptz, $7::timestamptz)`,
      [
        id,
        j.status,
        j.reserveUsd,
        j.costUsd ?? null,
        j.apifyRunId ?? null,
        j.settledAt ?? null,
        j.createdAt,
      ],
    )
  }
}
