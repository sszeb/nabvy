// Public API of the apify-gateway module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/apify-gateway' only, never from its internals. Only the
// Edge Function supabase/functions/apify-gateway holds the Apify token and calls Apify; this
// package queues its jobs, watches them and announces what they collected (README.md).

import { APIFY_GATEWAY_WATCH_BATCH_SIZE } from '@nabvy/config/modules/apify-gateway'
import { createEvent, type EventEnvelope, ok, type Result } from '@nabvy/contracts'
import {
  type ApifyGatewayError,
  ApifyGatewayJob,
  type ApifyGatewayRunKind,
  ApifyGatewaySubmitRunInput,
  type ApifyGatewaySubmitted,
  events,
} from '@nabvy/contracts/modules/apify-gateway'
import { record, settle } from '@nabvy/cost-meter'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import type { Publisher } from '@nabvy/transport'
import {
  checkShape,
  collectedKey,
  failure,
  type GatewaySwitches,
  gatewayOpen,
  refusalMessage,
  settledKey,
  usdToMicros,
} from './domain'
import {
  enqueueRun,
  hasOpenWork,
  invoke,
  markJobs,
  selectJobs,
  selectToAnnounce,
  selectToMeter,
  selectToSettle,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/apify-gateway'
export { type GatewaySwitches, gatewayOpen, runKindOfInput, usdToMicros } from './domain'

const MODULE = 'apify-gateway'

/** The gateway's switches, each read through `@nabvy/switches`, which fails closed to `off`. */
export async function readSwitches(q: Queryable): Promise<GatewaySwitches> {
  return {
    module: await state(q, MODULE),
    apify: await state(q, 'apify'),
    pipeline: await state(q, 'pipeline'),
    costMeter: await state(q, 'cost-meter'),
  }
}

/**
 * Queues one run: the only way a module starts Apify work (`check-scheduler`, `details-queue`).
 * Refuses while the module, the `apify` provider or the pipeline is off, or while `cost-meter` is
 * off (paid work pauses rather than spend unmetered). The gateway's SQL then validates the input
 * and reserves its worst-case cost; a refusal comes back as `apify-gateway.refused` with its
 * reason. Finally it asks the Edge Function to start at once. The run itself starts only if the
 * monthly cap allows it; a refused job is visible in `v_jobs`.
 */
export async function submitRun(
  q: Queryable,
  request: ApifyGatewaySubmitRunInput,
): Promise<Result<ApifyGatewaySubmitted, ApifyGatewayError>> {
  const run = ApifyGatewaySubmitRunInput.parse(request)
  const switches = await readSwitches(q)
  if (!gatewayOpen(switches)) {
    return failure(
      'apify-gateway.off',
      'The apify-gateway module, the apify provider or the pipeline is switched off: no run starts.',
    )
  }
  if (switches.costMeter === 'off') {
    return failure(
      'apify-gateway.cost_meter_off',
      'The cost meter is off: paid work pauses until it is back on.',
    )
  }
  const shape = checkShape(run.shape, run.input)
  if (!shape.ok) return shape

  let submitted: ApifyGatewaySubmitted
  try {
    // A savepoint inside the caller's transaction, so a refusal leaves it usable.
    submitted = await q.transaction((tx) =>
      enqueueRun(tx, {
        input: run.input,
        memoryMb: run.memoryMb,
        timeoutSecs: run.timeoutSecs,
        note: run.note ?? `${run.tags.module}: ${run.shape}`,
        tags: { ...run.tags, shape: run.shape },
      }),
    )
  } catch (error) {
    return failure('apify-gateway.refused', refusalMessage(error))
  }
  // Start at once (runtime joint A2). If the request cannot be queued, the watcher's next tick
  // invokes the gateway anyway, so the job only waits.
  await q.transaction((tx) => invoke(tx)).catch(() => undefined)
  return ok(submitted)
}

/** What one watcher tick did. */
export interface WatchReport {
  /** False when the gateway is switched off: the tick wrote and published nothing. */
  open: boolean
  metered: number[]
  collected: number[]
  settled: number[]
  invoked: boolean
  /** Jobs left for the next tick, with the reason (the cost meter refused or is off). */
  deferred: { jobId: number; reason: string }[]
}

export interface WatchDeps {
  publisher: Publisher
  /** Today's USD_GBP_RATE (`loadEnv(['exchangeRate'])`), for cost-meter's GBP amounts. */
  usdGbpRate: number
}

const iso = (value: Date | string) => new Date(value).toISOString()

/**
 * One tick of the `apify-gateway-watch` task (runtime joint B1, every minute). Records the
 * reservation of each started run in cost-meter; emits `apify-gateway.run-collected` once per
 * collected job; settles each run's final cost in cost-meter and emits `apify-gateway.run-settled`
 * once; then invokes the gateway while it has work. Events are published before a job is marked,
 * and keyed by job ID, so a tick that fails between the two publishes the same key again and the
 * transport drops the repeat. Safe to run twice: the second run writes and publishes nothing.
 */
export async function watch(q: Queryable, deps: WatchDeps): Promise<WatchReport> {
  const report: WatchReport = {
    open: false,
    metered: [],
    collected: [],
    settled: [],
    invoked: false,
    deferred: [],
  }
  const switches = await readSwitches(q)
  if (!gatewayOpen(switches)) return report
  report.open = true
  const ctx = { state: switches.costMeter, usdGbpRate: deps.usdGbpRate }
  const limit = APIFY_GATEWAY_WATCH_BATCH_SIZE

  // 1. Reservations of started runs.
  for (const job of await selectToMeter(q, limit)) {
    const recorded = await record(
      q,
      {
        module: MODULE,
        provider: 'apify',
        refId: job.apifyRunId as string,
        currency: 'USD',
        reservedMicros: usdToMicros(job.reserveUsd),
        status: 'pending',
        at: iso(job.startedAt ?? job.createdAt),
      },
      ctx,
    )
    if (recorded.ok) report.metered.push(job.id)
    else report.deferred.push({ jobId: job.id, reason: recorded.error.code })
  }
  await markJobs(q, 'meteredAt', report.metered)

  // 2. run-collected, once per job.
  const collected = await selectToAnnounce(q, limit)
  if (collected.length > 0) {
    await deps.publisher.publish(
      collected.map((job) =>
        createEvent(
          events,
          'apify-gateway.run-collected',
          1,
          {
            jobId: job.id,
            apifyRunId: job.apifyRunId as string,
            kind: job.runKind as ApifyGatewayRunKind,
          },
          { key: collectedKey(job.id) },
        ),
      ) as EventEnvelope[],
    )
    report.collected = collected.map((job) => job.id)
    await markJobs(q, 'announcedAt', report.collected)
  }

  // 3. Settled costs, then run-settled, once per paid run.
  const settledEvents: EventEnvelope[] = []
  for (const job of await selectToSettle(q, limit)) {
    if (!job.finishedAt || job.costUsd === null || !job.settledAt) {
      report.deferred.push({ jobId: job.id, reason: 'apify-gateway.no_finish_time' })
      continue
    }
    const settled = await settle(
      q,
      {
        provider: 'apify',
        refId: job.apifyRunId as string,
        currency: 'USD',
        settledMicros: usdToMicros(job.costUsd),
        status: job.status === 'succeeded' ? 'succeeded' : 'failed',
        finishedAt: iso(job.finishedAt),
        readAt: iso(job.settledAt),
      },
      ctx,
    )
    if (!settled.ok) {
      report.deferred.push({ jobId: job.id, reason: settled.error.code })
      continue
    }
    settledEvents.push(
      createEvent(
        events,
        'apify-gateway.run-settled',
        1,
        { jobId: job.id },
        { key: settledKey(job.id) },
      ) as EventEnvelope,
    )
    report.settled.push(job.id)
  }
  if (settledEvents.length > 0) {
    await deps.publisher.publish(settledEvents)
    await markJobs(q, 'settleAnnouncedAt', report.settled)
  }

  // 4. Keep the gateway moving while it has work (runtime joint A, without pg_cron).
  if (await hasOpenWork(q)) {
    await q.transaction((tx) => invoke(tx)).catch(() => undefined)
    report.invoked = true
  }
  return report
}

/** Jobs as `v_jobs` shows them, for callers that hold job IDs (a refused run, a finished one). */
export async function readJobs(q: Queryable, jobIds: number[]): Promise<ApifyGatewayJob[]> {
  if (jobIds.length === 0) return []
  return (await selectJobs(q, jobIds)).map((row) =>
    ApifyGatewayJob.parse({
      ...row,
      startedAt: row.startedAt && iso(row.startedAt),
      finishedAt: row.finishedAt && iso(row.finishedAt),
      settledAt: row.settledAt && iso(row.settledAt),
      announcedAt: row.announcedAt && iso(row.announcedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }),
  )
}
