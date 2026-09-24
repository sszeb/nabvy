// apify-gateway: the only code that holds the Apify token and calls Apify (see supabase/README.md).
// It takes no instructions from the request. Each invocation works through jobs queued in the
// apify_gateway schema, which only the database owner can write, and the spend cap is enforced
// there by claim_next_job(). Anyone who invokes it can only make it process jobs already queued.
import { Pool, type PoolClient } from 'jsr:@db/postgres@0.19.5'

const APIFY = 'https://api.apify.com/v2'
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'])
const MAX_ITEMS = 1000
const MAX_CLAIMS = 10

type Json = Record<string, unknown>
type Job = {
  id: number
  kind: 'env_check' | 'actor_info' | 'run'
  status: string
  input: Json
  run_options: { memory?: number; timeout?: number }
  apify_run_id: string | null
}
type Apify = (path: string, init?: RequestInit) => Promise<unknown>

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

const vaultTokenQuery =
  "select decrypted_secret as secret from vault.decrypted_secrets where name = 'apify_token'"

// The token comes from the Edge Function secret APIFY_TOKEN when that is set, otherwise from the
// Vault secret apify_token (stored there on the owner's instruction). Never logged or returned.
async function apifyToken(client: PoolClient): Promise<string> {
  const fromEnv = Deno.env.get('APIFY_TOKEN')
  if (fromEnv) return fromEnv
  const fromVault = (await client.queryObject<{ secret: string }>(vaultTokenQuery)).rows[0]?.secret
  if (fromVault) return fromVault
  throw new Error('No Apify token: neither the APIFY_TOKEN secret nor the Vault secret apify_token')
}

// Resolves the token on first use, so an invocation with no Apify work never reads it.
function apifyClient(client: PoolClient): Apify {
  let token: Promise<string> | undefined
  return async (path, init = {}) => {
    token ??= apifyToken(client)
    const response = await fetch(`${APIFY}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    if (!response.ok) {
      const route = path.split('?')[0]
      throw new Error(
        `Apify ${init.method ?? 'GET'} ${route} returned ${response.status}: ${text.slice(0, 300)}`,
      )
    }
    return text ? JSON.parse(text) : null
  }
}

async function envCheck(client: PoolClient): Promise<Json> {
  const vault = await client.queryObject<{ secret: string }>(vaultTokenQuery)
  return {
    apifyEnvNames: apifyEnvNames(),
    vaultSecretPresent: Boolean(vault.rows[0]?.secret),
    hasDbUrl: Boolean(Deno.env.get('SUPABASE_DB_URL')),
  }
}

async function actorInfo(apify: Apify, actorId: string): Promise<Json> {
  const act = obj(obj(await apify(`/acts/${actorId}`)).data)
  const buildId = obj(obj(act.taggedBuilds).latest).buildId
  const build =
    typeof buildId === 'string' ? obj(obj(await apify(`/actor-builds/${buildId}`)).data) : {}
  const runs = obj(obj(await apify(`/acts/${actorId}/runs?desc=1&limit=20`)).data).items
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

async function startRun(client: PoolClient, apify: Apify, actorId: string, job: Job) {
  const { memory, timeout } = job.run_options
  if (!memory || !timeout) {
    throw new Error('run_options.memory and run_options.timeout are required')
  }
  const query = new URLSearchParams({ memory: String(memory), timeout: String(timeout) })
  const run = obj(
    obj(
      await apify(`/acts/${actorId}/runs?${query}`, {
        method: 'POST',
        body: JSON.stringify(job.input),
      }),
    ).data,
  )
  await client.queryArray(
    `update apify_gateway.jobs set apify_run_id = $1, result = $2::jsonb, updated_at = now() where id = $3`,
    [String(run.id), JSON.stringify(pick(run, ['startedAt', 'buildNumber', 'status'])), job.id],
  )
}

async function pollRun(client: PoolClient, apify: Apify, job: Job) {
  const run = obj(obj(await apify(`/actor-runs/${job.apify_run_id}`)).data)
  if (!TERMINAL.has(String(run.status))) return false
  const items = run.defaultDatasetId
    ? await apify(
        `/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${MAX_ITEMS}`,
      )
    : []
  let runSummary: unknown = null
  try {
    runSummary = await apify(`/key-value-stores/${run.defaultKeyValueStoreId}/records/RUN_SUMMARY`)
  } catch (error) {
    runSummary = { unavailable: message(error) }
  }
  const rows = Array.isArray(items) ? items : []
  await client.queryArray(
    `insert into apify_gateway.items (job_id, seq, item)
     select $1, (t.ord - 1)::integer, t.value from jsonb_array_elements($2::jsonb) with ordinality as t(value, ord)
     on conflict do nothing`,
    [job.id, JSON.stringify(rows)],
  )
  await client.queryArray(
    `update apify_gateway.jobs set status = $1, cost_usd = $2, result = $3::jsonb, updated_at = now()
     where id = $4 and status = 'running'`,
    [
      run.status === 'SUCCEEDED' ? 'succeeded' : 'failed',
      Number(run.usageTotalUsd ?? 0),
      JSON.stringify({
        ...pick(run, [
          'status',
          'statusMessage',
          'startedAt',
          'finishedAt',
          'buildNumber',
          'stats',
          'usage',
          'usageTotalUsd',
          'options',
        ]),
        itemCount: rows.length,
        runSummary,
      }),
      job.id,
    ],
  )
  return true
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)
  const client = await pool.connect()
  try {
    const settings = (
      await client.queryObject<{ actor_id: string }>('select actor_id from apify_gateway.settings')
    ).rows[0]
    if (!settings) throw new Error('apify_gateway.settings is empty')
    const apify = apifyClient(client)
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
        if (job.kind === 'env_check') {
          await finish(client, job.id, 'succeeded', await envCheck(client))
        } else if (job.kind === 'actor_info') {
          await finish(client, job.id, 'succeeded', await actorInfo(apify, settings.actor_id))
        } else {
          await startRun(client, apify, settings.actor_id, job)
        }
        processed.push({
          id: job.id,
          kind: job.kind,
          outcome: job.kind === 'run' ? 'started' : 'succeeded',
        })
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
        polled.push({ id: job.id, finished: await pollRun(client, apify, job) })
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
        const run = obj(obj(await apify(`/actor-runs/${job.apify_run_id}`)).data)
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
