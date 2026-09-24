// Public API of the scan-recognition module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/scan-recognition' only, never from its internals.
import { isActive } from '@nabvy/account'
import {
  SCAN_RECOGNITION_CAP_WINDOW_HOURS,
  SCAN_RECOGNITION_CONFIRMATION_THRESHOLD,
  SCAN_RECOGNITION_PHOTO_RETENTION_DAYS,
  SCAN_RECOGNITION_VISION_MAX_INPUT_TOKENS,
  SCAN_RECOGNITION_VISION_MAX_OUTPUT_TOKENS,
} from '@nabvy/config/modules/scan-recognition'
import { createEvent, type EventEnvelope, ok, type Result } from '@nabvy/contracts'
import type { CostMeterError } from '@nabvy/contracts/modules/cost-meter'
import {
  events,
  module,
  ScanRecognitionConfirmInput,
  type ScanRecognitionError,
  ScanRecognitionOutput,
  type ScanRecognitionResult,
  ScanRecognitionScanInput,
} from '@nabvy/contracts/modules/scan-recognition'
import {
  contextFor,
  MODEL_PRICES_NANO_USD,
  modelCostMicros,
  recordModelCall,
  toGbpMicros,
} from '@nabvy/cost-meter'
import type { Queryable } from '@nabvy/db'
import { lookupByCode, resolve } from '@nabvy/product-catalogue'
import { isOn, state } from '@nabvy/switches'
import {
  candidateNames,
  decide,
  failure,
  identifiedKey,
  passesCap,
  photoExpiresAt,
  rankCandidates,
  SCAN_RECOGNITION_PROMPT_VERSION,
  SCAN_RECOGNITION_SYSTEM_PROMPT,
  type ScanVisionClient,
} from './domain'
import {
  clearExpiredPhotos,
  insertScan,
  lockUser,
  type ScanInsert,
  type ScanRow,
  selectScan,
  spentSince,
  writeConfirmation,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/scan-recognition'
export {
  createRecordedVisionClient,
  SCAN_RECOGNITION_PROMPT_VERSION,
  SCAN_RECOGNITION_SYSTEM_PROMPT,
  type ScanVisionClient,
  type ScanVisionRequest,
  type ScanVisionResponse,
} from './domain'
export { onAccountDeleted } from './handlers'

/** The model provider's own kill switch (services/switches/README.md, "Decisions"). */
const PROVIDER_SWITCH = 'anthropic'

export interface ScanRecognitionDeps {
  vision: ScanVisionClient
  /**
   * The soft `cex-adapter`'s box lookup by EAN, returning a CeX box ID. Absent while that module
   * is not built or off (the MVP), and the CeX step is then skipped (README.md, "Inputs").
   */
  cexBoxLookup?: (q: Queryable, ean: string) => Promise<string | undefined>
}

export interface ScanRecognitionContext {
  /** SCAN_SPEND_CAP_MINOR from @nabvy/config's `spendCaps` group. */
  spendCapMinor: number
  /** USD_GBP_RATE from @nabvy/config's `exchangeRate` group, for cost-meter. */
  usdGbpRate: number
  now?: Date
}

export interface ScanOutcome {
  result: ScanRecognitionResult
  /** Whether this call wrote the scan; false when the scan ID was already recorded. */
  changed: boolean
  /** `scan-recognition.identified`, for the caller to publish after its transaction commits. */
  event?: EventEnvelope
  /** Set only when cost-meter refused to record a call that was made (see `scan()`). */
  unmetered?: CostMeterError
}

function identifiedEvent(row: ScanRow): EventEnvelope | undefined {
  if (row.status !== 'identified' || !row.identified) return undefined
  return createEvent(
    events,
    'scan-recognition.identified',
    1,
    { scanId: row.id },
    { key: identifiedKey(row.id, row.identified) },
  ) as EventEnvelope
}

function resultOf(row: ScanRow): ScanRecognitionResult {
  return {
    scanId: row.id,
    status: row.status as ScanRecognitionResult['status'],
    method: row.method as ScanRecognitionResult['method'],
    identified: row.identified,
    candidates: row.candidates,
    confidence: row.confidence,
    searchPhrases: row.searchPhrases,
    modelCalled: row.modelCalled,
  }
}

const outcomeOf = (row: ScanRow, changed: boolean): ScanOutcome => {
  const event = identifiedEvent(row)
  return { result: resultOf(row), changed, ...(event ? { event } : {}) }
}

/**
 * Identifies one scan (docs/design/modules/scan-recognition.md): the barcode through the
 * catalogue's codes, then a CeX box lookup (soft, skipped when absent), otherwise one vision call
 * whose candidates are resolved through the catalogue. Runs as the pipeline (withPipeline), in the
 * task the scan procedure starts, after the procedure checked the session. A replayed scan ID
 * returns the stored scan and never calls the model again. A scan whose call could take the user
 * past SCAN_SPEND_CAP_MINOR in the window is refused before the call.
 */
export async function scan(
  q: Queryable,
  rawInput: ScanRecognitionScanInput,
  deps: ScanRecognitionDeps,
  ctx: ScanRecognitionContext,
): Promise<Result<ScanOutcome, ScanRecognitionError>> {
  const parsed = ScanRecognitionScanInput.safeParse(rawInput)
  if (!parsed.success) return failure('scan-recognition.invalid_input', parsed.error.message)
  const input = parsed.data
  const now = ctx.now ?? new Date()

  if ((await state(q, module)) === 'off') {
    return failure('scan-recognition.off', 'Scan mode is unavailable.')
  }
  if (!(await isActive(q, input.userId))) {
    return failure('scan-recognition.account_restricted', 'The account may not scan right now.')
  }

  await lockUser(q, input.userId)
  const existing = await selectScan(q, input.scanId)
  if (existing) {
    const same =
      existing.userId === input.userId &&
      existing.barcode === (input.barcode ?? null) &&
      (existing.photoRef === null || existing.photoRef === (input.photo?.ref ?? null))
    return same
      ? ok(outcomeOf(existing, false))
      : failure('scan-recognition.conflict', 'This scan ID was used for a different scan.')
  }

  const base: ScanInsert = {
    id: input.scanId,
    userId: input.userId,
    barcode: input.barcode ?? null,
    photoRef: input.photo?.ref ?? null,
    photoMediaType: input.photo?.mediaType ?? null,
    photoExpiresAt: input.photo
      ? photoExpiresAt(new Date(input.at), SCAN_RECOGNITION_PHOTO_RETENTION_DAYS)
      : null,
    at: new Date(input.at),
    method: 'none',
    status: 'unidentified',
  }
  const write = async (row: ScanInsert) => {
    const inserted = await insertScan(q, row)
    // The user lock makes a concurrent insert of the same ID impossible; read back defensively.
    const stored = inserted ?? (await selectScan(q, row.id))
    if (!stored) throw new Error(`scan ${row.id} was neither inserted nor found`)
    return ok(outcomeOf(stored, inserted !== undefined))
  }
  const identifiedBy = (method: 'barcode' | 'cex_box', catalogueId: string) =>
    write({
      ...base,
      method,
      status: 'identified',
      identified: catalogueId,
      candidates: [catalogueId],
      confidence: 1,
      identifiedAt: now,
    })

  if (input.barcode) {
    const byEan = await lookupByCode(q, 'ean', input.barcode)
    if (byEan) return identifiedBy('barcode', byEan)
    const boxId = deps.cexBoxLookup ? await deps.cexBoxLookup(q, input.barcode) : undefined
    const byBox = boxId ? await lookupByCode(q, 'cex_box', boxId) : undefined
    if (byBox) return identifiedBy('cex_box', byBox)
  }
  if (!input.photo) return write(base)

  // Paid work: fail closed if the meter or the provider is off, or the model is unpriced.
  const meter = await contextFor(q, ctx.usdGbpRate)
  if (meter.state === 'off' || !(await isOn(q, PROVIDER_SWITCH))) {
    return failure('scan-recognition.paid_work_paused', 'Photo recognition is paused.')
  }
  const price = MODEL_PRICES_NANO_USD[deps.vision.model]
  if (!price) {
    return failure('scan-recognition.unknown_model', `No price for ${deps.vision.model}.`)
  }
  const estimate = toGbpMicros(
    modelCostMicros(
      {
        model: deps.vision.model,
        inputTokens: SCAN_RECOGNITION_VISION_MAX_INPUT_TOKENS,
        outputTokens: SCAN_RECOGNITION_VISION_MAX_OUTPUT_TOKENS,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 0,
      },
      price,
    ),
    'USD',
    ctx.usdGbpRate,
  )
  const since = new Date(now.getTime() - SCAN_RECOGNITION_CAP_WINDOW_HOURS * 60 * 60 * 1000)
  if (passesCap(await spentSince(q, input.userId, since), estimate, ctx.spendCapMinor)) {
    return failure('scan-recognition.cap_reached', 'The scan spend limit has been reached.')
  }

  let response: Awaited<ReturnType<ScanVisionClient['recognise']>>
  try {
    response = await deps.vision.recognise({
      photo: input.photo,
      systemPrompt: SCAN_RECOGNITION_SYSTEM_PROMPT,
      promptVersion: SCAN_RECOGNITION_PROMPT_VERSION,
      maxOutputTokens: SCAN_RECOGNITION_VISION_MAX_OUTPUT_TOKENS,
    })
  } catch (cause) {
    return failure('scan-recognition.model_failed', String(cause))
  }

  const usage = { model: deps.vision.model, ...response.usage }
  const metered = await recordModelCall(
    q,
    {
      module,
      refId: response.responseId,
      usage,
      status: 'succeeded',
      latencyMs: response.latencyMs,
      at: now.toISOString(),
    },
    meter,
  )
  // Counted against the cap from the same price table whether or not the meter accepted it.
  const cost = metered.ok
    ? metered.value.call.countedGbpMicros
    : toGbpMicros(modelCostMicros(usage, price), 'USD', ctx.usdGbpRate)
  const called: ScanInsert = {
    ...base,
    method: 'vision',
    modelCalled: true,
    modelRef: response.responseId,
    promptVersion: SCAN_RECOGNITION_PROMPT_VERSION,
    costGbpMicros: cost,
  }

  // Model output is used only after it validates; otherwise the scan is quarantined as
  // unidentified. No retry: one vision call per scan (README.md, "Decisions").
  const output = ScanRecognitionOutput.safeParse(response.output)
  let outcome: Result<ScanOutcome, ScanRecognitionError>
  if (!output.success) {
    outcome = await write({ ...called, outputValid: false })
  } else {
    const resolved = []
    for (const candidate of candidateNames(output.data)) {
      const [match] = await resolve(q, candidate.name)
      resolved.push({ catalogueId: match?.catalogueId ?? null, confidence: candidate.confidence })
    }
    const ranked = rankCandidates(resolved)
    const decision = decide(ranked, SCAN_RECOGNITION_CONFIRMATION_THRESHOLD)
    outcome = await write({
      ...called,
      outputValid: true,
      description: output.data.description,
      searchPhrases: output.data.searchPhrases,
      candidates: ranked.map((candidate) => candidate.catalogueId),
      status: decision.status,
      identified: decision.identified,
      confidence: decision.confidence,
      identifiedAt: decision.identified ? now : null,
    })
  }
  // The meter was checked before the call, so a refusal here is an invariant break. The call was
  // paid for and the scan is stored (and counted against the cap); the caller commits and raises
  // an incident rather than rolling back, which would let a retry pay for a second call.
  if (!metered.ok && outcome.ok) return ok({ ...outcome.value, unmetered: metered.error })
  return outcome
}

/**
 * The user confirms or picks one of the scan's candidates (docs/scan-mode.md, "Identify"). Runs
 * inside withUser(userId): row-level security limits it to the user's own scans, and nabvy_app may
 * write only the confirmation columns. Confirming the same candidate again changes nothing.
 */
export async function confirm(
  q: Queryable,
  rawInput: ScanRecognitionConfirmInput,
  ctx: { now?: Date } = {},
): Promise<Result<ScanOutcome, ScanRecognitionError>> {
  const parsed = ScanRecognitionConfirmInput.safeParse(rawInput)
  if (!parsed.success) return failure('scan-recognition.invalid_input', parsed.error.message)
  const input = parsed.data
  if ((await state(q, module)) === 'off') {
    return failure('scan-recognition.off', 'Scan mode is unavailable.')
  }
  if (!(await isActive(q, input.userId))) {
    return failure('scan-recognition.account_restricted', 'The account may not scan right now.')
  }
  const row = await selectScan(q, input.scanId)
  if (!row || row.userId !== input.userId) {
    return failure('scan-recognition.not_found', 'No such scan.')
  }
  if (!row.candidates.includes(input.catalogueId)) {
    return failure('scan-recognition.not_a_candidate', 'Pick one of the suggested items.')
  }
  if (row.confirmed && row.identified === input.catalogueId) return ok(outcomeOf(row, false))
  const updated = await writeConfirmation(q, row.id, input.catalogueId, ctx.now ?? new Date())
  if (!updated) return failure('scan-recognition.not_found', 'No such scan.')
  return ok(outcomeOf(updated, true))
}

/**
 * Clears scan photo refs older than 30 days, at most `limit` per run, and returns them for the
 * storage task to delete (docs/security.md). Runs as the pipeline on a schedule. Scans saved to
 * inventory are not exempt yet: `inventory` is not built (README.md, "Decisions").
 */
export async function expirePhotos(
  q: Queryable,
  now: Date = new Date(),
  limit = 500,
): Promise<{ photoRefs: string[] }> {
  return { photoRefs: await clearExpiredPhotos(q, now, limit) }
}
