import { z } from 'zod'

// Thresholds of the usage-ledger module (rule 14 of docs/design/modules/_rules.md). No prices:
// what an action costs in credits is pricing-console's, passed in by the caller.

const usageLedgerConfig = z.object({
  lowBalanceCredits: z.number().int().positive(),
  expirySweepBatch: z.number().int().min(100).max(500),
})

const config = usageLedgerConfig.parse({
  /**
   * A charge that takes the balance from at or above this line to below it emits
   * `usage-ledger.balance-low`, the top-up suggestion (card: "balances running low trigger a
   * top-up suggestion"). Basis: the Free tier's monthly allowance of 50 credits in
   * docs/design/pricing-model.md (a placeholder there too). Status: starting value; the line may
   * later depend on the plan (docs/questions/usage-ledger.md).
   */
  lowBalanceCredits: 50,
  /**
   * Buckets expired per sweep call. Basis: CLAUDE.md, "Batches, not items" (100–500). Status:
   * fixed by the rule.
   */
  expirySweepBatch: 500,
})

export const USAGE_LEDGER_LOW_BALANCE_CREDITS = config.lowBalanceCredits
export const USAGE_LEDGER_EXPIRY_SWEEP_BATCH = config.expirySweepBatch
