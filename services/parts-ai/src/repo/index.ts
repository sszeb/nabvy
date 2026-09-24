// Database access: this module's own schema, parts_ai, detail-evidence's v_current and v_text,
// and parts-rules' v_gaps, as nabvy_pipeline inside withPipeline.

import type {
  PartsAiProblem,
  PartsAiRunStatus,
  PartsAiStoredCorrection,
} from '@nabvy/contracts/modules/parts-ai'
import type { PartsRulesPartGap } from '@nabvy/contracts/modules/parts-rules'
import { vCurrent, vText } from '@nabvy/db/schema/detail-evidence'
import { aiParts, calls, quarantine, refreshes } from '@nabvy/db/schema/parts-ai'
import { vGaps } from '@nabvy/db/schema/parts-rules'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { CheckedPart, Located } from '../domain'

// A type query rather than a separate statement, as in parts-rules: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

export interface Target {
  listingId: string
  evidenceHash: string
  source: string
  sourceListingId: string
  descriptionStatus: string | null
  /** The kind the rules settled on (null when open). */
  kind: string | null
  kindGap: string | null
  parts: PartsRulesPartGap[]
  title: string
  description: string
}

/**
 * The current version of each listing with the rules' run over it at `ruleVersion`, and its
 * text. Listings with no current version or no run at that version are left out.
 */
export async function selectTargets(
  q: Queryable,
  listingIds: string[],
  ruleVersion: string,
): Promise<Target[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({
      listingId: vCurrent.listingId,
      evidenceHash: vCurrent.evidenceHash,
      source: vCurrent.source,
      sourceListingId: vCurrent.sourceListingId,
      descriptionStatus: vCurrent.descriptionStatus,
      kind: vGaps.kind,
      kindGap: vGaps.kindGap,
      parts: vGaps.parts,
      title: vText.title,
      description: vText.description,
    })
    .from(vCurrent)
    .innerJoin(
      vGaps,
      and(
        eq(vGaps.listingId, vCurrent.listingId),
        eq(vGaps.evidenceHash, vCurrent.evidenceHash),
        eq(vGaps.ruleVersion, ruleVersion),
      ),
    )
    .innerJoin(
      vText,
      and(eq(vText.listingId, vCurrent.listingId), eq(vText.evidenceHash, vCurrent.evidenceHash)),
    )
    .where(inArray(vCurrent.listingId, listingIds))
  return rows.map((r) => ({
    ...r,
    parts: (r.parts ?? []) as PartsRulesPartGap[],
    title: r.title ?? '',
    description: r.description ?? '',
  }))
}

/**
 * Listings (up to `limit`) whose current version the rules left open at `ruleVersion` and that
 * have no call at `promptVersion` and no refresh request yet: the sweep's work.
 */
export async function selectPending(
  q: Queryable,
  ruleVersion: string,
  promptVersion: string,
  limit: number,
): Promise<string[]> {
  const result = (await q.execute(sql`
    select c.listing_id
    from detail_evidence.v_current c
    join parts_rules.v_gaps g
      on g.listing_id = c.listing_id and g.evidence_hash = c.evidence_hash
     and g.rule_version = ${ruleVersion}
    where (g.kind_gap is not null or jsonb_array_length(g.parts) > 0)
      and not exists (
        select 1 from parts_ai.calls a
        where a.listing_id = c.listing_id and a.evidence_hash = c.evidence_hash
          and a.prompt_version = ${promptVersion})
      and not exists (
        select 1 from parts_ai.refreshes r
        where r.listing_id = c.listing_id and r.evidence_hash = c.evidence_hash)
    order by g.done_at, c.listing_id
    limit ${limit}`)) as unknown as { rows: { listing_id: string }[] }
  return result.rows.map((r) => r.listing_id)
}

/** How each (listing, evidence hash) among these listings ended at this prompt version. */
export async function selectDone(
  q: Queryable,
  listingIds: string[],
  promptVersion: string,
): Promise<Map<string, PartsAiRunStatus>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({ listingId: calls.listingId, evidenceHash: calls.evidenceHash, status: calls.status })
    .from(calls)
    .where(and(inArray(calls.listingId, listingIds), eq(calls.promptVersion, promptVersion)))
  return new Map(
    rows.map((r) => [`${r.listingId}@${r.evidenceHash}`, r.status as PartsAiRunStatus]),
  )
}

/**
 * Records a refresh request per listing version; returns those not recorded before, so each
 * version is sent to details-queue once.
 */
export async function insertRefreshes(
  q: Queryable,
  rows: Array<{ listingId: string; evidenceHash: string; source: string; sourceListingId: string }>,
): Promise<typeof rows> {
  if (rows.length === 0) return []
  const inserted = await q.insert(refreshes).values(rows).onConflictDoNothing().returning({
    listingId: refreshes.listingId,
    evidenceHash: refreshes.evidenceHash,
    source: refreshes.source,
    sourceListingId: refreshes.sourceListingId,
  })
  return inserted
}

/**
 * Serialises batches for the length of the transaction, so two batches never call the model for
 * the same version or both pass the daily cap (the pattern of details-queue's tick lock).
 */
export async function lockBatches(q: Queryable): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtext('parts_ai.batch'))`)
}

/** What calls cost in the 24 hours before the database's now, in GBP micros. */
export async function spentLastDay(q: Queryable): Promise<number> {
  const result = (await q.execute(sql`
    select coalesce(sum(cost_gbp_micros), 0)::bigint as spent
    from parts_ai.calls where done_at > now() - interval '24 hours'`)) as unknown as {
    rows: { spent: string | number }[]
  }
  return Number(result.rows[0]?.spent ?? 0)
}

export interface CallRow {
  listingId: string
  evidenceHash: string
  promptVersion: string
  model: string
  traceId: string
  costGbpMicros: number
  outcome:
    | { status: 'extracted'; kind: { kind: string; located: Located } | null; parts: StoredPart[] }
    | { status: 'quarantined'; problem: PartsAiProblem; detail: string }
}

export interface StoredPart extends CheckedPart {
  catalogueId: string | null
  family: string | null
}

/**
 * Writes one call and its parts or its quarantine row. A call already stored (same listing,
 * evidence hash and prompt version) is skipped with everything under it, so a replay or a
 * concurrent duplicate writes nothing. Returns whether the call was written.
 */
export async function insertCall(q: Queryable, row: CallRow): Promise<boolean> {
  const kind = row.outcome.status === 'extracted' ? row.outcome.kind : null
  const inserted = await q
    .insert(calls)
    .values({
      listingId: row.listingId,
      evidenceHash: row.evidenceHash,
      promptVersion: row.promptVersion,
      model: row.model,
      traceId: row.traceId,
      costGbpMicros: row.costGbpMicros,
      status: row.outcome.status,
      kind: kind?.kind ?? null,
      kindSource: kind?.located.source ?? null,
      kindQuote: kind?.located.quote ?? null,
      kindStart: kind?.located.start ?? null,
      kindEnd: kind?.located.end ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: calls.id })
  if (inserted.length === 0) return false
  const key = {
    listingId: row.listingId,
    evidenceHash: row.evidenceHash,
    promptVersion: row.promptVersion,
  }
  if (row.outcome.status === 'quarantined') {
    await q
      .insert(quarantine)
      .values({ ...key, problem: row.outcome.problem, detail: row.outcome.detail.slice(0, 500) })
      .onConflictDoNothing()
    return true
  }
  const parts = row.outcome.parts.map((p, seq) => ({
    ...key,
    seq,
    partType: p.partType,
    catalogueId: p.catalogueId,
    family: p.family,
    inclusion: p.inclusion,
    source: p.located.source,
    quote: p.located.quote,
    quoteStart: p.located.start,
    quoteEnd: p.located.end,
  }))
  if (parts.length > 0) await q.insert(aiParts).values(parts).onConflictDoNothing()
  return true
}

/** Stores a correction beside one AI part; false when no such part exists. */
export async function updateCorrection(
  q: Queryable,
  key: { listingId: string; evidenceHash: string; promptVersion: string; seq: number },
  correction: PartsAiStoredCorrection,
): Promise<boolean> {
  const rows = await q
    .update(aiParts)
    .set({ correction })
    .where(
      and(
        eq(aiParts.listingId, key.listingId),
        eq(aiParts.evidenceHash, key.evidenceHash),
        eq(aiParts.promptVersion, key.promptVersion),
        eq(aiParts.seq, key.seq),
      ),
    )
    .returning({ seq: aiParts.seq })
  return rows.length > 0
}

/** Removes every call, part, quarantine row and refresh of these listings (erasure). */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  await q.delete(aiParts).where(inArray(aiParts.listingId, listingIds))
  await q.delete(quarantine).where(inArray(quarantine.listingId, listingIds))
  await q.delete(refreshes).where(inArray(refreshes.listingId, listingIds))
  const removed = await q
    .delete(calls)
    .where(inArray(calls.listingId, listingIds))
    .returning({ id: calls.id })
  return removed.length
}

/** Now, as the database sees it (a correction's time). */
export async function selectNow(q: Queryable): Promise<string> {
  const result = (await q.execute(sql`select now() as now`)) as unknown as {
    rows: { now: Date | string }[]
  }
  return new Date(result.rows[0]?.now ?? Date.now()).toISOString()
}
