// Pure logic of the listing-feedback module: event keys only. No I/O.

/**
 * The `listing-feedback.recorded` event key: the verdict row's ID and its current verdict value
 * (rule 8 of docs/design/modules/_rules.md: natural ID plus its version). A repeated call with
 * the same verdict republishes the same key, which the transport drops; a changed verdict
 * publishes a new one.
 */
export const recordedKey = (verdictId: string, verdict: string): string =>
  `listing-feedback.recorded:${verdictId}@${verdict}`
