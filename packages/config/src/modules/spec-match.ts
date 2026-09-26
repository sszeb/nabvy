import { z } from 'zod'

// Thresholds of the spec-match module (rule 14 of docs/design/modules/_rules.md). Each value carries
// its basis and is a starting value until this module's fixtures calibrate it on more recorded
// runs. No prices here: the module compares a listing's ask with the user's own cap and computes
// no price.

const specMatchConfig = z.object({
  eventBatchSize: z.int().min(1).max(500),
  ruleGeneration: z.int().min(1),
  backfillDays: z.int().min(1).max(30),
  postedDeliveryTypes: z.array(z.string().regex(/^[A-Z_]{1,40}$/)).min(1),
  collectionDeliveryTypes: z.array(z.string().regex(/^[A-Z_]{1,40}$/)).min(1),
  searchCandidateLimit: z.int().min(1).max(500),
  positionMinSample: z.int().min(1),
})

export type SpecMatchRules = z.infer<typeof specMatchConfig>

const config = specMatchConfig.parse({
  /**
   * IDs per handled batch and per `spec-match.matched` event. Basis: rule 7 (at most 500 IDs per
   * event); CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
  /**
   * The generation in the rule version `s<n>.<digest>`; the digest covers every value below, so
   * an edit here gives a new version and a re-match. Status: bumped by hand on a code change to the
   * matching rules.
   */
  ruleGeneration: 1,
  /**
   * A new or edited want is matched against listings first seen within this many days. Basis: the
   * card ("backfills matches against listings first seen within the last 7 days"). Status: fixed
   * by the card.
   */
  backfillDays: 7,
  /**
   * Facebook `deliveryTypes` values that mean the seller posts the item. Basis: the actor's
   * delivery vocabulary; the recorded run (fixtures/listings/facebook/runs/2026-09-24-
   * VkryjpwS6U2GBDh3k) holds only collection values (IN_PERSON, PUBLIC_MEETUP, DOOR_PICKUP,
   * DOOR_DROPOFF), so these are unverified. Status: starting value (docs/questions/spec-match.md).
   */
  postedDeliveryTypes: ['SHIPPING', 'SHIPPING_ONSITE', 'SHIPPING_OFFSITE'],
  /**
   * Facebook `deliveryTypes` values that mean collection or a meet-up. Basis: the recorded run
   * (every listing carries one or more of these). Status: starting value.
   */
  collectionDeliveryTypes: ['IN_PERSON', 'PUBLIC_MEETUP', 'DOOR_PICKUP', 'DOOR_DROPOFF'],
  /**
   * Listings a spec search reads per call, newest first, before it filters and sorts. Basis: rule
   * 9 (500 per batch). Status: starting value.
   */
  searchCandidateLimit: 500,
  /**
   * An asking-price position takes part in the `best_position` sort only when it is shown, at a
   * sample of at least this many. Basis: docs/decisions.md (aggregates only at n≥10); the card.
   * Status: fixed by the rule.
   */
  positionMinSample: 10,
})

export const SPEC_MATCH_RULES = config
export const SPEC_MATCH_EVENT_BATCH_SIZE = config.eventBatchSize
