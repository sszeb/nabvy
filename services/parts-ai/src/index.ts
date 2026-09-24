// Public API of the parts-ai module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/parts-ai' only, never from its internals. It fills the gaps the
// rules leave with at most one model call per listing version, shared by every user (README.md).
// The model names facts and quotes only; every quote is checked against the stored text and
// every product is resolved through product-catalogue. No price, no invented number.

import {
  PARTS_AI_ALLOWED_THROTTLE_LEVELS,
  PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS,
  PARTS_AI_EVENT_BATCH_SIZE,
  PARTS_AI_MAX_CALLS_PER_BATCH,
  PARTS_AI_MAX_DESCRIPTION_CHARS,
  PARTS_AI_MAX_INPUT_TOKENS,
  PARTS_AI_MAX_OUTPUT_TOKENS,
} from '@nabvy/config/modules/parts-ai'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import type { CostMeterError } from '@nabvy/contracts/modules/cost-meter'
import { events, PartsAiCorrection, PartsAiOutput } from '@nabvy/contracts/modules/parts-ai'
import {
  contextFor,
  MODEL_PRICES_NANO_USD,
  modelCostMicros,
  recordModelCall,
  toGbpMicros,
} from '@nabvy/cost-meter'
import type { Queryable } from '@nabvy/db'
import { enqueue } from '@nabvy/details-queue'
import { RULE_VERSION } from '@nabvy/parts-rules'
import { resolve } from '@nabvy/product-catalogue'
import { redact } from '@nabvy/quote-redaction'
import { readThrottle } from '@nabvy/spend-governor'
import { isOn, state } from '@nabvy/switches'
import {
  asksFor,
  type CheckedPart,
  check,
  chunk,
  extractedKey,
  numbersAgree,
  PARTS_AI_OUTPUT_SCHEMA,
  PARTS_AI_PROMPT_VERSION,
  PARTS_AI_SYSTEM_PROMPT,
  type PartsAiClient,
  passesCap,
  userMessage,
} from './domain'
import {
  type CallRow,
  deleteListings,
  insertCall,
  insertRefreshes,
  lockBatches,
  type StoredPart,
  selectDone,
  selectNow,
  selectPending,
  selectTargets,
  spentLastDay,
  type Target,
  updateCorrection,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/parts-ai'
export {
  createRecordedPartsClient,
  PARTS_AI_OUTPUT_SCHEMA,
  PARTS_AI_PROMPT_VERSION,
  PARTS_AI_SYSTEM_PROMPT,
  type PartsAiClient,
  type PartsAiRequest,
  type PartsAiResponse,
  promptVersion,
} from './domain'
export { partsRulesRanHandler } from './handlers'

const MODULE = 'parts-ai'
/** The model provider's own kill switch (services/switches/README.md, "Decisions"). */
const PROVIDER_SWITCH = 'anthropic'

export interface PartsAiDeps {
  client: PartsAiClient
  /**
   * The prompt to run with. Only the evaluation harness passes another one (a deliberately
   * weakened prompt must fail it, backlog 1.5a); the pipeline always runs the module's own.
   */
  prompt?: { system: string; version: string }
}

export interface PartsAiContext {
  /** USD_GBP_RATE from @nabvy/config's `exchangeRate` group, for cost-meter. */
  usdGbpRate: number
}

/** Why paid work did not start (fail closed, rule 11 and 13). */
export type PartsAiPause =
  | 'quote-redaction-off'
  | 'cost-meter-off'
  | 'provider-off'
  | 'unknown-model'
  | 'throttled'

/** What one `run` call did. */
export interface RunReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  promptVersion: string
  /** Listing versions the rules left open (kind or parts). */
  openVersions: number
  /** Versions already called at this prompt version (the cache). */
  cached: number
  /** Listings whose partial or missing text was sent to details-queue now. */
  refreshRequested: string[]
  /** Model calls made. */
  called: number
  /** Calls whose output was stored. */
  extracted: number
  /** Calls whose output was rejected and quarantined (never retried at this version). */
  quarantined: number
  /** Listings that need a call and were left for the sweep: paused, capped or throttled. */
  deferred: string[]
  /** Set when paid work did not start at all. */
  paused?: PartsAiPause
  /** Listings whose call threw (nothing written; the sweep tries again). */
  failed: string[]
  /** Set when cost-meter refused a call that was made (an invariant break: raise an incident). */
  unmetered?: CostMeterError
  /** `parts-ai.extracted` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Runs the model over the gaps of each listing's current version (the `parts-rules.ran`
 * payload, up to 500 IDs). Reads `v_current`, `v_gaps` at parts-rules' current rule version and
 * `v_text`; a version the rules settled is left alone; a version already called at this prompt
 * version is a cache hit (a price change never re-runs it); partial or missing text is sent to
 * details-queue for a refresh, once per version, and never to the model. Paid work fails closed:
 * quote-redaction, cost-meter and the `anthropic` switch must be on, the model priced, the
 * spend-governor throttle open and the day's cap not reached; otherwise the listings are deferred
 * to the sweep. Each call's output must validate against `PartsAiOutput` and every quote must be
 * in the stored text, or the output is quarantined, with no retry. `q` must be one pipeline
 * transaction (withPipeline): the batch lock that makes the cap race-free lasts only as long as
 * it, and is held across the calls. Safe to run twice: the second run calls nothing, writes
 * nothing and returns the same event keys.
 */
export async function run(
  q: Queryable,
  input: { listingIds: string[] },
  deps: PartsAiDeps,
  ctx: PartsAiContext,
): Promise<Result<RunReport, AppError>> {
  const prompt = deps.prompt ?? { system: PARTS_AI_SYSTEM_PROMPT, version: PARTS_AI_PROMPT_VERSION }
  const report: RunReport = {
    open: false,
    promptVersion: prompt.version,
    openVersions: 0,
    cached: 0,
    refreshRequested: [],
    called: 0,
    extracted: 0,
    quarantined: 0,
    deferred: [],
    failed: [],
    events: [],
  }
  if (input.listingIds.length > PARTS_AI_EVENT_BATCH_SIZE) {
    return err({
      code: 'parts-ai.too_many_listings',
      message: `A batch holds at most ${PARTS_AI_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true
  await lockBatches(q)

  const listingIds = [...new Set(input.listingIds)]
  const targets = (await selectTargets(q, listingIds, RULE_VERSION)).flatMap((t) => {
    const asks = asksFor(t)
    return asks ? [{ ...t, asks }] : []
  })
  report.openVersions = targets.length
  const done = await selectDone(q, listingIds, prompt.version)
  const keyOf = (t: { listingId: string; evidenceHash: string }) =>
    `${t.listingId}@${t.evidenceHash}`
  report.cached = targets.filter((t) => done.has(keyOf(t))).length
  const todo = targets.filter((t) => !done.has(keyOf(t)))

  // Partial or missing text: refresh first (the card), once per version, never to the model.
  const partial = todo.filter((t) => t.descriptionStatus !== 'full_verified')
  const fresh = await insertRefreshes(
    q,
    partial.map(({ listingId, evidenceHash, source, sourceListingId }) => ({
      listingId,
      evidenceHash,
      source,
      sourceListingId,
    })),
  )
  for (const [source, ids] of groupBy(fresh, (r) => r.source)) {
    await enqueue(q, {
      source: source as 'facebook',
      sourceListingIds: ids.map((r) => r.sourceListingId),
      priority: 'sweep',
      lane: 'text',
      reason: 'partial-text',
      requestedBy: MODULE,
      refresh: true,
    })
  }
  report.refreshRequested = fresh.map((r) => r.listingId).sort()

  const complete = todo.filter((t) => t.descriptionStatus === 'full_verified')
  if (complete.length > 0) {
    const paused = await pausedBy(q, deps.client, ctx)
    if (paused) {
      report.paused = paused.reason
      report.deferred = complete.map((t) => t.listingId).sort()
    } else {
      let spent = await spentLastDay(q)
      const perCall = estimate(deps.client, ctx)
      for (const target of complete) {
        if (
          report.called >= PARTS_AI_MAX_CALLS_PER_BATCH ||
          passesCap(spent, perCall, PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS)
        ) {
          report.deferred.push(target.listingId)
          continue
        }
        const outcome = await callOne(q, target, deps.client, prompt, ctx)
        if (outcome.kind === 'failed') {
          report.failed.push(target.listingId)
          continue
        }
        report.called += 1
        spent += outcome.cost
        if (outcome.unmetered) report.unmetered = outcome.unmetered
        if (outcome.status === 'extracted') report.extracted += 1
        else report.quarantined += 1
        done.set(keyOf(target), outcome.status)
      }
      report.deferred.sort()
    }
  }

  // Every listing among the input whose current version has an extracted result, stored now or
  // before: derived from stored rows, so a replay publishes the same keys.
  const extracted = targets
    .filter((t) => done.get(keyOf(t)) === 'extracted')
    .sort((a, b) => a.listingId.localeCompare(b.listingId))
  report.events = chunk(extracted, PARTS_AI_EVENT_BATCH_SIZE).map((batch, i) =>
    createEvent(
      events,
      'parts-ai.extracted',
      1,
      { listingIds: batch.map((t) => t.listingId) },
      { key: extractedKey(prompt.version, batch, i) },
    ),
  ) as EventEnvelope[]
  return ok(report)
}

/**
 * Finds up to `limit` listings whose current version still waits for a call (deferred, failed or
 * never announced) and runs them. Called on a schedule by a thin task, as the pipeline.
 */
export async function sweep(
  q: Queryable,
  deps: PartsAiDeps,
  ctx: PartsAiContext,
  limit = PARTS_AI_EVENT_BATCH_SIZE,
): Promise<Result<RunReport, AppError>> {
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) {
    return run(q, { listingIds: [] }, deps, ctx)
  }
  const version = deps.prompt?.version ?? PARTS_AI_PROMPT_VERSION
  const listingIds = await selectPending(
    q,
    RULE_VERSION,
    version,
    Math.min(limit, PARTS_AI_EVENT_BATCH_SIZE),
  )
  return run(q, { listingIds }, deps, ctx)
}

/** The first fail-closed check that stops paid work, or null when every one passes. */
async function pausedBy(
  q: Queryable,
  client: PartsAiClient,
  ctx: PartsAiContext,
): Promise<{ reason: PartsAiPause } | null> {
  // No listing text goes to a model unless quote-redaction masks it (rule 11).
  if (!(await isOn(q, 'quote-redaction'))) return { reason: 'quote-redaction-off' }
  const meter = await contextFor(q, ctx.usdGbpRate)
  if (meter.state === 'off') return { reason: 'cost-meter-off' }
  if (!(await isOn(q, PROVIDER_SWITCH))) return { reason: 'provider-off' }
  if (!MODEL_PRICES_NANO_USD[client.model]) return { reason: 'unknown-model' }
  const throttle = await readThrottle(q)
  if (!PARTS_AI_ALLOWED_THROTTLE_LEVELS.includes(throttle.level)) return { reason: 'throttled' }
  return null
}

/** The most one call can cost, in GBP micros: the cap is checked against it before each call. */
function estimate(client: PartsAiClient, ctx: PartsAiContext): number {
  const price = MODEL_PRICES_NANO_USD[client.model]
  if (!price) return Number.POSITIVE_INFINITY
  return toGbpMicros(
    modelCostMicros(
      {
        model: client.model,
        inputTokens: PARTS_AI_MAX_INPUT_TOKENS,
        outputTokens: PARTS_AI_MAX_OUTPUT_TOKENS,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 0,
      },
      price,
    ),
    'USD',
    ctx.usdGbpRate,
  )
}

type CallOutcome =
  | { kind: 'failed' }
  | {
      kind: 'called'
      status: 'extracted' | 'quarantined'
      cost: number
      unmetered?: CostMeterError
    }

/** One model call over one listing version, its metering, its checks and its rows. */
async function callOne(
  q: Queryable,
  target: Target & { asks: NonNullable<ReturnType<typeof asksFor>> },
  client: PartsAiClient,
  prompt: { system: string; version: string },
  ctx: PartsAiContext,
): Promise<CallOutcome> {
  // The copy sent to the model is masked; the stored text is never changed.
  const title = redact(target.title).text
  const description = redact(target.description.slice(0, PARTS_AI_MAX_DESCRIPTION_CHARS)).text
  const now = await selectNow(q)
  let response: Awaited<ReturnType<PartsAiClient['extract']>>
  try {
    response = await client.extract({
      systemPrompt: prompt.system,
      promptVersion: prompt.version,
      userMessage: userMessage(target.asks, title, description),
      outputSchema: PARTS_AI_OUTPUT_SCHEMA,
      maxOutputTokens: PARTS_AI_MAX_OUTPUT_TOKENS,
      traceKey: target.evidenceHash,
    })
  } catch {
    return { kind: 'failed' }
  }

  const usage = { model: client.model, ...response.usage }
  const meter = await contextFor(q, ctx.usdGbpRate)
  const metered = await recordModelCall(
    q,
    {
      module: MODULE,
      refId: response.responseId,
      usage,
      status: 'succeeded',
      latencyMs: response.latencyMs,
      at: now,
    },
    meter,
  )
  const price = MODEL_PRICES_NANO_USD[client.model]
  const cost = metered.ok
    ? metered.value.call.countedGbpMicros
    : price
      ? toGbpMicros(modelCostMicros(usage, price), 'USD', ctx.usdGbpRate)
      : 0

  const base = {
    listingId: target.listingId,
    evidenceHash: target.evidenceHash,
    promptVersion: prompt.version,
    model: client.model,
    traceId: response.responseId,
    costGbpMicros: cost,
  }
  let row: CallRow
  // Model output is used only after it validates; otherwise it is quarantined. No retry.
  const output = PartsAiOutput.safeParse(response.output)
  if (!output.success) {
    row = {
      ...base,
      outcome: {
        status: 'quarantined',
        problem: 'invalid_output',
        detail: output.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
          .join('; '),
      },
    }
  } else {
    const checked = check(output.data, target.asks, target)
    if (!checked.ok) {
      row = {
        ...base,
        outcome: { status: 'quarantined', problem: checked.problem, detail: checked.detail },
      }
    } else {
      const laptop = (checked.kind?.kind ?? target.kind) === 'laptop'
      row = {
        ...base,
        outcome: {
          status: 'extracted',
          kind: checked.kind,
          parts: await resolveParts(q, checked.parts, laptop),
        },
      }
    }
  }
  await insertCall(q, row)
  return {
    kind: 'called',
    status: row.outcome.status,
    cost,
    ...(metered.ok ? {} : { unmetered: metered.error }),
  }
}

/**
 * Resolves each GPU and CPU part through product-catalogue, from the name the model gave (or the
 * quote), once per distinct text. A match is kept only when it is of the part's kind and every
 * model number it names is in the quote; a family without a stated variant keeps the family and
 * no ID. Other part types have no catalogue.
 */
async function resolveParts(
  q: Queryable,
  parts: CheckedPart[],
  laptop: boolean,
): Promise<StoredPart[]> {
  const cache = new Map<string, Awaited<ReturnType<typeof resolve>>>()
  const out: StoredPart[] = []
  for (const part of parts) {
    const stored: StoredPart = { ...part, catalogueId: null, family: null }
    out.push(stored)
    if (part.partType !== 'gpu' && part.partType !== 'cpu') continue
    const prefix = laptop && part.partType === 'gpu' ? 'laptop ' : ''
    const text = `${prefix}${part.name ?? part.located.quote}`
    let matches = cache.get(text)
    if (!matches) {
      matches = await resolve(q, text)
      cache.set(text, matches)
    }
    const match = matches.find(
      (m) =>
        (m.catalogueId ?? m.candidates[0] ?? '').startsWith(`${part.partType}:`) &&
        numbersAgree(m.family, part.located.quote),
    )
    if (!match) continue
    if (match.catalogueId) stored.catalogueId = match.catalogueId
    else if (match.candidates.length > 0) stored.family = match.family
  }
  return out
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item])
  return out
}

/**
 * Stores a reviewer's correction of one AI part beside it (for `review-console`). The caller has
 * checked the reviewer's session and passes the pipeline transaction. Runs whatever the switch
 * says, like erasure: a correction is never lost.
 */
export async function applyCorrection(
  q: Queryable,
  correction: PartsAiCorrection,
): Promise<Result<{ applied: true }, AppError>> {
  const c = PartsAiCorrection.parse(correction)
  const applied = await updateCorrection(q, c, {
    ...(c.inclusion !== undefined ? { inclusion: c.inclusion } : {}),
    ...(c.rejected !== undefined ? { rejected: c.rejected } : {}),
    by: c.by,
    reason: c.reason,
    at: await selectNow(q),
  })
  if (!applied) {
    return err({
      code: 'parts-ai.part_not_found',
      message: `No AI part ${c.seq} for listing ${c.listingId} at ${c.promptVersion}.`,
    })
  }
  return ok({ applied: true })
}

/**
 * Removes every call, part, quarantine row and refresh request of these listings (rule 12:
 * `seller-rights` erasure). Runs whatever the switch says. Returns how many calls were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, PARTS_AI_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
