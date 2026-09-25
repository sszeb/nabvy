import { createHash } from 'node:crypto'

/** SHA-256 hex digest, UTF-8. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** `advert_fp` (docs/design/drafts/copy-advert.md 4.3): only for a fixed price above zero. */
export function advertFingerprint(titleNorm: string, priceMinor: number, currency: string): string {
  return sha256Hex(`${titleNorm}|${priceMinor}|${currency}`)
}

/** `desc_fp` (4.3): only for a `full_verified` description, at any length. */
export function descFingerprint(descNorm: string): string {
  return sha256Hex(descNorm)
}

/** Whether a print is eligible for a price fingerprint: fixed money kind, a price above zero. */
export function hasPriceFingerprint(input: {
  moneyKind: string | null
  priceMinor: number | null
  currency: string | null
}): boolean {
  return (
    input.moneyKind === 'fixed' &&
    input.priceMinor !== null &&
    input.priceMinor > 0 &&
    input.currency !== null
  )
}
