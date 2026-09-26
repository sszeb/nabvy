// Database access: this module's own schema, warning_signs; detail-evidence's v_current and
// v_text; listing-ingest's v_listings; listing-assessment's v_assessments; and
// asking-price-index's v_members and v_groups, as nabvy_pipeline inside withPipeline.

import { WARNING_SIGNS_RULES } from '@nabvy/config/modules/warning-signs'
import { vGroups, vMembers } from '@nabvy/db/schema/asking-price-index'
import { vCurrent, vText } from '@nabvy/db/schema/detail-evidence'
import { vAssessments } from '@nabvy/db/schema/listing-assessment'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import { evaluations, facts } from '@nabvy/db/schema/warning-signs'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Announced, EvaluateInput, Evaluation, ExclusionInput, GroupAsk } from '../domain'

// A type query rather than a separate statement, as in noise-filter: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const keyOf = (r: { listingId: string; evidenceHash: string }) => `${r.listingId}@${r.evidenceHash}`

/**
 * The current version of each listing, with its text (the card's title when the version has no
 * text row), card hash and T1, the assessment's
 * cautions and exclusions for that version (null when it has none), and each index group the
 * listing's ask is compared in. Listings with no current version or no card are left out: there
 * is nothing to evaluate yet.
 */
export async function selectInputs(q: Queryable, listingIds: string[]): Promise<EvaluateInput[]> {
  if (listingIds.length === 0) return []
  // v_text leaves out versions with no description text, so it is left-joined: the title rules
  // still run on such a version, from the card's title.
  const versions = await q
    .select({
      listingId: vCurrent.listingId,
      evidenceHash: vCurrent.evidenceHash,
      descriptionStatus: vCurrent.descriptionStatus,
      title: vText.title,
      description: vText.description,
    })
    .from(vCurrent)
    .leftJoin(
      vText,
      and(eq(vText.listingId, vCurrent.listingId), eq(vText.evidenceHash, vCurrent.evidenceHash)),
    )
    .where(inArray(vCurrent.listingId, listingIds))
  if (versions.length === 0) return []
  const ids = [...new Set(versions.map((v) => v.listingId))]

  const cards = await q
    .select({
      listingId: vListings.id,
      cardHash: vListings.cardHash,
      title: vListings.title,
      fetchedAt: vListings.firstFetchedAt,
    })
    .from(vListings)
    .where(inArray(vListings.id, ids))
  const cardOf = new Map(cards.map((c) => [c.listingId, c]))

  const assessed = await q
    .select({
      listingId: vAssessments.listingId,
      evidenceHash: vAssessments.evidenceHash,
      cautions: vAssessments.cautions,
      exclusions: vAssessments.exclusions,
    })
    .from(vAssessments)
    .where(inArray(vAssessments.listingId, ids))
  const assessmentOf = new Map(assessed.map((a) => [keyOf(a), a]))

  const members = await q
    .select({
      listingId: vMembers.listingId,
      groupKey: vMembers.groupKey,
      askMinor: vMembers.askMinor,
      counted: vMembers.counted,
      excluded: vMembers.excluded,
      medianMinor: vGroups.median,
      n: vGroups.n,
      currency: vGroups.currency,
      asOf: vGroups.asOf,
    })
    .from(vMembers)
    .innerJoin(vGroups, eq(vGroups.groupKey, vMembers.groupKey))
    .where(inArray(vMembers.listingId, ids))
  const compared = new Set(WARNING_SIGNS_RULES.askExclusionsCompared)
  const groupsOf = new Map<string, GroupAsk[]>()
  for (const m of members) {
    if (!m.counted && !(m.excluded !== null && compared.has(m.excluded))) continue
    if (m.asOf === null) continue
    const list = groupsOf.get(m.listingId) ?? []
    list.push({
      groupKey: m.groupKey,
      asOf: m.asOf.toISOString(),
      askMinor: Number(m.askMinor),
      medianMinor: m.medianMinor === null ? null : Number(m.medianMinor),
      n: m.n,
      currency: m.currency,
    })
    groupsOf.set(m.listingId, list)
  }

  const out: EvaluateInput[] = []
  for (const v of versions) {
    const card = cardOf.get(v.listingId)
    if (!card) continue
    const a = assessmentOf.get(keyOf(v))
    out.push({
      listingId: v.listingId,
      evidenceHash: v.evidenceHash,
      cardHash: card.cardHash,
      title: v.title ?? card.title,
      description: v.description ?? null,
      descriptionStatus: v.descriptionStatus ?? 'missing',
      fetchedAt: card.fetchedAt,
      cautions: a ? (a.cautions as string[]) : null,
      exclusions: a
        ? (a.exclusions as { partType: string; seq: number | null }[]).map(
            (e): ExclusionInput => ({ partType: e.partType, seq: e.seq }),
          )
        : null,
      groups: groupsOf.get(v.listingId) ?? [],
    })
  }
  return out.sort((a, b) => a.listingId.localeCompare(b.listingId))
}

/** Listing IDs whose asks are members of these index groups. */
export async function selectGroupListings(q: Queryable, groupKeys: string[]): Promise<string[]> {
  if (groupKeys.length === 0) return []
  const rows = await q
    .selectDistinct({ listingId: vMembers.listingId })
    .from(vMembers)
    .where(inArray(vMembers.groupKey, groupKeys))
  return rows.map((r) => r.listingId).sort()
}

/** Each listing's latest evaluation (any version), by `evaluated_at`, then id. */
export async function selectLatest(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, Announced & { id: string; cardHash: string }>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .selectDistinctOn([evaluations.listingId], {
      id: evaluations.id,
      listingId: evaluations.listingId,
      evidenceHash: evaluations.evidenceHash,
      cardHash: evaluations.cardHash,
      inputHash: evaluations.inputHash,
      ruleVersion: evaluations.ruleVersion,
    })
    .from(evaluations)
    .where(inArray(evaluations.listingId, listingIds))
    .orderBy(evaluations.listingId, desc(evaluations.evaluatedAt), desc(evaluations.id))
  return new Map(rows.map((r) => [r.listingId, r]))
}

/**
 * Writes each evaluation and its facts, with `now` as the done time. An evaluation whose key is
 * already stored (inputs returned to an earlier state) is not written again: its
 * `evaluated_at` moves to `now`, so it is the latest once more, and its facts stay as found.
 * Returns how many evaluations were newly written.
 */
export async function writeEvaluations(
  q: Queryable,
  rows: readonly Evaluation[],
  now: Date,
): Promise<number> {
  let written = 0
  for (const e of rows) {
    const [inserted] = await q
      .insert(evaluations)
      .values({
        listingId: e.listingId,
        evidenceHash: e.evidenceHash,
        cardHash: e.cardHash,
        inputHash: e.inputHash,
        ruleVersion: e.ruleVersion,
        fetchedAt: e.fetchedAt,
        evaluatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: evaluations.id })
    if (!inserted) {
      await q
        .update(evaluations)
        .set({ evaluatedAt: now })
        .where(
          and(
            eq(evaluations.listingId, e.listingId),
            eq(evaluations.evidenceHash, e.evidenceHash),
            eq(evaluations.cardHash, e.cardHash),
            eq(evaluations.inputHash, e.inputHash),
            eq(evaluations.ruleVersion, e.ruleVersion),
          ),
        )
      continue
    }
    written += 1
    if (e.facts.length === 0) continue
    await q.insert(facts).values(
      e.facts.map((f) => ({
        evaluationId: inserted.id,
        listingId: e.listingId,
        evidenceHash: e.evidenceHash,
        cardHash: e.cardHash,
        code: f.code,
        reason: f.reason,
        evidence: f.evidence,
        evidenceText: f.evidenceText,
        ruleId: f.ruleId,
        ruleVersion: e.ruleVersion,
        foundAt: now,
      })),
    )
  }
  return written
}

/** Removes every evaluation and fact of these listings. Returns how many evaluations went. */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  await q.delete(facts).where(inArray(facts.listingId, listingIds))
  const removed = await q
    .delete(evaluations)
    .where(inArray(evaluations.listingId, listingIds))
    .returning({ id: evaluations.id })
  return removed.length
}
