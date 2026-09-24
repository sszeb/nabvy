import { z } from 'zod'

// Thresholds of the account module (rule 14 of docs/design/modules/_rules.md).

const accountConfig = z.object({
  telegramLinkCodeTtlMs: z.number().int().positive(),
  telegramRelinkWindowMs: z.number().int().positive(),
  telegramRelinkCapByPlan: z.record(z.string(), z.number().int().min(0)),
  deletionPurgeDelayMs: z.number().int().positive(),
})

const config = accountConfig.parse({
  /**
   * A Telegram link code is single-use and expires this long after it is issued. Basis: the
   * module card ("single-use 10-minute link codes"). Status: fixed by the card, not a starting
   * value to calibrate.
   */
  telegramLinkCodeTtlMs: 10 * 60 * 1000,
  /** The rolling window `services/account` counts re-links in against the cap below. Status:
   * starting value (30 days), pending a fixture that finds abuse at a different window. */
  telegramRelinkWindowMs: 30 * 24 * 60 * 60 * 1000,
  /**
   * Re-links allowed per plan inside the window above (card: "re-links capped per plan"). The
   * `subscriptions` module has not shipped its plan names yet (backlog 4.3), so this uses the
   * plan names `docs/billing.md` proposes and a conservative starting cap for each; recorded as
   * a question for the owner (docs/questions.md) rather than guessed. `default` covers any plan
   * name this map does not list, including an account with no active plan.
   */
  telegramRelinkCapByPlan: {
    default: 1,
    free: 1,
    standard: 3,
    business: 10,
  },
  /** Deletion purge deadline: 24 hours (docs/security.md:11, CLAUDE.md "No personal data"). */
  deletionPurgeDelayMs: 24 * 60 * 60 * 1000,
})

export const TELEGRAM_LINK_CODE_TTL_MS = config.telegramLinkCodeTtlMs
export const TELEGRAM_RELINK_WINDOW_MS = config.telegramRelinkWindowMs
export const TELEGRAM_RELINK_CAP_BY_PLAN: Readonly<Record<string, number>> =
  config.telegramRelinkCapByPlan
export const DELETION_PURGE_DELAY_MS = config.deletionPurgeDelayMs
