// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.

/** Same unambiguous alphabet as account's Telegram link codes (no 0/O/1/I). */
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * An 8-character shareable referral code. `random` is `() => number in [0, 1)`; the exported
 * `captureAttribution` always calls this with a CSPRNG-backed generator (never `Math.random`,
 * which is predictable — the same reason account's `generateLinkCode` takes this seam), kept only
 * for `domain.test.ts`'s deterministic cases.
 */
export function generateReferralCode(random: () => number): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += REFERRAL_CODE_ALPHABET[Math.floor(random() * REFERRAL_CODE_ALPHABET.length)]
  }
  return code
}

/**
 * The usage-ledger `refId` for one side of a referral pair's credit, keyed by the pair (never the
 * invoice) so a replay of the same pair's crediting is always the same grant, whichever invoice
 * triggered it first.
 */
export function referralCreditRefId(side: 'referrer' | 'referred', referralId: string): string {
  return `referral:${side}:${referralId}`
}

/** A referral code may never resolve to the person who is about to sign up (docs/affiliates.md). */
export function isSelfReferral(referrerUserId: string, signingUpUserId: string): boolean {
  return referrerUserId === signingUpUserId
}
