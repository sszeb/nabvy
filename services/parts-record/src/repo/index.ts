// Database access: this module's own schema, parts_record; detail-evidence's v_current;
// parts-rules' v_gaps, v_rule_parts and v_kind_signals; parts-ai's v_runs and v_ai_parts; and
// product-catalogue's v_items, as nabvy_pipeline inside withPipeline.

import type { PartsAiPart, PartsAiRun } from '@nabvy/contracts/modules/parts-ai'
import type { PartsRecordStoredCorrection } from '@nabvy/contracts/modules/parts-record'
import type { PartsRulesKindSignal, PartsRulesPart } from '@nabvy/contracts/modules/parts-rules'
import { vCurrent } from '@nabvy/db/schema/detail-evidence'
import { vAiParts, vRuns } from '@nabvy/db/schema/parts-ai'
import { parts, records } from '@nabvy/db/schema/parts-record'
import { vGaps, vKindSignals, vRuleParts } from '@nabvy/db/schema/parts-rules'
import { vItems } from '@nabvy/db/schema/product-catalogue'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AiInput, MergedRecord, RulesInput, Versions } from '../domain'

// A type query rather than a separate statement, as in parts-rules: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const keyOf = (r: { listingId: string; evidenceHash: string }) => `${r.listingId}@${r.evidenceHash}`

export interface Inputs {
  listingId: string
  evidenceHash: string
  rules: RulesInput
  ai: AiInput | null
}

/**
 * The current version of each listing with the rules' latest run over it (the latest `done_at`
 * for the evidence hash, whatever the rule version), that run's hits and kind signals, and
 * parts-ai's latest extracted call over the version with its parts. Listings with no current
 * version or no rules run over it are left out: there is nothing to record yet.
 */
export async function selectInputs(q: Queryable, listingIds: string[]): Promise<Inputs[]> {
  if (listingIds.length === 0) return []
  const versions = await q
    .select({ listingId: vCurrent.listingId, evidenceHash: vCurrent.evidenceHash })
    .from(vCurrent)
    .where(inArray(vCurrent.listingId, listingIds))
  if (versions.length === 0) return []
  const current = new Set(versions.map(keyOf))

  const runs = await q
    .select({
      listingId: vGaps.listingId,
      evidenceHash: vGaps.evidenceHash,
      ruleVersion: vGaps.ruleVersion,
      kind: vGaps.kind,
      kindGap: vGaps.kindGap,
      doneAt: vGaps.doneAt,
    })
    .from(vGaps)
    .where(inArray(vGaps.listingId, listingIds))
  const latestRun = new Map<string, (typeof runs)[number]>()
  for (const run of runs) {
    if (!current.has(keyOf(run))) continue
    const seen = latestRun.get(keyOf(run))
    if (!seen || run.doneAt > seen.doneAt) latestRun.set(keyOf(run), run)
  }
  if (latestRun.size === 0) return []

  const hits = await q
    .select()
    .from(vRuleParts)
    .where(inArray(vRuleParts.listingId, listingIds))
    .orderBy(vRuleParts.seq)
  const signals = await q
    .select()
    .from(vKindSignals)
    .where(inArray(vKindSignals.listingId, listingIds))

  const calls = await q
    .select()
    .from(vRuns)
    .where(and(inArray(vRuns.listingId, listingIds), eq(vRuns.status, 'extracted')))
  const latestCall = new Map<string, (typeof calls)[number]>()
  for (const call of calls) {
    if (!current.has(keyOf(call))) continue
    const seen = latestCall.get(keyOf(call))
    if (!seen || call.doneAt > seen.doneAt) latestCall.set(keyOf(call), call)
  }
  const aiParts =
    latestCall.size === 0
      ? []
      : await q
          .select()
          .from(vAiParts)
          .where(inArray(vAiParts.listingId, listingIds))
          .orderBy(vAiParts.seq)

  return versions.flatMap((v) => {
    const run = latestRun.get(keyOf(v))
    if (!run) return []
    const atRun = (r: { listingId: string; evidenceHash: string; ruleVersion: string }) =>
      keyOf(r) === keyOf(v) && r.ruleVersion === run.ruleVersion
    const call = latestCall.get(keyOf(v))
    return [
      {
        listingId: v.listingId,
        evidenceHash: v.evidenceHash,
        rules: {
          ruleVersion: run.ruleVersion,
          kind: run.kind as RulesInput['kind'],
          kindGap: run.kindGap as RulesInput['kindGap'],
          parts: hits
            .filter(atRun)
            .map((h) => ({ ...h, correction: h.correction ?? null })) as PartsRulesPart[],
          signals: signals.filter(atRun) as PartsRulesKindSignal[],
        },
        ai: call
          ? {
              promptVersion: call.promptVersion,
              kind: {
                kind: call.kind as PartsAiRun['kind'],
                kindSource: call.kindSource as PartsAiRun['kindSource'],
                kindQuote: call.kindQuote,
                kindStart: call.kindStart,
                kindEnd: call.kindEnd,
              },
              parts: aiParts
                .filter((p) => keyOf(p) === keyOf(v) && p.promptVersion === call.promptVersion)
                .map((p) => ({ ...p, correction: p.correction ?? null })) as PartsAiPart[],
            }
          : null,
      },
    ]
  })
}

/** The catalogue's family per catalogue ID (empty while product-catalogue is off). */
export async function selectFamilies(
  q: Queryable,
  catalogueIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(catalogueIds)]
  if (ids.length === 0) return new Map()
  const rows = await q
    .select({ catalogueId: vItems.catalogueId, family: vItems.family })
    .from(vItems)
    .where(inArray(vItems.catalogueId, ids))
  return new Map(rows.map((r) => [r.catalogueId, r.family]))
}

export interface StoredRecord extends Versions {
  id: string
  listingId: string
  evidenceHash: string
}

/** The latest stored record of each listing version among these listings, by (listing, hash). */
export async function selectLatest(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, StoredRecord>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({
      id: records.id,
      listingId: records.listingId,
      evidenceHash: records.evidenceHash,
      ruleVersion: records.ruleVersion,
      aiVersion: records.aiVersion,
      photoVersion: records.photoVersion,
      recordedAt: records.recordedAt,
    })
    .from(records)
    .where(inArray(records.listingId, listingIds))
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const seen = latest.get(keyOf(row))
    if (
      !seen ||
      row.recordedAt > seen.recordedAt ||
      (row.recordedAt.getTime() === seen.recordedAt.getTime() && row.id > seen.id)
    ) {
      latest.set(keyOf(row), row)
    }
  }
  return new Map([...latest].map(([k, r]) => [k, { ...r }]))
}

export interface CorrectedPart {
  recordId: string
  partType: string
  source: string
  extractor: string
  quote: string
  start: number
  end: number
  correction: PartsRecordStoredCorrection | null
}

/** The corrected parts of these records (for carry-forward onto a re-merged record). */
export async function selectCorrected(q: Queryable, recordIds: string[]): Promise<CorrectedPart[]> {
  if (recordIds.length === 0) return []
  const rows = await q
    .select({
      recordId: parts.recordId,
      partType: parts.partType,
      source: parts.source,
      extractor: parts.extractor,
      quote: parts.quote,
      start: parts.quoteStart,
      end: parts.quoteEnd,
      correction: parts.correction,
    })
    .from(parts)
    .where(and(inArray(parts.recordId, recordIds), sql`${parts.correction} is not null`))
  return rows.map((r) => ({ ...r, correction: r.correction as PartsRecordStoredCorrection }))
}

export interface RecordRow extends MergedRecord {
  /** The corrections carried forward, by part seq. */
  corrections: Map<number, PartsRecordStoredCorrection>
}

/**
 * Writes each record and its parts. A record already stored (same listing, evidence hash and
 * extractor versions) is skipped with its parts, so a replay or a concurrent duplicate writes
 * nothing. Returns how many records and parts were written.
 */
export async function insertRecords(
  q: Queryable,
  rows: RecordRow[],
): Promise<{ records: number; parts: number }> {
  if (rows.length === 0) return { records: 0, parts: 0 }
  const inserted = await q
    .insert(records)
    .values(
      rows.map((r) => ({
        listingId: r.listingId,
        evidenceHash: r.evidenceHash,
        ruleVersion: r.ruleVersion,
        aiVersion: r.aiVersion,
        photoVersion: r.photoVersion,
        kind: r.kind,
        kindGap: r.kindGap,
        kindBy: r.kindBy,
        kindSource: r.kindSource,
        kindQuote: r.kindQuote,
        kindStart: r.kindStart,
        kindEnd: r.kindEnd,
        partCount: r.parts.length,
        conflict: r.conflict,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: records.id,
      listingId: records.listingId,
      evidenceHash: records.evidenceHash,
      ruleVersion: records.ruleVersion,
      aiVersion: records.aiVersion,
      photoVersion: records.photoVersion,
    })
  const versionKey = (r: Versions & { listingId: string; evidenceHash: string }) =>
    `${keyOf(r)}@${r.ruleVersion}@${r.aiVersion ?? ''}@${r.photoVersion ?? ''}`
  const ids = new Map(inserted.map((r) => [versionKey(r), r.id]))
  const partRows = rows.flatMap((r) => {
    const recordId = ids.get(versionKey(r))
    if (!recordId) return []
    return r.parts.map((p) => ({
      recordId,
      listingId: r.listingId,
      evidenceHash: r.evidenceHash,
      seq: p.seq,
      partType: p.partType,
      catalogueId: p.catalogueId,
      attrs: p.attrs,
      inclusion: p.inclusion,
      source: p.source,
      extractor: p.extractor,
      extractorVersion: p.extractorVersion,
      quote: p.quote,
      quoteStart: p.start,
      quoteEnd: p.end,
      conflict: p.conflict,
      correction: r.corrections.get(p.seq) ?? null,
    }))
  })
  for (let i = 0; i < partRows.length; i += 1000) {
    await q
      .insert(parts)
      .values(partRows.slice(i, i + 1000))
      .onConflictDoNothing()
  }
  return { records: inserted.length, parts: partRows.length }
}

/** Stores a correction beside one part of the latest record of a version; false when none. */
export async function updateCorrection(
  q: Queryable,
  key: { listingId: string; evidenceHash: string; seq: number },
  correction: PartsRecordStoredCorrection,
): Promise<boolean> {
  const latest = (await selectLatest(q, [key.listingId])).get(keyOf(key))
  if (!latest) return false
  const rows = await q
    .update(parts)
    .set({ correction })
    .where(and(eq(parts.recordId, latest.id), eq(parts.seq, key.seq)))
    .returning({ id: parts.id })
  return rows.length > 0
}

/** Removes every record (and, by cascade, part) of these listings (erasure). */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  const removed = await q
    .delete(records)
    .where(inArray(records.listingId, listingIds))
    .returning({ id: records.id })
  return removed.length
}

/** Now, as the database sees it (the correction's time). */
export async function selectNow(q: Queryable): Promise<string> {
  const result = (await q.execute(sql`select now() as now`)) as unknown as {
    rows: { now: Date | string }[]
  }
  return new Date(result.rows[0]?.now ?? Date.now()).toISOString()
}
