import type {
  SuspectedLabelsEvidence,
  SuspectedLabelsType,
} from '@nabvy/contracts/modules/suspected-labels'
import * as schema from '@nabvy/db/schema/suspected-labels'
import { and, eq, isNull } from 'drizzle-orm'

type Queryable = import('@nabvy/db').Queryable

/**
 * Inserts or updates an evaluation record with idempotent key.
 */
export async function upsertEvaluation(
  db: Queryable,
  evaluation: {
    source: string
    source_listing_id: string
    evidence_hash: string
    card_hash?: string
    inputs_hash?: string
    rule_version: string
    signals?: Record<string, unknown>
    paths_met?: string[]
    t1_fetched_at?: Date
  },
): Promise<void> {
  await db
    .insert(schema.evaluations)
    .values({
      source: evaluation.source,
      source_listing_id: evaluation.source_listing_id,
      evidence_hash: evaluation.evidence_hash,
      card_hash: evaluation.card_hash,
      inputs_hash: evaluation.inputs_hash,
      rule_version: evaluation.rule_version,
      signals: evaluation.signals,
      paths_met: evaluation.paths_met,
      t1_fetched_at: evaluation.t1_fetched_at,
      done_at: new Date(),
    })
    .onConflictDoNothing()
}

/**
 * Creates a candidate label for review.
 */
export async function createCandidate(
  db: Queryable,
  candidate: {
    source: string
    source_listing_id: string
    label_type: SuspectedLabelsType
    rule_id: string
    rule_version: string
    evidence: SuspectedLabelsEvidence
    would_show: boolean
    held_reason?: string | null
  },
): Promise<string> {
  const result = await db
    .insert(schema.candidates)
    .values({
      source: candidate.source,
      source_listing_id: candidate.source_listing_id,
      label_type: candidate.label_type,
      rule_id: candidate.rule_id,
      rule_version: candidate.rule_version,
      evidence: candidate.evidence,
      would_show: candidate.would_show,
      held_reason: candidate.held_reason || null,
    })
    .returning({ id: schema.candidates.id })

  return result[0]?.id || ''
}

/**
 * Gets candidate labels for a listing.
 */
export async function getCandidatesForListing(
  db: Queryable,
  source: string,
  source_listing_id: string,
): Promise<(typeof schema.candidates.$inferSelect)[]> {
  return await db
    .select()
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.source, source),
        eq(schema.candidates.source_listing_id, source_listing_id),
        isNull(schema.candidates.cleared_at),
      ),
    )
}

/**
 * Approves a candidate label.
 */
export async function approveCandidate(
  db: Queryable,
  candidateId: string,
  decision: 'approve' | 'reject',
  by: string,
): Promise<void> {
  const candidates = await db
    .select()
    .from(schema.candidates)
    .where(eq(schema.candidates.id, candidateId))
    .limit(1)

  const candidate = candidates[0]
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`)

  if (decision === 'approve') {
    // Create label from candidate
    await db.insert(schema.labels).values({
      source: candidate.source,
      source_listing_id: candidate.source_listing_id,
      label_type: candidate.label_type,
      candidate_id: candidateId,
      evidence: candidate.evidence,
      shown_at: new Date(),
    })
  }

  // Record approval
  await db.insert(schema.approvals).values({
    candidate_id: candidateId,
    decision,
    by,
  })
}

/**
 * Gets published labels for a listing.
 */
export async function getLabelsForListing(
  db: Queryable,
  source: string,
  source_listing_id: string,
): Promise<(typeof schema.labels.$inferSelect)[]> {
  return await db
    .select()
    .from(schema.labels)
    .where(
      and(
        eq(schema.labels.source, source),
        eq(schema.labels.source_listing_id, source_listing_id),
        isNull(schema.labels.removed_at),
      ),
    )
}
