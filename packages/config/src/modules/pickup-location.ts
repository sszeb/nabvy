import { z } from 'zod'

// Thresholds of the pickup-location module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. Distances are in kilometres between gazetteer
// points; nothing here is a price.

const pickupLocationConfig = z.object({
  eventBatchSize: z.number().int().min(1).max(500),
  agreeKm: z.number().positive().max(100),
  conflictKm: z.number().positive().max(500),
  deliveryFarKm: z.number().positive().max(1000),
  cueWindowChars: z.number().int().min(10).max(200),
  maxCandidatesPerVersion: z.number().int().min(1).max(100),
})

const config = pickupLocationConfig.parse({
  /**
   * Listing IDs per event and per handled batch. Basis: rule 7 (at most 500 listing IDs per
   * event) and CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
  /**
   * A text place within this distance of the field agrees with it. Basis: the listing-location
   * draft §3.6 (every text place in the sample lay within about 2.5 km of the coordinates; the
   * label error reached 11.6 km). Status: starting value.
   */
  agreeKm: 10,
  /**
   * A text place beyond this distance from the field is a conflict. Basis: draft §3.6, well
   * above the largest label error (11.6 km), roughly the spacing of UK towns. Status: starting
   * value.
   */
  conflictKm: 25,
  /**
   * A delivery-area place further than this from the field makes the listing uncertain. Basis:
   * draft §3.6 row 9a (above the roughly 75 km Brighton–London drive a seller might offer for
   * local delivery; an estimate). Status: starting value.
   */
  deliveryFarKm: 100,
  /**
   * Characters read before a place mention for its cue ("collection from", "based in").
   * Basis: draft §3.4, the cue sits in the few words before the place; 40 covers "available for
   * collection only from" with room. Status: starting value.
   */
  cueWindowChars: 40,
  /**
   * Candidates kept per listing version, in text order. Basis: draft §7.1 (`candidates` bounded
   * per version); a keyword-stuffed description can name dozens of towns. Status: starting
   * value.
   */
  maxCandidatesPerVersion: 20,
})

export const PICKUP_LOCATION_EVENT_BATCH_SIZE = config.eventBatchSize
export const PICKUP_LOCATION_AGREE_KM = config.agreeKm
export const PICKUP_LOCATION_CONFLICT_KM = config.conflictKm
export const PICKUP_LOCATION_DELIVERY_FAR_KM = config.deliveryFarKm
export const PICKUP_LOCATION_CUE_WINDOW_CHARS = config.cueWindowChars
export const PICKUP_LOCATION_MAX_CANDIDATES = config.maxCandidatesPerVersion
