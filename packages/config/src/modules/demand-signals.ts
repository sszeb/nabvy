import { z } from 'zod'

// Thresholds of the demand-signals module (rule 14 of docs/design/modules/_rules.md). Each value
// carries a comment with its basis and is a starting value until the module's fixtures calibrate
// it. No prices: this module counts wants and adverts, nothing else.

const demandSignalsConfig = z.object({
  suppressionThreshold: z.number().int().min(10).max(1000),
  ruleVersion: z.string().regex(/^ds-\d+$/),
})

const config = demandSignalsConfig.parse({
  /**
   * A count under this is never stored: the cell keeps null for it, and a cell whose counts are
   * all under it is `suppressed`. Basis: the card ("cells under 10 suppressed", question 20) and
   * docs/decisions.md ("Aggregates appear only at n≥10"; rule 5 of _rules.md). The schema minimum
   * is 10, and the table's checks refuse a stored count under 10, so raising it is safe and
   * lowering it is not possible here. Status: fixed by the rule.
   */
  suppressionThreshold: 10,
  /**
   * The version of the counting rules, stored on every cell and carried in the event key, so a
   * rule change publishes a new version of a week instead of rewriting the old one. Status: v1.
   */
  ruleVersion: 'ds-1',
})

export const DEMAND_SIGNALS_SUPPRESSION_THRESHOLD = config.suppressionThreshold
export const DEMAND_SIGNALS_RULE_VERSION = config.ruleVersion
