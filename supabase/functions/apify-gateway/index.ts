// apify-gateway: the only code that holds the Apify token and calls Apify (see supabase/README.md).
// It takes no instructions from the request. Each invocation works through jobs queued in the
// apify_gateway schema, which only the database owner can write, and the spend cap is enforced
// there by claim_next_job(). Anyone who invokes it can only make it process jobs already queued.
//
// Collection is lossless (owner's decision: keep everything the actor returns): every dataset page
// is downloaded without Apify's "clean" filter, and raw response text goes straight to Postgres,
// never through JavaScript number parsing.
//
// The apify-gateway module (services/apify-gateway) owns this function. It works only while
// apify_gateway.enabled() is true (the module switch not off, the `apify` provider and the global
// `pipeline` switch on); otherwise an invocation does nothing at all. Runs start on the pinned
// build (settings.actor_build).
import { Pool, type PoolClient } from 'jsr:@db/postgres@0.19.5'

const APIFY = 'https://api.apify.com/v2'
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'])
const MAX_CLAIMS = 10

type Json = Record<string, unknown>
type Job = {
  id: number
  kind: 'env_check' | 'actor_info' | 'run' | 'collect'
  status: string
  input: Json
  run_options: { memory?: number; timeout?: number }
  apify_run_id: string | null
}
type Settings = { actor_id: string; actor_build: string; download_page_size: number }
type Apify = {
  /** Response body as text, exactly as Apify sent it. */
  text: (path: string, init?: RequestInit) => Promise<string>
  /** Response body parsed, for control decisions only; stored data always uses `text`. */
  json: (path: string, init?: RequestInit) => Promise<Json>
}

class ApifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const pool = new Pool(Deno.env.get('SUPABASE_DB_URL') ?? '', 1, true)

const obj = (value: unknown): Json =>
  value !== null && typeof value === 'object' ? (value as Json) : {}
const pick = (source: unknown, keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, obj(source)[key]]))
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 1000)
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Names only, never values.
const apifyEnvNames = () =>
  Object.keys(Deno.env.toObject())
    .filter((name) => /apify/i.test(name))
    .sort()
// Secrets the project added itself, so a token saved under an unexpected name can be found.
const PLATFORM_ENV = /^(SUPABASE_|SB_|DENO|EDGE_|OTEL_|NODE_|PATH$|HOME$|HOSTNAME$|PWD$|LANG$|TZ$)/
const customEnvNames = () =>
  Object.keys(Deno.env.toObject())
    .filter((name) => !PLATFORM_ENV.test(name))
    .sort()

// The token is the Edge Function secret APIFY_TOKEN. It is never logged or returned.
function apifyToken(): string {
  const token = Deno.env.get('APIFY_TOKEN')
  if (!token) throw new Error('No Apify token: the APIFY_TOKEN Edge Function secret is not set')
  return token
}

function apifyClient(): Apify {
  const text = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${APIFY}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apifyToken()}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    })
    const body = await response.text()
    if (!response.ok) {
      const route = path.split('?')[0]
      throw new ApifyError(
        `Apify ${init.method ?? 'GET'} ${route} returned ${response.status}: ${body.slice(0, 300)}`,
        response.status,
      )
    }
    return body
  }
  return { text, json: async (path, init) => obj(JSON.parse((await text(path, init)) || 'null')) }
}

function envCheck(): Json {
  return {
    apifyEnvNames: apifyEnvNames(),
    customEnvNames: customEnvNames(),
    hasDbUrl: Boolean(Deno.env.get('SUPABASE_DB_URL')),
  }
}

async function actorInfo(apify: Apify, actorId: string): Promise<Json> {
  const act = obj((await apify.json(`/acts/${actorId}`)).data)
  const buildId = obj(obj(act.taggedBuilds).latest).buildId
  const build =
    typeof buildId === 'string' ? obj((await apify.json(`/actor-builds/${buildId}`)).data) : {}
  const runs = obj((await apify.json(`/acts/${actorId}/runs?desc=1&limit=20`)).data).items
  const inputSchema =
    typeof build.inputSchema === 'string' ? obj(JSON.parse(build.inputSchema)) : {}
  return {
    actor: pick(act, [
      'id',
      'name',
      'title',
      'isPublic',
      'modifiedAt',
      'defaultRunOptions',
      'actorStandby',
      'stats',
    ]),
    latestBuild: {
      ...pick(build, ['id', 'buildNumber', 'status', 'finishedAt']),
      inputFields: Object.keys(obj(inputSchema.properties)),
    },
    recentRuns: (Array.isArray(runs) ? runs : []).map((run) =>
      pick(run, [
        'id',
        'status',
        'startedAt',
        'finishedAt',
        'buildNumber',
        'usageTotalUsd',
        'meta',
      ]),
    ),
  }
}

async function finish(
  client: PoolClient,
  id: number,
  status: string,
  result: unknown,
  error?: string,
) {
  await client.queryArray(
    `update apify_gateway.jobs set status = $1, result = $2::jsonb, error = $3, updated_at = now()
     where id = $4`,
    [status, JSON.stringify(result ?? null), error ?? null, id],
  )
}

async function startRun(client: PoolClient, apify: Apify, settings: Settings, job: Job) {
  const { memory, timeout } = job.run_options
  if (!memory || !timeout) {
    throw new Error('run_options.memory and run_options.timeout are required')
  }
  const query = new URLSearchParams({
    build: settings.actor_build,
    memory: String(memory),
    timeout: String(timeout),
  })
  const run = obj(
    (
      await apify.json(`/acts/${settings.actor_id}/runs?${query}`, {
        method: 'POST',
        body: JSON.stringify(job.input),
      })
    ).data,
  )
  await client.queryArray(
    `update apify_gateway.jobs set apify_run_id = $1, result = $2::jsonb, updated_at = now() where id = $3`,
    [String(run.id), JSON.stringify(pick(run, ['startedAt', 'buildNumber', 'status'])), job.id],
  )
}

// Every dataset row, page by page until a short page. No `clean`: Apify then keeps empty rows and
// hidden fields. The page text is inserted as-is, so numbers keep their exact digits. Each page is
// stored in one statement, so the stored rows are always seq 0..n-1 without gaps; a download that
// an earlier invocation left short resumes after the last stored row instead of starting again.
async function downloadDataset(
  client: PoolClient,
  apify: Apify,
  jobId: number,
  datasetId: string,
  pageSize: number,
): Promise<number> {
  const stored = await client.queryObject<{ next: number }>(
    'select coalesce(max(seq) + 1, 0)::integer as next from apify_gateway.items where job_id = $1',
    [jobId],
  )
  let offset = stored.rows[0]?.next ?? 0
  for (;;) {
    const page = await apify.text(
      `/datasets/${datasetId}/items?format=json&offset=${offset}&limit=${pageSize}`,
    )
    const counted = await client.queryObject<{ rows: number }>(
      `with page as (
         select value, ord from jsonb_array_elements($2::jsonb) with ordinality as t (value, ord)
       ), stored as (
         insert into apify_gateway.items (job_id, seq, item)
         select $1, $3 + (ord - 1)::integer, value from page
         on conflict do nothing
       )
       select count(*)::integer as rows from page`,
      [jobId, page, offset],
    )
    const rows = counted.rows[0]?.rows ?? 0
    offset += rows
    if (rows < pageSize) break
  }
  // Refuse to finish short: the job stays open and the next invocation downloads again.
  const expected = Number(obj((await apify.json(`/datasets/${datasetId}`)).data).itemCount ?? 0)
  if (offset < expected) {
    throw new Error(`downloaded ${offset} of ${expected} dataset rows; will retry`)
  }
  return offset
}

// The RUN_SUMMARY record as raw text; null only when the run has none. Other failures throw, so
// the job stays open and the next invocation tries again.
async function readRunSummary(apify: Apify, keyValueStoreId: unknown): Promise<string | null> {
  if (typeof keyValueStoreId !== 'string') return null
  try {
    return await apify.text(`/key-value-stores/${keyValueStoreId}/records/RUN_SUMMARY`)
  } catch (error) {
    if (error instanceof ApifyError && error.status === 404) return null
    throw error
  }
}

// Downloads a finished run's dataset and summary into the job and returns the row count. The whole
// Apify run object is stored as `result`, with `itemCount` and `runSummary` added.
async function storeRun(
  client: PoolClient,
  apify: Apify,
  job: Job,
  runText: string,
  run: Json,
  pageSize: number,
  status: string,
  costUsd: number | null,
) {
  const itemCount =
    typeof run.defaultDatasetId === 'string'
      ? await downloadDataset(client, apify, job.id, run.defaultDatasetId, pageSize)
      : 0
  const runSummary = await readRunSummary(apify, run.defaultKeyValueStoreId)
  await client.queryArray(
    `update apify_gateway.jobs
     set status = $1,
         result = ($2::jsonb -> 'data') || jsonb_build_object('itemCount', $3::integer, 'runSummary', $4::jsonb),
         cost_usd = coalesce($5::numeric, cost_usd),
         updated_at = now()
     where id = $6 and status = 'running'`,
    [status, runText, itemCount, runSummary, costUsd, job.id],
  )
  return itemCount
}

async function pollRun(client: PoolClient, apify: Apify, job: Job, pageSize: number) {
  const runText = await apify.text(`/actor-runs/${job.apify_run_id}`)
  const run = obj(obj(JSON.parse(runText)).data)
  if (!TERMINAL.has(String(run.status))) return false
  await storeRun(
    client,
    apify,
    job,
    runText,
    run,
    pageSize,
    run.status === 'SUCCEEDED' ? 'succeeded' : 'failed',
    Number(run.usageTotalUsd ?? 0),
  )
  return true
}

// Re-downloads a finished run of the configured actor into a free `collect` job.
async function collectRun(
  client: PoolClient,
  apify: Apify,
  settings: Settings,
  job: Job,
): Promise<number> {
  const runId = String(job.input.apifyRunId ?? '')
  if (!/^[A-Za-z0-9]{17}$/.test(runId)) throw new Error('collect needs input.apifyRunId')
  const runText = await apify.text(`/actor-runs/${runId}`)
  const run = obj(obj(JSON.parse(runText)).data)
  if (run.actId !== settings.actor_id)
    throw new Error('collect only reads runs of the configured actor')
  if (!TERMINAL.has(String(run.status))) throw new Error(`run ${runId} has not finished`)
  await client.queryArray(`update apify_gateway.jobs set apify_run_id = $1 where id = $2`, [
    runId,
    job.id,
  ])
  return storeRun(client, apify, job, runText, run, settings.download_page_size, 'succeeded', null)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)
  const client = await pool.connect()
  try {
    const gate = await client.queryObject<{ enabled: boolean }>(
      'select apify_gateway.enabled() as enabled',
    )
    if (!gate.rows[0]?.enabled) return json({ off: true, processed: [], polled: [], settled: [] })
    const settings = (
      await client.queryObject<Settings>(
        'select actor_id, actor_build, download_page_size from apify_gateway.settings',
      )
    ).rows[0]
    if (!settings) throw new Error('apify_gateway.settings is empty')
    const apify = apifyClient()
    const processed: Array<{ id: number; kind: string; outcome: string }> = []

    for (let claims = 0; claims < MAX_CLAIMS; claims++) {
      const job = (await client.queryObject<Job>('select * from apify_gateway.claim_next_job()'))
        .rows[0]
      if (!job) break
      if (job.status === 'refused') {
        processed.push({ id: job.id, kind: job.kind, outcome: 'refused' })
        continue
      }
      try {
        let outcome = 'succeeded'
        if (job.kind === 'env_check') {
          await finish(client, job.id, 'succeeded', envCheck())
        } else if (job.kind === 'actor_info') {
          await finish(client, job.id, 'succeeded', await actorInfo(apify, settings.actor_id))
        } else if (job.kind === 'collect') {
          outcome = `collected ${await collectRun(client, apify, settings, job)} rows`
        } else {
          await startRun(client, apify, settings, job)
          outcome = 'started'
        }
        processed.push({ id: job.id, kind: job.kind, outcome })
      } catch (error) {
        await finish(client, job.id, 'failed', null, message(error))
        processed.push({ id: job.id, kind: job.kind, outcome: 'failed' })
      }
    }

    const running = (
      await client.queryObject<Job>(
        `select * from apify_gateway.jobs
         where kind = 'run' and status = 'running' and apify_run_id is not null order by id`,
      )
    ).rows
    const polled: Array<{ id: number; finished: boolean; error?: string }> = []
    for (const job of running) {
      try {
        polled.push({
          id: job.id,
          finished: await pollRun(client, apify, job, settings.download_page_size),
        })
      } catch (error) {
        polled.push({ id: job.id, finished: false, error: message(error) })
      }
    }
    // Apify finalises usage a few minutes after a run ends; re-read it once to settle the cost.
    const unsettled = (
      await client.queryObject<Job>(
        `select * from apify_gateway.jobs
         where kind = 'run' and apify_run_id is not null and status in ('succeeded', 'failed')
           and settled_at is null
           and coalesce((result ->> 'finishedAt')::timestamptz, updated_at) < now() - interval '10 minutes'
         order by id`,
      )
    ).rows
    const settled: Array<{ id: number; error?: string }> = []
    for (const job of unsettled) {
      try {
        const run = obj((await apify.json(`/actor-runs/${job.apify_run_id}`)).data)
        await client.queryArray(
          `update apify_gateway.jobs set cost_usd = $1, settled_at = now(), updated_at = now()
           where id = $2 and settled_at is null`,
          [Number(run.usageTotalUsd ?? 0), job.id],
        )
        settled.push({ id: job.id })
      } catch (error) {
        settled.push({ id: job.id, error: message(error) })
      }
    }
    return json({ processed, polled, settled })
  } catch (error) {
    return json({ error: message(error) }, 500)
  } finally {
    client.release()
  }
})
