// Database access to the module's own schema, apify_gateway, as nabvy_pipeline (inside
// withPipeline). The pipeline can call enqueue_run(…, tags) and invoke(), read the tables beneath
// the published views, and set the watcher's three times; nothing else (the module's migration).
import type { Queryable } from '@nabvy/db'
import { jobs, vJobs } from '@nabvy/db/schema/apify-gateway'
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

/** Queues a run through the gateway's SQL, which validates it and reserves its cost. */
export async function enqueueRun(
  q: Queryable,
  args: { input: unknown; memoryMb: number; timeoutSecs: number; note: string; tags: unknown },
): Promise<{ jobId: number; reserveUsd: string }> {
  const [row] = rowsOf<{ id: number }>(
    await q.execute(
      sql`select apify_gateway.enqueue_run(${JSON.stringify(args.input)}::jsonb, ${args.memoryMb}::integer,
        ${args.timeoutSecs}::integer, ${args.note}, ${JSON.stringify(args.tags)}::jsonb) as id`,
    ),
  )
  if (!row) throw new Error('apify-gateway: enqueue_run returned no job')
  const [job] = await q
    .select({ reserveUsd: jobs.reserveUsd })
    .from(jobs)
    .where(eq(jobs.id, Number(row.id)))
  if (!job) throw new Error(`apify-gateway: job ${row.id} vanished after enqueue`)
  return { jobId: Number(row.id), reserveUsd: job.reserveUsd }
}

/** Asks the Edge Function to work through the queue (pg_net sends it after commit). */
export async function invoke(q: Queryable): Promise<void> {
  await q.execute(sql`select apify_gateway.invoke()`)
}

/** Whether the Edge Function has anything to do: queued or running jobs, or costs to settle. */
export async function hasOpenWork(q: Queryable): Promise<boolean> {
  const [row] = rowsOf<{ open: boolean }>(
    await q.execute(sql`select exists (
      select 1 from apify_gateway.jobs
      where status in ('pending', 'running')
         or (kind = 'run' and apify_run_id is not null and settled_at is null
             and status in ('succeeded', 'failed'))
    ) as open`),
  )
  return Boolean(row?.open)
}

const startedAt = sql<string | null>`${jobs.result} ->> 'startedAt'`
const finishedAt = sql<string | null>`${jobs.result} ->> 'finishedAt'`
const runKind = sql<
  'search' | 'details' | null
>`apify_gateway.run_kind(${jobs.kind}, ${jobs.input}, ${jobs.result})`

/** Started paid runs whose reservation is not yet in cost-meter. */
export function selectToMeter(q: Queryable, limit: number) {
  return q
    .select({
      id: jobs.id,
      apifyRunId: jobs.apifyRunId,
      reserveUsd: jobs.reserveUsd,
      startedAt,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(and(eq(jobs.kind, 'run'), isNotNull(jobs.apifyRunId), isNull(jobs.meteredAt)))
    .orderBy(asc(jobs.id))
    .limit(limit)
}

/**
 * Finished jobs whose rows are stored (the Edge Function adds `itemCount` only once every row
 * matched the dataset) and that are not yet announced. Jobs whose run kind is unknown wait.
 */
export function selectToAnnounce(q: Queryable, limit: number) {
  return q
    .select({ id: jobs.id, apifyRunId: jobs.apifyRunId, runKind })
    .from(jobs)
    .where(
      and(
        isNull(jobs.announcedAt),
        inArray(jobs.kind, ['run', 'collect']),
        inArray(jobs.status, ['succeeded', 'failed']),
        isNotNull(jobs.apifyRunId),
        sql`${jobs.result} ? 'itemCount'`,
        sql`${runKind} is not null`,
      ),
    )
    .orderBy(asc(jobs.id))
    .limit(limit)
}

/** Settled paid runs, already metered, whose settlement is not yet in cost-meter. */
export function selectToSettle(q: Queryable, limit: number) {
  return q
    .select({
      id: jobs.id,
      apifyRunId: jobs.apifyRunId,
      costUsd: jobs.costUsd,
      status: jobs.status,
      finishedAt,
      settledAt: jobs.settledAt,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, 'run'),
        isNotNull(jobs.settledAt),
        isNotNull(jobs.meteredAt),
        isNull(jobs.settleAnnouncedAt),
      ),
    )
    .orderBy(asc(jobs.id))
    .limit(limit)
}

type WatchTime = 'meteredAt' | 'announcedAt' | 'settleAnnouncedAt'

/** Sets one watcher time on jobs that do not have it yet; a replay changes nothing. */
export async function markJobs(q: Queryable, column: WatchTime, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const marked = await q
    .update(jobs)
    .set({ [column]: sql`now()` })
    .where(and(inArray(jobs.id, ids), isNull(jobs[column])))
    .returning({ id: jobs.id })
  return marked.length
}

/** Rows of v_jobs by ID. */
export function selectJobs(q: Queryable, ids: number[]) {
  return q.select().from(vJobs).where(inArray(vJobs.id, ids)).orderBy(asc(vJobs.id))
}
