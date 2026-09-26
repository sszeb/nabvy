import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { CityPageId } from './city-pages'

// Contracts of the search-planner module (docs/design/modules/search-planner.md): the region
// search plan (verified centre x a few terms, never per user) and the owner's one-off runs.
// Import from '@nabvy/contracts/modules/search-planner'. Nothing here carries a user ID except
// the approver of a one-off run, which stays in the module's table and never reaches a view.

export const module = 'search-planner'

/**
 * A search term: lower case, letters, digits, spaces and `. + -`, 1-100 characters. Terms come
 * from product-catalogue families, the card's container terms or an admin, never from listing
 * text (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:186-188).
 */
export const SearchPlannerTerm = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9 .+-]*$/)
export type SearchPlannerTerm = z.infer<typeof SearchPlannerTerm>

/**
 * A term's class for the scheduler (fb-scrap-engine/docs/design/SCALE_PLAN.md:54-56): `narrow`,
 * a model term (a family such as "rtx 3090"); `broad`, a container term ("gaming pc", "pc").
 */
export const SearchPlannerTermClass = z.enum(['narrow', 'broad'])
export type SearchPlannerTermClass = z.infer<typeof SearchPlannerTermClass>

/** Why a pair is in the plan: active wants, a side-discovery pivot (not built), or the admin test. */
export const SearchPlannerOrigin = z.enum(['wants', 'pivot', 'admin-test'])
export type SearchPlannerOrigin = z.infer<typeof SearchPlannerOrigin>

/**
 * One row of `search_planner.v_plan` (internal): a (centre, term) pair that runs. Only pairs of
 * active plans (verified, active centres) inside the budget bound appear. Counts, never user IDs.
 */
export const SearchPlannerPlan = z.strictObject({
  centreId: CityPageId,
  term: SearchPlannerTerm,
  class: SearchPlannerTermClass,
  origins: z.array(SearchPlannerOrigin).min(1),
  wantCount: z.int().min(0),
  paidWantCount: z.int().min(0),
  /** 1 = the first pair kept under the budget bound (README.md, "Rules and thresholds"). */
  rank: z.int().min(1),
})
export type SearchPlannerPlan = z.infer<typeof SearchPlannerPlan>

/**
 * What a one-off run is for (card, "Owns"). `verification` needs no approval (the owner allowed
 * them in general, docs/decisions.md "The grid"); every other purpose needs an audited approval.
 */
export const SearchPlannerOneOffPurpose = z.enum([
  'verification',
  'gap-fill',
  'actor-test',
  'fixture',
])
export type SearchPlannerOneOffPurpose = z.infer<typeof SearchPlannerOneOffPurpose>

/** A one-off run's life: recorded here, then submitted and finished by `check-scheduler`. */
export const SearchPlannerOneOffStatus = z.enum([
  'pending',
  'submitted',
  'completed',
  'failed',
  'cancelled',
])
export type SearchPlannerOneOffStatus = z.infer<typeof SearchPlannerOneOffStatus>

/**
 * A one-off run's input: a centre and terms (a search), or listing IDs (a details run). The run's
 * shape (sort, pages, details on or off) is `check-scheduler`'s and the gateway's, not this
 * module's.
 */
export const SearchPlannerOneOffInput = z
  .strictObject({
    centreId: CityPageId.optional(),
    terms: z.array(SearchPlannerTerm).min(1).max(10).optional(),
    listingIds: z.array(z.string().min(1).max(64)).min(1).max(200).optional(),
  })
  .refine((i) => i.centreId !== undefined || i.listingIds !== undefined, {
    message: 'a one-off run names a centre or listing IDs',
  })
export type SearchPlannerOneOffInput = z.infer<typeof SearchPlannerOneOffInput>

/** One row of `search_planner.v_one_off_runs` (internal). `approved`, never the approver's ID. */
export const SearchPlannerOneOffRun = z.strictObject({
  id: Uuid,
  purpose: SearchPlannerOneOffPurpose,
  input: SearchPlannerOneOffInput,
  approved: z.boolean(),
  status: SearchPlannerOneOffStatus,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type SearchPlannerOneOffRun = z.infer<typeof SearchPlannerOneOffRun>

/** The owner's approval of a one-off run: who and why. Written to the audit log. */
export const SearchPlannerApproval = z.strictObject({
  actorUserId: Uuid,
  reason: z.string().trim().min(1).max(1000),
})
export type SearchPlannerApproval = z.infer<typeof SearchPlannerApproval>

/** `recordOneOffRun()` input. Any purpose but `verification` without `approval` is refused. */
export const SearchPlannerRecordOneOffInput = z.strictObject({
  purpose: SearchPlannerOneOffPurpose,
  input: SearchPlannerOneOffInput,
  approval: SearchPlannerApproval.optional(),
})
export type SearchPlannerRecordOneOffInput = z.infer<typeof SearchPlannerRecordOneOffInput>

/** `setOneOffRunStatus()` input, for `check-scheduler`. */
export const SearchPlannerSetOneOffStatusInput = z.strictObject({
  id: Uuid,
  status: SearchPlannerOneOffStatus.exclude(['pending']),
})
export type SearchPlannerSetOneOffStatusInput = z.infer<typeof SearchPlannerSetOneOffStatusInput>

/**
 * `addAdminTestPair()` / `removeAdminTestPair()` input: the owner's rtx3090 test hunt enters as
 * one audited admin pair until `want-manager` is on (card; actor-integration.md task 1.2b).
 */
export const SearchPlannerAdminTestPairInput = z.strictObject({
  centreId: CityPageId,
  term: SearchPlannerTerm,
  actorUserId: Uuid,
  reason: z.string().trim().min(1).max(1000),
})
export type SearchPlannerAdminTestPairInput = z.infer<typeof SearchPlannerAdminTestPairInput>

/** The payload of `search-planner.plan-changed`: centre IDs only (rule 7), 1-500 per envelope. */
export const SearchPlannerPlanChangedEvent = z.strictObject({
  centreIds: z.array(CityPageId).min(1).max(500),
})
export type SearchPlannerPlanChangedEvent = z.infer<typeof SearchPlannerPlanChangedEvent>

/** Error codes (`<module>.<code>`, packages/contracts/README.md). */
export const SearchPlannerErrorCode = z.enum([
  'search-planner.off', //                  the module is off: nothing recorded
  'search-planner.approval_required', //    a one-off run other than verification, unapproved
  'search-planner.want_manager_on', //      no admin-test pair once want-manager is on
  'search-planner.not_found', //            no such one-off run or admin pair
  'search-planner.invalid_transition', //   a one-off run's status cannot move that way
])
export type SearchPlannerErrorCode = z.infer<typeof SearchPlannerErrorCode>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  /** The runnable pairs of these centres changed (added, removed, re-ranked in or out). */
  'search-planner.plan-changed': { 1: SearchPlannerPlanChangedEvent },
})
