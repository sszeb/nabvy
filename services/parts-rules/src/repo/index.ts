// Database access: this module's own schema, parts_rules, detail-evidence's v_current and
// v_text, listing-ingest's v_listings (the card title, when a version has none) and
// product-catalogue's v_negative_contexts, as nabvy_pipeline inside withPipeline.

import type { DetailEvidenceAttribute } from '@nabvy/contracts/modules/detail-evidence'
import type {
  PartsRulesKind,
  PartsRulesKindGap,
  PartsRulesPartGap,
  PartsRulesStoredCorrection,
} from '@nabvy/contracts/modules/parts-rules'
import { vCurrent, vText } from '@nabvy/db/schema/detail-evidence'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import { ruleParts, runs } from '@nabvy/db/schema/parts-rules'
import { vNegativeContexts } from '@nabvy/db/schema/product-catalogue'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Hit, Signal, TagBlock } from '../domain'

// A type query rather than a separate statement, as in detail-evidence: packages/db's
// conventions test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

export interface Version {
  listingId: string
  evidenceHash: string
  descriptionStatus: string | null
  attributes: DetailEvidenceAttribute[]
  detailSections: DetailEvidenceAttribute[]
  title: string
  description: string | null
}

/** The current version of each listing, with its text; listings with none are left out. */
export async function selectVersions(q: Queryable, listingIds: string[]): Promise<Version[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({
      listingId: vCurrent.listingId,
      evidenceHash: vCurrent.evidenceHash,
      descriptionStatus: vCurrent.descriptionStatus,
      attributes: vCurrent.attributes,
      detailSections: vCurrent.detailSections,
      versionTitle: vText.title,
      cardTitle: vListings.title,
      description: vText.description,
    })
    .from(vCurrent)
    .innerJoin(
      vText,
      and(eq(vText.listingId, vCurrent.listingId), eq(vText.evidenceHash, vCurrent.evidenceHash)),
    )
    .leftJoin(vListings, eq(vListings.id, vCurrent.listingId))
    .where(inArray(vCurrent.listingId, listingIds))
  return rows.map((r) => ({
    listingId: r.listingId,
    evidenceHash: r.evidenceHash,
    descriptionStatus: r.descriptionStatus,
    attributes: (r.attributes ?? []) as DetailEvidenceAttribute[],
    detailSections: (r.detailSections ?? []) as DetailEvidenceAttribute[],
    title: r.versionTitle?.trim() ? r.versionTitle : (r.cardTitle ?? ''),
    description: r.description,
  }))
}

/** The (listing, evidence hash) pairs among these listings already run at this rule version. */
export async function selectDone(
  q: Queryable,
  listingIds: string[],
  ruleVersion: string,
): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set()
  const rows = await q
    .select({ listingId: runs.listingId, evidenceHash: runs.evidenceHash })
    .from(runs)
    .where(and(inArray(runs.listingId, listingIds), eq(runs.ruleVersion, ruleVersion)))
  return new Set(rows.map((r) => `${r.listingId}@${r.evidenceHash}`))
}

/** The catalogue's negative-context patterns (empty while product-catalogue is off). */
export async function selectNegativeContexts(q: Queryable): Promise<string[]> {
  const rows = await q
    .selectDistinct({ pattern: vNegativeContexts.pattern })
    .from(vNegativeContexts)
  return rows.map((r) => r.pattern).sort()
}

export interface RunRow {
  listingId: string
  evidenceHash: string
  kind: PartsRulesKind | null
  kindGap: PartsRulesKindGap | null
  signals: Signal[]
  tagBlocks: TagBlock[]
  gaps: PartsRulesPartGap[]
  fullVerified: boolean
  hits: Hit[]
}

/**
 * Writes each run and its hits. A run already stored (same listing, evidence hash and rule
 * version) is skipped with its hits, so a replay or a concurrent duplicate writes nothing.
 * Returns how many runs and hits were written.
 */
export async function insertRuns(
  q: Queryable,
  ruleVersion: string,
  rows: RunRow[],
): Promise<{ runs: number; parts: number }> {
  if (rows.length === 0) return { runs: 0, parts: 0 }
  const inserted = await q
    .insert(runs)
    .values(
      rows.map((r) => ({
        listingId: r.listingId,
        evidenceHash: r.evidenceHash,
        ruleVersion,
        kind: r.kind,
        kindGap: r.kindGap,
        kindSignals: r.signals.map((s) => ({
          signal: s.signal,
          source: s.source,
          quote: s.quote,
          start: s.start,
          end: s.end,
          rule_id: s.ruleId,
        })),
        tagBlocks: r.tagBlocks.map((b) => ({
          source: b.source,
          start: b.start,
          end: b.end,
          rule_id: b.ruleId,
        })),
        gaps: r.gaps,
        fullVerified: r.fullVerified,
      })),
    )
    .onConflictDoNothing()
    .returning({ listingId: runs.listingId, evidenceHash: runs.evidenceHash })
  const fresh = new Set(inserted.map((r) => `${r.listingId}@${r.evidenceHash}`))
  const parts = rows
    .filter((r) => fresh.has(`${r.listingId}@${r.evidenceHash}`))
    .flatMap((r) =>
      r.hits.map((h, seq) => ({
        listingId: r.listingId,
        evidenceHash: r.evidenceHash,
        ruleVersion,
        seq,
        partType: h.partType,
        catalogueId: h.catalogueId,
        attrs: h.attrs,
        inclusionCandidate: h.inclusion,
        source: h.source,
        quote: h.quote,
        quoteStart: h.start,
        quoteEnd: h.end,
        ruleId: h.ruleId,
      })),
    )
  for (let i = 0; i < parts.length; i += 1000) {
    await q
      .insert(ruleParts)
      .values(parts.slice(i, i + 1000))
      .onConflictDoNothing()
  }
  return { runs: inserted.length, parts: parts.length }
}

/** Stores a correction beside one hit's candidate; false when no such hit exists. */
export async function updateCorrection(
  q: Queryable,
  key: { listingId: string; evidenceHash: string; ruleVersion: string; seq: number },
  correction: PartsRulesStoredCorrection,
): Promise<boolean> {
  const rows = await q
    .update(ruleParts)
    .set({ correction })
    .where(
      and(
        eq(ruleParts.listingId, key.listingId),
        eq(ruleParts.evidenceHash, key.evidenceHash),
        eq(ruleParts.ruleVersion, key.ruleVersion),
        eq(ruleParts.seq, key.seq),
      ),
    )
    .returning({ id: ruleParts.id })
  return rows.length > 0
}

/** Removes every run and hit of these listings (erasure). Returns how many runs were removed. */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  await q.delete(ruleParts).where(inArray(ruleParts.listingId, listingIds))
  const removed = await q
    .delete(runs)
    .where(inArray(runs.listingId, listingIds))
    .returning({ id: runs.id })
  return removed.length
}

/** Now, as the database sees it (the correction's time). */
export async function selectNow(q: Queryable): Promise<string> {
  const result = (await q.execute(sql`select now() as now`)) as unknown as {
    rows: { now: Date | string }[]
  }
  return new Date(result.rows[0]?.now ?? Date.now()).toISOString()
}
