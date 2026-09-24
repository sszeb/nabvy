// Public API of the parts-rules module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/parts-rules' only, never from its internals. It runs the rule pass
// over each listing's current version and records what the rules find, where, and what they
// leave open (README.md). No model call, no price, nothing hidden.

import {
  PARTS_RULES_CONTEXT_CHARS,
  PARTS_RULES_EVENT_BATCH_SIZE,
  PARTS_RULES_TAG_BLOCK_MIN_HASHTAGS,
  PARTS_RULES_TAG_BLOCK_MIN_MODELS,
  PARTS_RULES_WANTED_DESCRIPTION_CHARS,
} from '@nabvy/config/modules/parts-rules'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { events, PartsRulesCorrection } from '@nabvy/contracts/modules/parts-rules'
import type { Queryable } from '@nabvy/db'
import { getPack } from '@nabvy/packs'
import { resolve } from '@nabvy/product-catalogue'
import { isOn, state } from '@nabvy/switches'
import {
  analyse,
  chunk,
  compileRules,
  type Hit,
  numbersAgree,
  partGaps,
  type RuleSettings,
  ranKey,
  ruleVersion,
} from './domain'
import {
  deleteListings,
  insertRuns,
  type RunRow,
  selectDone,
  selectNegativeContexts,
  selectNow,
  selectVersions,
  updateCorrection,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/parts-rules'
export { analyse, compileRules, readsPlusAsSpace, workingCopy } from './domain'
export { detailEvidenceChangedHandler } from './handlers'

const MODULE = 'parts-rules'

const pack = getPack('gpu-pc').definition.rules
/** The rules' version: this module's revision and the patterns' checksum. */
export const RULE_VERSION = ruleVersion(pack.partPatternsSource.sha256)
const RULES = compileRules(pack.partPatterns)
const SETTINGS: RuleSettings = {
  contextChars: PARTS_RULES_CONTEXT_CHARS,
  wantedDescriptionChars: PARTS_RULES_WANTED_DESCRIPTION_CHARS,
  tagBlockMinHashtags: PARTS_RULES_TAG_BLOCK_MIN_HASHTAGS,
  tagBlockMinModels: PARTS_RULES_TAG_BLOCK_MIN_MODELS,
}

/** What one `run` call did. */
export interface RunReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  ruleVersion: string
  /** Listings with a current version to run over. */
  listings: number
  runsWritten: number
  partsWritten: number
  /** Listings whose current version now has a run at this rule version. */
  ran: string[]
  /** `parts-rules.ran` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Runs the rules over the current version of each listing (the `detail-evidence.changed`
 * payload, up to 500 IDs): reads `v_current` and `v_text`, skips versions already run at this
 * rule version, resolves GPU and CPU hits through `product-catalogue`, writes one run and its
 * hits per version, and returns the `ran` event. Safe to run twice: the second run writes nothing
 * and returns the same event key, which the transport drops. Listings with no current version
 * (detail-evidence off, or not fetched yet) are skipped.
 */
export async function run(
  q: Queryable,
  input: { listingIds: string[] },
): Promise<Result<RunReport, AppError>> {
  const report: RunReport = {
    open: false,
    ruleVersion: RULE_VERSION,
    listings: 0,
    runsWritten: 0,
    partsWritten: 0,
    ran: [],
    events: [],
  }
  if (input.listingIds.length > PARTS_RULES_EVENT_BATCH_SIZE) {
    return err({
      code: 'parts-rules.too_many_listings',
      message: `A batch holds at most ${PARTS_RULES_EVENT_BATCH_SIZE} listing IDs.`,
    })
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const listingIds = [...new Set(input.listingIds)]
  const versions = await selectVersions(q, listingIds)
  report.listings = versions.length
  const done = await selectDone(q, listingIds, RULE_VERSION)
  const todo = versions.filter((v) => !done.has(`${v.listingId}@${v.evidenceHash}`))

  const rows: RunRow[] = []
  if (todo.length > 0) {
    const negativeContexts = await selectNegativeContexts(q)
    const analysed = todo.map((v) => ({ v, a: analyse(v, RULES, SETTINGS, negativeContexts) }))
    await resolveHits(
      q,
      analysed.flatMap(({ a }) => a.hits.map((hit) => ({ hit, laptop: a.kind === 'laptop' }))),
    )
    for (const { v, a } of analysed) {
      rows.push({
        listingId: v.listingId,
        evidenceHash: v.evidenceHash,
        kind: a.kind,
        kindGap: a.kindGap,
        signals: a.signals,
        tagBlocks: a.tagBlocks,
        gaps: partGaps(a.hits, a.kind),
        fullVerified: v.descriptionStatus === 'full_verified',
        hits: a.hits,
      })
    }
  }
  const written = await insertRuns(q, RULE_VERSION, rows)
  report.runsWritten = written.runs
  report.partsWritten = written.parts

  const ranVersions = [...versions].sort((a, b) => a.listingId.localeCompare(b.listingId))
  report.ran = ranVersions.map((v) => v.listingId)
  report.events = chunk(ranVersions, PARTS_RULES_EVENT_BATCH_SIZE).map((batch, i) =>
    createEvent(
      events,
      'parts-rules.ran',
      1,
      { listingIds: batch.map((v) => v.listingId) },
      { key: ranKey(RULE_VERSION, batch, i) },
    ),
  ) as EventEnvelope[]
  return ok(report)
}

/**
 * Sets each GPU and CPU hit's catalogue ID through `resolve()`, once per distinct text (the
 * reading and the rest of its line, so a stated variant counts). A match is kept only when it
 * starts inside the reading, is of the hit's kind and its model numbers appear in the quote; a
 * family without a variant keeps the family and candidates instead. A laptop's GPU is resolved as
 * a mobile part.
 */
async function resolveHits(q: Queryable, hits: { hit: Hit; laptop: boolean }[]): Promise<void> {
  const wanted = hits.filter(({ hit }) => hit.partType === 'gpu' || hit.partType === 'cpu')
  const cache = new Map<string, Awaited<ReturnType<typeof resolve>>>()
  for (const { hit, laptop } of wanted) {
    const prefix = laptop && hit.partType === 'gpu' ? 'laptop ' : ''
    const text = `${prefix}${hit.resolveText}`
    let matches = cache.get(text)
    if (!matches) {
      matches = await resolve(q, text)
      cache.set(text, matches)
    }
    const kind = `${hit.partType}:`
    const match = matches.find(
      (m) =>
        (m.catalogueId ?? m.candidates[0] ?? '').startsWith(kind) &&
        m.index >= prefix.length &&
        m.index < prefix.length + hit.reading.length &&
        numbersAgree(m.family, hit.reading),
    )
    if (!match) continue
    if (match.catalogueId) hit.catalogueId = match.catalogueId
    else if (match.candidates.length > 0) {
      hit.attrs.family = match.family
      hit.attrs.candidates = match.candidates.slice(0, 50)
    }
  }
}

/**
 * Stores a reviewer's correction of one rule hit beside its candidate (for `review-console`).
 * The caller has checked the reviewer's session and passes the pipeline transaction. Runs
 * whatever the switch says, like erasure: a correction is never lost.
 */
export async function applyCorrection(
  q: Queryable,
  correction: PartsRulesCorrection,
): Promise<Result<{ applied: true }, AppError>> {
  const c = PartsRulesCorrection.parse(correction)
  const applied = await updateCorrection(q, c, {
    ...(c.inclusion !== undefined ? { inclusion: c.inclusion } : {}),
    ...(c.rejected !== undefined ? { rejected: c.rejected } : {}),
    by: c.by,
    reason: c.reason,
    at: await selectNow(q),
  })
  if (!applied) {
    return err({
      code: 'parts-rules.part_not_found',
      message: `No rule part ${c.seq} for listing ${c.listingId} at ${c.ruleVersion}.`,
    })
  }
  return ok({ applied: true })
}

/**
 * Removes the runs and hits of these listings (rule 12: `seller-rights` erasure). Runs whatever
 * the switch says. Returns how many runs were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, PARTS_RULES_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
