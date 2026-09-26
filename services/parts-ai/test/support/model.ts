import { readFileSync } from 'node:fs'
import { createRecordedPartsClient, PARTS_AI_PROMPT_VERSION, type PartsAiResponse } from '../../src'
import type { TestDatabase } from './database'

// The recorded model: responses written per source listing ID, replayed by evidence hash (the
// client's trace key), because no Anthropic key exists yet (README.md, "Decisions").

/** The priced model the recordings stand for (cost-meter's table). */
export const MODEL = 'claude-haiku-4-5'

export interface Recording {
  promptVersion: string
  responses: Record<string, PartsAiResponse>
}

const RECORDINGS = new URL('../fixtures/recordings/', import.meta.url)

/** A recording file in test/fixtures/recordings/ (`current`, `weakened`). */
export function loadRecording(name: string): Recording {
  return JSON.parse(readFileSync(new URL(`${name}.json`, RECORDINGS), 'utf8'))
}

/**
 * A recorded client for the listings stored in `t`: each source listing ID's response is keyed
 * by that listing's current evidence hash. `promptVersion` defaults to the recording's own.
 */
export async function recordedClient(
  t: TestDatabase,
  responses: Record<string, PartsAiResponse>,
  promptVersion: string = PARTS_AI_PROMPT_VERSION,
) {
  const rows = await t.asPipeline(
    `select l.source_listing_id as sid, c.evidence_hash
     from detail_evidence.v_current c join listing_ingest.v_listings l on l.id = c.listing_id`,
  )
  const byHash: Record<string, PartsAiResponse> = {}
  for (const row of rows) {
    const response = responses[row.sid as string]
    if (response) byHash[row.evidence_hash as string] = response
  }
  return createRecordedPartsClient(MODEL, { promptVersion, responses: byHash })
}
