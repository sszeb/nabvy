// Pure logic: no I/O, no database, no clock passed in implicitly.
import { createHash } from 'node:crypto'
import type { MarketingConsentCategory } from '@nabvy/contracts/modules/marketing-consent'

/** Trims and lower-cases before hashing, so the same address always hashes to the same key. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** The `email_hash` primary key `email_suppressions` and `newsletter_subscribers` store. */
export function hashEmail(email: string): string {
  return createHash('sha256').update(normaliseEmail(email)).digest('hex')
}

/** The pseudo-category `pauseAll()`/`resumeAll()` write; never a real preference-centre category. */
export const PAUSE_ALL_CATEGORY: MarketingConsentCategory = 'all'

export interface ConsentRow {
  category: string
  granted: boolean
  until: Date | null
}

/**
 * Whether an `all`-pause row is active right now: present and its `until` is still in the future.
 * A pause that has lapsed (or was never taken) blocks nothing.
 */
export function isPaused(rows: readonly ConsentRow[], now: Date): boolean {
  const pause = rows.find((row) => row.category === PAUSE_ALL_CATEGORY)
  return pause != null && pause.until != null && pause.until.getTime() > now.getTime()
}

/**
 * Whether the given category is granted: no row for it means false (docs/marketing.md: "Sign-up
 * shows an unticked box"), so a category is only ever granted by an explicit `setPreference()`.
 */
export function isGranted(rows: readonly ConsentRow[], category: string): boolean {
  return rows.find((row) => row.category === category)?.granted === true
}

/**
 * The full `canMarket()` decision, pure once every input has been read (services/marketing-consent
 * README.md, "Decisions": the switch and account-standing reads happen in the exported function;
 * this is the logic on what they and the consent rows mean).
 */
export function decideCanMarket(input: {
  moduleOn: boolean
  accountActive: boolean
  suppressed: boolean
  rows: readonly ConsentRow[]
  category: string
  now: Date
}): boolean {
  if (!input.moduleOn) return false
  if (!input.accountActive) return false
  if (input.suppressed) return false
  if (isPaused(input.rows, input.now)) return false
  return isGranted(input.rows, input.category)
}
