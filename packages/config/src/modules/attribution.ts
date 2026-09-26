import { z } from 'zod'

// Thresholds of the attribution module (rule 14 of docs/design/modules/_rules.md). Dub's own
// programme rules (the 12-month commission window, tiers) live in Dub's reward configuration
// (docs/affiliates.md, "Sale") and are not duplicated here; what is here is what our own code and
// the injected in-memory partner client read.

const attributionConfig = z.object({
  clickCookieDays: z.number().int().positive(),
  commissionHoldDays: z.number().int().positive(),
  referralCreditCredits: z.number().int().positive(),
})

const config = attributionConfig.parse({
  /**
   * Dub's first-party click cookie window: a sale up to this many days after the click still
   * attributes to the partner ("last click"). Basis: docs/affiliates.md, "Attribution: Last
   * click, 90-day cookie". Status: fixed by the programme's published terms; enforced by Dub
   * itself (its own cookie), carried here so the injected client's fixtures and the `/partners`
   * page cite one number.
   */
  clickCookieDays: 90,
  /**
   * Days after the invoice before a tracked commission is payable. Basis: docs/affiliates.md,
   * "Hold and clawback: commissions become payable 30 days after the invoice". Status: fixed by
   * the programme's published terms; Dub's own payout schedule enforces it.
   */
  commissionHoldDays: 30,
  /**
   * Credits granted to each side of a peer referral pair on the referred user's first paid
   * subscription invoice ("£5 referral credit both sides", docs/design/pricing-model.md, "Fill
   * areas"). No pricing-console policy exists yet to convert cash to credits (as usage-ledger's
   * own bundle and top-up grants need one); this module grants referral credit with an explicit
   * amount, as usage-ledger's `grant()` allows for the `referral` kind. Basis: Starter's own net
   * rate in docs/design/pricing-model.md ("Watching"), £12 for 1,200 credits ≈ 1p/credit, so £5 ≈
   * 500 credits. Status: starting value, pending a pricing-console policy for referral credit
   * (docs/questions/attribution.md).
   */
  referralCreditCredits: 500,
})

export const ATTRIBUTION_CLICK_COOKIE_DAYS = config.clickCookieDays
export const ATTRIBUTION_COMMISSION_HOLD_DAYS = config.commissionHoldDays
export const ATTRIBUTION_REFERRAL_CREDIT_CREDITS = config.referralCreditCredits
