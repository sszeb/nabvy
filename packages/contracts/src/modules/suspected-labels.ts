import { z } from 'zod'
import { defineEvents, Uuid } from '../index'

// Contracts of the suspected-labels module (docs/design/modules/suspected-labels.md): labels
// that mark a listing with a documented suspicion (scam, trade seller, too good to be true),
// each with its evidence, a rule version, and a report/correction route. No seller identity
// shown. Scam and too-good-to-be-true labels run in shadow first.

export const module = 'suspected-labels'

/** Label types that can be assigned to listings. */
export const SuspectedLabelsType = z.enum([
  'suspected_scam',
  'suspected_trade_seller',
  'suspected_flipper',
  'suspected_too_good_to_be_true',
])
export type SuspectedLabelsType = z.infer<typeof SuspectedLabelsType>

/** Mode of a label type: shadow (internal only), reviewed (in legal/content review), or on (shown to users). */
export const SuspectedLabelsMode = z.enum(['shadow', 'reviewed', 'on'])
export type SuspectedLabelsMode = z.infer<typeof SuspectedLabelsMode>

/** Rule version string: r<n>.<first 8 hex of the rules' digest>. */
export const SuspectedLabelsRuleVersion = z.string().regex(/^r\d+\.[0-9a-f]{8}$/)
export type SuspectedLabelsRuleVersion = z.infer<typeof SuspectedLabelsRuleVersion>

/** SHA-256 (hex) of the evidence that produced a label. */
export const SuspectedLabelsEvidenceHash = z.string().regex(/^[0-9a-f]{64}$/)

/** Path for too-good-to-be-true evaluation: A (two listing signals), B (report + listing signal), C (reports from multiple people), B-P (report + price, review-only). */
export const SuspectedLabelsTgtbtPath = z.enum(['A', 'B', 'C', 'B-P'])
export type SuspectedLabelsTgtbtPath = z.infer<typeof SuspectedLabelsTgtbtPath>

/** Signal types for too-good-to-be-true evidence. */
export const SuspectedLabelsTgtbtSignal = z.enum([
  'ask_far_below_comparable',
  'location_mismatch',
  'delivery_conflict_with_collection',
  'risky_payment_request',
  'copy_across_distant_places',
])
export type SuspectedLabelsTgtbtSignal = z.infer<typeof SuspectedLabelsTgtbtSignal>

/** Status of a too-good-to-be-true signal in a listing. */
export const SuspectedLabelsSignalState = z.enum(['present', 'absent', 'unknown'])
export type SuspectedLabelsSignalState = z.infer<typeof SuspectedLabelsSignalState>

/** Support level for a signal: 'strong' (directly stated), 'inferred' (derived), 'weak' (edge case). */
export const SuspectedLabelsTgtbtSupport = z.enum(['strong', 'inferred', 'weak'])
export type SuspectedLabelsTgtbtSupport = z.infer<typeof SuspectedLabelsTgtbtSupport>

/** One piece of evidence for a too-good-to-be-true label. */
export const SuspectedLabelsTgtbtEvidenceItem = z.object({
  signal: SuspectedLabelsTgtbtSignal,
  state: SuspectedLabelsSignalState,
  support: SuspectedLabelsTgtbtSupport,
  source: z.enum(['listing', 'report']),
  detail: z.string().optional(),
})
export type SuspectedLabelsTgtbtEvidenceItem = z.infer<typeof SuspectedLabelsTgtbtEvidenceItem>

/** Evidence structure for too-good-to-be-true labels. */
export const SuspectedLabelsTgtbtEvidence = z.object({
  path: SuspectedLabelsTgtbtPath,
  items: z.array(SuspectedLabelsTgtbtEvidenceItem),
  report_count: z.number().int().min(0).optional(),
  would_show: z.boolean(),
})
export type SuspectedLabelsTgtbtEvidence = z.infer<typeof SuspectedLabelsTgtbtEvidence>

/** Discriminated union of evidence by label type. */
export const SuspectedLabelsEvidence = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('suspected_too_good_to_be_true'),
    data: SuspectedLabelsTgtbtEvidence,
  }),
  z.object({ type: z.literal('suspected_scam'), data: z.object({ facts: z.array(z.string()) }) }),
  z.object({
    type: z.literal('suspected_trade_seller'),
    data: z.object({ signals: z.array(z.string()) }),
  }),
  z.object({
    type: z.literal('suspected_flipper'),
    data: z.object({ signals: z.array(z.string()) }),
  }),
])
export type SuspectedLabelsEvidence = z.infer<typeof SuspectedLabelsEvidence>

/** Reason for a correction request. */
export const SuspectedLabelsCorrectionReason = z.enum([
  'incorrect_label',
  'false_positive',
  'label_no_longer_applies',
  'insufficient_evidence',
  'other',
])
export type SuspectedLabelsCorrectionReason = z.infer<typeof SuspectedLabelsCorrectionReason>

/** Status of a correction request. */
export const SuspectedLabelsCorrectionStatus = z.enum([
  'pending',
  'reviewed',
  'approved',
  'rejected',
])
export type SuspectedLabelsCorrectionStatus = z.infer<typeof SuspectedLabelsCorrectionStatus>

/** Requester kind for correction requests. */
export const SuspectedLabelsRequesterKind = z.enum(['user', 'seller'])
export type SuspectedLabelsRequesterKind = z.infer<typeof SuspectedLabelsRequesterKind>

/** Input for requesting a correction to a label. */
export const SuspectedLabelsCorrectionRequestInput = z.object({
  label_id: Uuid,
  reason: SuspectedLabelsCorrectionReason,
  text: z.string().min(1).max(1000),
  contact_email: z.string().email().optional(),
})
export type SuspectedLabelsCorrectionRequestInput = z.infer<
  typeof SuspectedLabelsCorrectionRequestInput
>

/** Input for approving a candidate label. */
export const SuspectedLabelsApproveInput = z.object({
  candidate_id: Uuid,
  decision: z.enum(['approve', 'reject']),
  evidence_codes: z.array(z.string()).optional(),
})
export type SuspectedLabelsApproveInput = z.infer<typeof SuspectedLabelsApproveInput>

/** Event emitted when labels change for listings. */
export const SuspectedLabelsChangedEvent = z.object({
  listing_ids: z.array(z.string()).min(1).max(500),
})
export type SuspectedLabelsChangedEvent = z.infer<typeof SuspectedLabelsChangedEvent>

// Event registry
export const events = defineEvents(module, {
  'labels.changed': { 1: SuspectedLabelsChangedEvent },
})
