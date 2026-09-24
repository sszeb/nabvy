import { readdirSync, readFileSync } from 'node:fs'
import { type PartsAiDeps, run } from '../../src'
import { detailed, loadRun, type TestDatabase, USD_GBP_RATE, withFields } from './database'
import { loadRecording, recordedClient } from './model'
import { type CaseInput, observe } from './observe'

// One fixture case run end to end: the recorded rows (with the case's edits) through ingest,
// detail-evidence and parts-rules, then this module with a recorded model. Shared by the fixture
// stage and the evaluation run, so both judge the same thing.

type Json = Record<string, unknown>

const CASES = new URL('../fixtures/cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))

export const caseIds = (): string[] => readdirSync(CASES).sort()

export interface CaseOptions {
  /** Another prompt (the evaluation's weakened one); the module's own by default. */
  prompt?: PartsAiDeps['prompt']
  /** Responses laid over the shared and the case's own (a recording made with `prompt`). */
  responses?: CaseInput['responses']
}

/** Runs one case on `t` and returns what it observed beside what the case expects. */
export async function runCase(
  t: TestDatabase,
  id: string,
  options: CaseOptions = {},
): Promise<{ observed: Json; expected: Json }> {
  const input = read(new URL(`${id}/input.json`, CASES)) as CaseInput
  const expected = read(new URL(`${id}/expected.json`, CASES)) as Json
  const recorded = loadRun(input.run)
  const rowsOf = (edits: CaseInput['edits']) => {
    let rows = recorded.dataset as Json[]
    if (input.only) {
      const keep = new Set(input.only)
      rows = rows.filter((r) => r.recordType !== 'listing' || keep.has(String(r.listingId)))
    }
    for (const edit of edits ?? []) rows = withFields(rows, edit.listingId, edit.fields)
    return rows
  }
  const responses = {
    ...loadRecording('current').responses,
    ...(input.responses ?? {}),
    ...(options.responses ?? {}),
  }
  const deps = async () => ({
    client: await recordedClient(t, responses, options.prompt?.version),
    ...(options.prompt ? { prompt: options.prompt } : {}),
  })

  let listingIds = await detailed(t, recorded, rowsOf(input.edits))
  let step = await deps()
  let result = await run(t.db, { listingIds }, step, { usdGbpRate: USD_GBP_RATE })
  if (!result.ok) throw new Error(result.error.message)
  let modelCalls = step.client.calls.length
  if (input.second) {
    // A second collected job (another run ID); the replayed batch names the first job's
    // listings too, as a duplicate event or the sweep would.
    const again = await detailed(
      t,
      { ...recorded, apifyRunId: `${recorded.apifyRunId}-2` },
      rowsOf([...(input.edits ?? []), ...input.second]),
    )
    listingIds = [...new Set([...listingIds, ...again])]
    step = await deps()
    result = await run(t.db, { listingIds }, step, { usdGbpRate: USD_GBP_RATE })
    if (!result.ok) throw new Error(result.error.message)
    modelCalls += step.client.calls.length
  }
  return { observed: await observe(t, result.value, modelCalls, expected), expected }
}
