// Database access: this module's own schema, noise_filter; listing-assessment's v_assessments;
// parts-record's v_records and v_parts; parts-rules' v_kind_signals and v_tag_blocks;
// detail-evidence's v_current and v_text; and listing-ingest's v_listings, as nabvy_pipeline
// inside withPipeline.

import { vCurrent, vText } from '@nabvy/db/schema/detail-evidence'
import { vAssessments } from '@nabvy/db/schema/listing-assessment'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import { classifications } from '@nabvy/db/schema/noise-filter'
import { vParts, vRecords } from '@nabvy/db/schema/parts-record'
import { vKindSignals, vTagBlocks } from '@nabvy/db/schema/parts-rules'
import { inArray, sql } from 'drizzle-orm'
import type { Announced, Classification, ClassifyInput, PartInput, SignalInput } from '../domain'

// A type query rather than a separate statement, as in parts-record: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const keyOf = (r: { listingId: string; evidenceHash: string }) => `${r.listingId}@${r.evidenceHash}`

/**
 * The current version of each listing that listing-assessment has assessed, with the kind and
 * form, the parts record's parts, the kind signals and tag blocks of the parts-rules run the
 * record used, the text, and the found-by terms and T1 from listing-ingest. Listings with no
 * current version or no assessment of it are left out: there is nothing to classify yet.
 */
export async function selectInputs(q: Queryable, listingIds: string[]): Promise<ClassifyInput[]> {
  if (listingIds.length === 0) return []
  const versions = await q
    .select({ listingId: vCurrent.listingId, evidenceHash: vCurrent.evidenceHash })
    .from(vCurrent)
    .where(inArray(vCurrent.listingId, listingIds))
  if (versions.length === 0) return []
  const assessed = await q
    .select({
      listingId: vAssessments.listingId,
      evidenceHash: vAssessments.evidenceHash,
      kind: vAssessments.kind,
      form: vAssessments.form,
    })
    .from(vAssessments)
    .where(inArray(vAssessments.listingId, listingIds))
  const assessmentOf = new Map(assessed.map((a) => [keyOf(a), a]))
  const current = versions.filter((v) => assessmentOf.has(keyOf(v)))
  if (current.length === 0) return []
  const ids = [...new Set(current.map((v) => v.listingId))]

  const records = await q
    .select({
      listingId: vRecords.listingId,
      evidenceHash: vRecords.evidenceHash,
      ruleVersion: vRecords.ruleVersion,
    })
    .from(vRecords)
    .where(inArray(vRecords.listingId, ids))
  const rulesOf = new Map(records.map((r) => [keyOf(r), r.ruleVersion]))
  const signals = await q
    .select({
      listingId: vKindSignals.listingId,
      evidenceHash: vKindSignals.evidenceHash,
      ruleVersion: vKindSignals.ruleVersion,
      signal: vKindSignals.signal,
      source: vKindSignals.source,
      quote: vKindSignals.quote,
      start: vKindSignals.start,
      end: vKindSignals.end,
    })
    .from(vKindSignals)
    .where(inArray(vKindSignals.listingId, ids))
  const tagBlocks = await q
    .select({
      listingId: vTagBlocks.listingId,
      evidenceHash: vTagBlocks.evidenceHash,
      ruleVersion: vTagBlocks.ruleVersion,
      source: vTagBlocks.source,
      start: vTagBlocks.start,
      end: vTagBlocks.end,
    })
    .from(vTagBlocks)
    .where(inArray(vTagBlocks.listingId, ids))
  const parts = await q
    .select({
      listingId: vParts.listingId,
      evidenceHash: vParts.evidenceHash,
      partType: vParts.partType,
      inclusion: vParts.inclusion,
      rejected: vParts.rejected,
      source: vParts.source,
      quote: vParts.quote,
      start: vParts.start,
      end: vParts.end,
    })
    .from(vParts)
    .where(inArray(vParts.listingId, ids))
    .orderBy(vParts.seq)
  const texts = await q
    .select({
      listingId: vText.listingId,
      evidenceHash: vText.evidenceHash,
      title: vText.title,
      description: vText.description,
    })
    .from(vText)
    .where(inArray(vText.listingId, ids))
  const textOf = new Map(texts.map((t) => [keyOf(t), t]))
  const cards = await q
    .select({
      id: vListings.id,
      title: vListings.title,
      foundByTerms: vListings.foundByTerms,
      firstFetchedAt: vListings.firstFetchedAt,
    })
    .from(vListings)
    .where(inArray(vListings.id, ids))
  const cardOf = new Map(cards.map((c) => [c.id, c]))

  // parts-rules keeps a run per rule version; only the run the record read counts. With
  // parts-record off there is no record, so no signal or tag block is read (unknown, not noise).
  const ofRun = <T extends { listingId: string; evidenceHash: string; ruleVersion: string }>(
    rows: T[],
    v: { listingId: string; evidenceHash: string },
  ) => rows.filter((r) => keyOf(r) === keyOf(v) && rulesOf.get(keyOf(v)) === r.ruleVersion)

  return current.map((v) => {
    const a = assessmentOf.get(keyOf(v)) as (typeof assessed)[number]
    const text = textOf.get(keyOf(v))
    const card = cardOf.get(v.listingId)
    return {
      listingId: v.listingId,
      evidenceHash: v.evidenceHash,
      kind: a.kind,
      form: a.form,
      // As parts-rules reads it: the version's title, else the card's (its offsets refer to it).
      title: text?.title?.trim() ? text.title : (card?.title ?? ''),
      description: text?.description ?? null,
      signals: ofRun(signals, v).map(({ signal, source, quote, start, end }) => ({
        signal: signal as SignalInput['signal'],
        source: source as SignalInput['source'],
        quote,
        start,
        end,
      })),
      tagBlocks: ofRun(tagBlocks, v).map(({ source, start, end }) => ({
        source: source as SignalInput['source'],
        start,
        end,
      })),
      parts: parts
        .filter((p) => keyOf(p) === keyOf(v))
        .map(({ partType, inclusion, rejected, source, quote, start, end }) => ({
          partType: partType as PartInput['partType'],
          inclusion: inclusion as PartInput['inclusion'],
          rejected,
          source: source as PartInput['source'],
          quote,
          start,
          end,
        })),
      foundByTerms: card?.foundByTerms ?? [],
      fetchedAt: card?.firstFetchedAt ?? null,
    }
  })
}

export interface StoredClassification extends Announced {
  id: string
  classifiedAt: Date
}

/** The latest stored classification of each listing version among these listings. */
export async function selectLatest(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, StoredClassification>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({
      id: classifications.id,
      listingId: classifications.listingId,
      evidenceHash: classifications.evidenceHash,
      inputHash: classifications.inputHash,
      ruleVersion: classifications.ruleVersion,
      classifiedAt: classifications.classifiedAt,
    })
    .from(classifications)
    .where(inArray(classifications.listingId, listingIds))
  const latest = new Map<string, StoredClassification>()
  for (const row of rows) {
    const seen = latest.get(keyOf(row))
    if (
      !seen ||
      row.classifiedAt > seen.classifiedAt ||
      (row.classifiedAt.getTime() === seen.classifiedAt.getTime() && row.id > seen.id)
    ) {
      latest.set(keyOf(row), row)
    }
  }
  return latest
}

export interface ClassificationRow extends Classification {
  /** This module's done time: the hop time of the handler that writes it. */
  classifiedAt: Date
}

/**
 * Writes each classification. One already stored with the same key (listing, evidence hash,
 * input hash, rule version) that is not the latest of its version (the inputs went back to an
 * earlier state) is made the latest again by moving its `classified_at`; the caller never passes
 * a row that is already the latest, so a replay writes nothing. Returns how many rows were
 * written or moved.
 */
export async function insertClassifications(
  q: Queryable,
  rows: ClassificationRow[],
): Promise<number> {
  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await q
      .insert(classifications)
      .values(
        rows.slice(i, i + 500).map((r) => ({
          listingId: r.listingId,
          evidenceHash: r.evidenceHash,
          inputHash: r.inputHash,
          ruleVersion: r.ruleVersion,
          reasons: r.reasons,
          evidence: r.evidence,
          terms: r.terms,
          fetchedAt: r.fetchedAt,
          classifiedAt: r.classifiedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          classifications.listingId,
          classifications.evidenceHash,
          classifications.inputHash,
          classifications.ruleVersion,
        ],
        set: { classifiedAt: sql`excluded.classified_at` },
      })
      .returning({ id: classifications.id })
    written += inserted.length
  }
  return written
}

/** Removes every classification of these listings (erasure). */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  const removed = await q
    .delete(classifications)
    .where(inArray(classifications.listingId, listingIds))
    .returning({ id: classifications.id })
  return removed.length
}
