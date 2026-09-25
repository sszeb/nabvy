import { readFileSync } from 'node:fs'
import type { TestDatabase } from './database'

// Plays the Edge Function's part in SQL, as it does it (supabase/functions/apify-gateway/index.ts):
// claim the next job, record the started run, store every dataset row with the run object,
// itemCount and RUN_SUMMARY, and settle the cost at least 10 minutes after the finish. Apify
// itself is replaced by a recorded run under fixtures/listings/.

type Json = Record<string, unknown>

export interface RecordedRun {
  apifyRunId: string
  reserveUsd: number
  settledCostUsd: number
  run: Json & { startedAt: string; finishedAt: string; usageTotalUsd: number }
  dataset: Json[]
  runSummary: Json
  input: { actorInput: Json; runOptions: { memory: number; timeout: number } }
}

const FIXTURES = new URL('../../../../fixtures/listings/', import.meta.url)
const read = (path: string) => JSON.parse(readFileSync(new URL(path, FIXTURES), 'utf8'))

/** A recorded run, e.g. `facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`. */
export function loadRun(run: string): RecordedRun {
  const meta = read(`${run}/run.json`)
  return {
    apifyRunId: meta.apifyRunId,
    reserveUsd: meta.reserveUsd,
    settledCostUsd: meta.settledCostUsd,
    run: meta.run,
    dataset: read(`${run}/dataset.json`),
    runSummary: read(`${run}/run-summary.json`),
    input: read(`${run}/input.json`),
  }
}

/** claim_next_job(), as each invocation starts; returns the claimed job's id and status. */
export async function claim(t: TestDatabase) {
  const [job] = await t.sql('select id, kind, status from apify_gateway.claim_next_job()')
  return job as { id: number; kind: string; status: string } | undefined
}

/** startRun(): the run is started and its ID stored. */
export async function start(t: TestDatabase, jobId: number, recorded: RecordedRun) {
  await t.sql(
    `update apify_gateway.jobs set apify_run_id = $1, result = $2::jsonb, updated_at = now() where id = $3`,
    [
      recorded.apifyRunId,
      JSON.stringify({
        startedAt: recorded.run.startedAt,
        buildNumber: '1.0.83',
        status: 'RUNNING',
      }),
      jobId,
    ],
  )
}

/** storeRun(): every row, then the run object with itemCount and RUN_SUMMARY, then the status. */
export async function store(
  t: TestDatabase,
  jobId: number,
  recorded: RecordedRun,
  costUsd: number | null,
) {
  await t.sql(
    `insert into apify_gateway.items (job_id, seq, item)
     select $1, (ord - 1)::integer, value
     from jsonb_array_elements($2::jsonb) with ordinality as t (value, ord)
     on conflict do nothing`,
    [jobId, JSON.stringify(recorded.dataset)],
  )
  await t.sql(
    `update apify_gateway.jobs
     set status = 'succeeded', apify_run_id = $2,
         result = $3::jsonb || jsonb_build_object('itemCount', $4::integer, 'runSummary', $5::jsonb),
         cost_usd = coalesce($6::numeric, cost_usd), updated_at = now()
     where id = $1 and status = 'running'`,
    [
      jobId,
      recorded.apifyRunId,
      JSON.stringify({ ...recorded.run, id: recorded.apifyRunId }),
      recorded.dataset.length,
      JSON.stringify(recorded.runSummary),
      costUsd,
    ],
  )
}

/** The settlement pass: the final cost, read 10 minutes after the finish. */
export async function settleCost(t: TestDatabase, jobId: number, recorded: RecordedRun) {
  await t.sql(
    `update apify_gateway.jobs
     set cost_usd = $2, settled_at = ($3::timestamptz + interval '10 minutes'), updated_at = now()
     where id = $1 and settled_at is null`,
    [jobId, recorded.settledCostUsd, recorded.run.finishedAt],
  )
}

/** A free `collect` job, queued the way the operator queues one (supabase/README.md). */
export async function queueCollect(t: TestDatabase, apifyRunId: string): Promise<number> {
  const [row] = await t.sql(
    `insert into apify_gateway.jobs (kind, input) values ('collect', $1::jsonb) returning id`,
    [JSON.stringify({ apifyRunId })],
  )
  return Number(row?.id)
}
