import { z } from 'zod'

/** An ISO 8601 UTC timestamp with a `Z` suffix, e.g. `2026-09-24T09:21:00.000Z`. */
export const IsoTimestamp = z.iso.datetime({ offset: false })
export type IsoTimestamp = z.infer<typeof IsoTimestamp>

export function isoNow(now: Date = new Date()): IsoTimestamp {
  return now.toISOString()
}

/**
 * The hop timestamps from docs/architecture.md ("Timestamps"). Freshness shown to users is
 * T6 − T0; pipeline delay T6 − T1 must stay in seconds.
 */
export const TStampName = z.enum([
  't0Listed', //    seller posted it (exact on eBay and Facebook, rounded elsewhere)
  't1Fetched', //   first seen by an adapter
  't2Candidate', // passed the cheap gate
  't3Extracted', // facts and risk ready
  't4Valued', //    valuation ready
  't5Matched', //   hunts matched
  't6Delivered', // alert sent
  't7Opened', //    user opened it
])
export type TStampName = z.infer<typeof TStampName>

/** A set of hop stamps; each stage sets its own and leaves the others alone. */
export const TStamps = z.strictObject(
  Object.fromEntries(TStampName.options.map((name) => [name, IsoTimestamp.optional()])) as {
    [K in TStampName]: z.ZodOptional<typeof IsoTimestamp>
  },
)
export type TStamps = z.infer<typeof TStamps>

/**
 * Sets one stamp, keeping the earliest if it is already set, so a handler that runs twice
 * (idempotency) never moves a stamp later.
 */
export function stamp(stamps: TStamps, name: TStampName, at: IsoTimestamp = isoNow()): TStamps {
  const existing = stamps[name]
  if (existing !== undefined && Date.parse(existing) <= Date.parse(at)) return stamps
  return { ...stamps, [name]: at }
}

/** Whole seconds between two stamps, or undefined when either is missing. */
export function secondsBetween(
  stamps: TStamps,
  from: TStampName,
  to: TStampName,
): number | undefined {
  const a = stamps[from]
  const b = stamps[to]
  if (a === undefined || b === undefined) return undefined
  return Math.round((Date.parse(b) - Date.parse(a)) / 1000)
}
