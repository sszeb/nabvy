import { z } from 'zod'

// Thresholds of the travel-cost module (rule 14 of docs/design/modules/_rules.md). The pence
// figures themselves (HMRC advisory fuel rate, HMRC approved mileage rate, the National Living
// Wage) are never here: they are dated, sourced rows in `travel_cost.travel_rates`
// (services/travel-cost/README.md), because they change on a schedule HMRC and GOV.UK set, not on
// a code deploy. What lives here is the non-monetary calibration the §4.2 formula needs, which
// nothing government publishes a dated rate for.

const travelCostConfig = z.object({
  roadMilesPerStraightLineMile: z.number().positive(),
  averageSpeedMph: z.number().positive(),
  litresPerUkGallon: z.number().positive(),
  quarterlyReviewMonths: z.array(z.number().int().min(1).max(12)).length(4),
})

const config = travelCostConfig.parse({
  /**
   * Road miles per straight-line mile ("circuity"): the ratio the §4.2 formula uses to turn a
   * straight-line distance into a round-trip road estimate when no routed distance is available.
   * Basis: Lovelace, thesis ch. 5 (circuity: Ballou 2002, Cole 1968, Levinson and El-Geneidy 2009)
   * — docs/design/drafts/search-map-routes.md §4.2, citation [102]. Status: starting value, to be
   * calibrated against OSRM once `router-gateway`/`travel-time` ship.
   */
  roadMilesPerStraightLineMile: 1.3,
  /**
   * Average speed (mph) used to turn extra road miles into extra minutes when no routed duration
   * is available. Basis: assumption (the search-map-routes pickups researcher), §4.2. Status:
   * starting value, to be calibrated against OSRM.
   */
  averageSpeedMph: 35,
  /**
   * A UK (imperial) gallon in litres, for the "custom: mpg + fuel price" preset
   * (`pencePerMile = fuelPricePencePerLitre × litresPerUkGallon ÷ mpg`). A fixed unit conversion,
   * not a rate: never changes, so it carries no effective date or source row.
   */
  litresPerUkGallon: 4.54609,
  /**
   * The months travel-cost reminds the coordinator to check HMRC's advisory fuel rates for a new
   * quarter (services/travel-cost/README.md, "Job"; docs/design/drafts/search-map-routes.md:431).
   * Basis: HMRC publishes advisory fuel rates quarterly, on the 1st of March, June, September and
   * December. Status: fixed by HMRC's own schedule.
   */
  quarterlyReviewMonths: [3, 6, 9, 12],
})

export const ROAD_MILES_PER_STRAIGHT_LINE_MILE = config.roadMilesPerStraightLineMile
export const AVERAGE_SPEED_MPH = config.averageSpeedMph
export const LITRES_PER_UK_GALLON = config.litresPerUkGallon
export const QUARTERLY_REVIEW_MONTHS: readonly number[] = config.quarterlyReviewMonths
