// Database access: this module's own schema, listing_assessment; parts-record's v_records and
// v_parts; detail-evidence's v_current and v_text; and listing-ingest's v_listings, as
// nabvy_pipeline inside withPipeline.

import type { ListingAssessmentStoredCorrection } from '@nabvy/contracts/modules/listing-assessment'
import { vCurrent, vText } from '@nabvy/db/schema/detail-evidence'
import { assessments } from '@nabvy/db/schema/listing-assessment'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import { vParts, vRecords } from '@nabvy/db/schema/parts-record'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Announced, Assessment, AssessmentInput, PartInput, RecordInput } from '../domain'

// A type query rather than a separate statement, as in parts-record: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const keyOf = (r: { listingId: string; evidenceHash: string }) => `${r.listingId}@${r.evidenceHash}`

/**
 * The current version of each listing that has a parts record for that version, with its text,
 * attributes, the record's kind and versions, its parts, and listing-ingest's card. Listings
 * with no current version or no record for it are left out: there is nothing to assess yet.
 */
export async function selectInputs(q: Queryable, listingIds: string[]): Promise<AssessmentInput[]> {
  if (listingIds.length === 0) return []
  const versions = await q
    .select({
      listingId: vCurrent.listingId,
      evidenceHash: vCurrent.evidenceHash,
      descriptionStatus: vCurrent.descriptionStatus,
      hasDescription: vCurrent.hasDescription,
      attributes: vCurrent.attributes,
      detailSections: vCurrent.detailSections,
      staleFallback: vCurrent.staleFallback,
    })
    .from(vCurrent)
    .where(inArray(vCurrent.listingId, listingIds))
  if (versions.length === 0) return []

  const recordRows = await q
    .select({
      listingId: vRecords.listingId,
      evidenceHash: vRecords.evidenceHash,
      kind: vRecords.kind,
      kindGap: vRecords.kindGap,
      ruleVersion: vRecords.ruleVersion,
      aiVersion: vRecords.aiVersion,
      photoVersion: vRecords.photoVersion,
    })
    .from(vRecords)
    .where(inArray(vRecords.listingId, listingIds))
  const recordOf = new Map(recordRows.map((r) => [keyOf(r), r]))
  const current = versions.filter((v) => recordOf.has(keyOf(v)))
  if (current.length === 0) return []
  const ids = [...new Set(current.map((v) => v.listingId))]

  const partRows = await q
    .select({
      listingId: vParts.listingId,
      evidenceHash: vParts.evidenceHash,
      seq: vParts.seq,
      partType: vParts.partType,
      catalogueId: vParts.catalogueId,
      inclusion: vParts.inclusion,
      rejected: vParts.rejected,
      source: vParts.source,
      extractor: vParts.extractor,
      quote: vParts.quote,
      start: vParts.start,
      end: vParts.end,
      conflict: vParts.conflict,
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
      cardHash: vListings.cardHash,
      displayedPreviousMinor: vListings.displayedPreviousMinor,
    })
    .from(vListings)
    .where(inArray(vListings.id, ids))
  const cardOf = new Map(cards.map((c) => [c.id, c]))

  return current.map((v) => {
    const record = recordOf.get(keyOf(v)) as (typeof recordRows)[number]
    const text = textOf.get(keyOf(v))
    const card = cardOf.get(v.listingId)
    return {
      listingId: v.listingId,
      evidenceHash: v.evidenceHash,
      cardHash: card?.cardHash ?? null,
      displayedPreviousMinor:
        card?.displayedPreviousMinor == null ? null : Number(card.displayedPreviousMinor),
      title: text?.title ?? '',
      description: text?.description ?? null,
      descriptionStatus: v.descriptionStatus as AssessmentInput['descriptionStatus'],
      hasDescription: v.hasDescription,
      attributes: v.attributes as AssessmentInput['attributes'],
      detailSections: v.detailSections as AssessmentInput['detailSections'],
      staleFallback: v.staleFallback,
      record: {
        kind: record.kind as RecordInput['kind'],
        kindGap: record.kindGap as RecordInput['kindGap'],
        ruleVersion: record.ruleVersion,
        aiVersion: record.aiVersion,
        photoVersion: record.photoVersion,
      },
      parts: partRows.filter((p) => keyOf(p) === keyOf(v)) as PartInput[],
    }
  })
}

export interface StoredAssessment extends Announced {
  id: string
  assessedAt: Date
  correction: ListingAssessmentStoredCorrection | null
}

/** The latest stored assessment of each listing version among these listings. */
export async function selectLatest(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, StoredAssessment>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({
      id: assessments.id,
      listingId: assessments.listingId,
      evidenceHash: assessments.evidenceHash,
      cardHash: assessments.cardHash,
      recordHash: assessments.recordHash,
      ruleVersion: assessments.ruleVersion,
      assessedAt: assessments.assessedAt,
      correction: assessments.correction,
    })
    .from(assessments)
    .where(inArray(assessments.listingId, listingIds))
  const latest = new Map<string, StoredAssessment>()
  for (const row of rows) {
    const seen = latest.get(keyOf(row))
    if (
      !seen ||
      row.assessedAt > seen.assessedAt ||
      (row.assessedAt.getTime() === seen.assessedAt.getTime() && row.id > seen.id)
    ) {
      latest.set(keyOf(row), {
        ...row,
        correction: row.correction as ListingAssessmentStoredCorrection | null,
      })
    }
  }
  return latest
}

export interface AssessmentRow extends Assessment {
  /** T3: the hop time of the handler that writes it. */
  assessedAt: Date
  /** A reviewer's correction carried from the latest assessment of the same version. */
  correction: ListingAssessmentStoredCorrection | null
}

/**
 * Writes each assessment. One already stored (same listing, evidence hash, card hash, record
 * hash and rule version) is skipped, so a replay or a concurrent duplicate writes nothing and
 * T3 keeps its first value. Returns how many rows were written.
 */
export async function insertAssessments(q: Queryable, rows: AssessmentRow[]): Promise<number> {
  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await q
      .insert(assessments)
      .values(
        rows.slice(i, i + 500).map((r) => ({
          listingId: r.listingId,
          evidenceHash: r.evidenceHash,
          cardHash: r.cardHash,
          recordHash: r.recordHash,
          ruleVersion: r.ruleVersion,
          form: r.form,
          container: r.container,
          containerReason: r.containerReason,
          gpuState: r.gpuState,
          cautions: r.cautions,
          coverage: r.coverage,
          confirmedParts: r.confirmedParts,
          exclusions: r.exclusions,
          extras: r.extras,
          unknowns: r.unknowns,
          assessedAt: r.assessedAt,
          correction: r.correction,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: assessments.id })
    written += inserted.length
  }
  return written
}

/** Stores a correction beside the latest assessment of a version; false when there is none. */
export async function updateCorrection(
  q: Queryable,
  key: { listingId: string; evidenceHash: string },
  correction: ListingAssessmentStoredCorrection,
): Promise<boolean> {
  const latest = (await selectLatest(q, [key.listingId])).get(keyOf(key))
  if (!latest) return false
  const rows = await q
    .update(assessments)
    .set({ correction })
    .where(and(eq(assessments.id, latest.id)))
    .returning({ id: assessments.id })
  return rows.length > 0
}

/** Removes every assessment of these listings (erasure). */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  const removed = await q
    .delete(assessments)
    .where(inArray(assessments.listingId, listingIds))
    .returning({ id: assessments.id })
  return removed.length
}

/** Now, as the database sees it (the correction's time). */
export async function selectNow(q: Queryable): Promise<string> {
  const result = (await q.execute(sql`select now() as now`)) as unknown as {
    rows: { now: Date | string }[]
  }
  return new Date(result.rows[0]?.now ?? Date.now()).toISOString()
}
