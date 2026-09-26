import { z } from 'zod'

// Thresholds of the search-planner module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. The budget and the per-pair cost are the owner's
// numbers (docs/decisions.md, "Beta coverage and Apify budget"); the container terms are the
// card's words (docs/design/modules/search-planner.md). None is invented here.

const searchPlannerConfig = z.object({
  monthlyBudgetUsdCents: z.int().positive(),
  pairMonthlyCostUsdCents: z.int().positive(),
  containerTerms: z.array(z.string().min(1)).min(1),
  eventBatchSize: z.int().min(1).max(500),
})

const config = searchPlannerConfig.parse({
  /**
   * The Apify spend ceiling a month, in US cents. Basis: the owner's "$150 a month"
   * (docs/decisions.md, "Budget"). Status: fixed by the decision.
   */
  monthlyBudgetUsdCents: 15_000,
  /**
   * What one (centre, term) pair costs a month, in US cents. Basis: the owner's estimate "about
   * $3.20 a month per term per centre" for a newest-first check every 30 minutes
   * (docs/decisions.md, "Cadence within the budget"). Status: starting value; the owner's text
   * says it is refined once measured spend is in (docs/questions/search-planner.md).
   */
  pairMonthlyCostUsdCents: 320,
  /**
   * The broad container terms every want adds beside its family term. Basis: the card, "its
   * family term plus the broad container terms 'gaming pc' and 'pc'"
   * (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:62). Status: fixed by the card.
   */
  containerTerms: ['gaming pc', 'pc'],
  /** Centre IDs per `plan-changed` event. Basis: rule 7 (at most 500 IDs). Status: fixed. */
  eventBatchSize: 500,
})

export const SEARCH_PLANNER_MONTHLY_BUDGET_USD_CENTS = config.monthlyBudgetUsdCents
export const SEARCH_PLANNER_PAIR_MONTHLY_COST_USD_CENTS = config.pairMonthlyCostUsdCents
/** The budget bound on runnable pairs: floor($150 / $3.20) = 46. Derived, never set by hand. */
export const SEARCH_PLANNER_MAX_ACTIVE_PAIRS = Math.floor(
  config.monthlyBudgetUsdCents / config.pairMonthlyCostUsdCents,
)
export const SEARCH_PLANNER_CONTAINER_TERMS: readonly string[] = config.containerTerms
export const SEARCH_PLANNER_EVENT_BATCH_SIZE = config.eventBatchSize
