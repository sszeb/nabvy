// Pure logic: no I/O, no database, no clock passed in implicitly (every function below takes
// `asOf`/`now` as an argument). "No invented numbers" (CLAUDE.md): every pence figure this file
// returns is either read straight off a `TravelRate` row or computed from one; a rate this module
// cannot find is a refusal (`TravelCostRefused`), never a fallback guess.
import { LITRES_PER_UK_GALLON } from '@nabvy/config/modules/travel-cost'
import {
  type TravelCostErrorCode,
  type TravelCostLeg,
  type TravelCostPreset,
  type TravelCustomRate,
  type TravelRate,
  type TravelRateKind,
  TravelSettings,
} from '@nabvy/contracts/modules/travel-cost'

/** Thrown by an exported function for bad input or a rate that cannot be found; never a database
 * error (services/account/src/domain/index.ts follows the same shape). */
export class TravelCostRefused extends Error {
  readonly code: TravelCostErrorCode
  constructor(code: TravelCostErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'TravelCostRefused'
  }
}

// ---------------------------------------------------------------------------------------------
// A user's settings: the defaults, and what a saved row must satisfy
// ---------------------------------------------------------------------------------------------

/**
 * What a user who has never changed anything gets: the `fuel-only` preset at the advisory fuel
 * rate for a 1,401–2,000cc petrol car (docs/questions/travel-cost.md, rows 7–8 of the draft's
 * §10), time counted at the default rate row, and the config calibration. Typed once, here; the
 * repo's first insert and the "no row yet" read both derive from it.
 */
export const DEFAULT_SETTINGS = {
  preset: 'fuel-only',
  fuel: 'petrol',
  engineBand: '1401-2000',
  custom: null,
  valueOfTimePenceHour: null,
  roadFactor: null,
  speedMph: null,
} as const satisfies Omit<TravelSettings, 'userId' | 'updatedAt'>

/**
 * Refuses a settings row that would make every later `tripCost`/`params` call fail: the
 * contract's own refinements (`fuel-only` needs a fuel, `custom` needs a custom rate), and a
 * custom rate so small it rounds to 0p a mile, which `TravelParams` cannot carry. Run on the
 * *merged* row before it is written, so a partial update cannot leave a user stuck.
 */
export function assertUsableSettings(settings: TravelSettings): void {
  const parsed = TravelSettings.safeParse(settings)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TravelCostRefused(
      'travel-cost.invalid_input',
      issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid travel settings',
    )
  }
  if (settings.preset === 'custom' && settings.custom) {
    assertRoundsToAPenny(pencePerMileFromCustom(settings.custom))
  }
}

function assertRoundsToAPenny(pencePerMile: number): void {
  if (Math.round(pencePerMile) < 1) {
    throw new TravelCostRefused(
      'travel-cost.invalid_input',
      `a custom rate of ${pencePerMile.toFixed(4)}p a mile rounds to 0p; it must be at least 1p a mile`,
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Resolving a rate row
// ---------------------------------------------------------------------------------------------

export interface RateMatch {
  kind: TravelRateKind
  fuel?: string | null
  engineBand?: string | null
  tier?: string | null
}

/**
 * The latest row of `kind` (matching `fuel`/`engineBand`/`tier` exactly — `''` where a kind
 * carries none) whose `effectiveFrom` is on or before `asOf`. Undefined if no such row exists yet,
 * which callers turn into `travel-cost.no_rate` rather than guess.
 */
export function resolveRate(
  rates: readonly TravelRate[],
  match: RateMatch,
  asOf: Date,
): TravelRate | undefined {
  const fuel = match.fuel ?? ''
  const engineBand = match.engineBand ?? ''
  const tier = match.tier ?? ''
  const asOfDate = asOf.toISOString().slice(0, 10)
  const applicable = rates.filter(
    (r) =>
      r.kind === match.kind &&
      r.fuel === fuel &&
      r.engineBand === engineBand &&
      r.tier === tier &&
      r.effectiveFrom <= asOfDate,
  )
  applicable.sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0,
  )
  return applicable[0]
}

// ---------------------------------------------------------------------------------------------
// Formatting a basis sentence: every figure names what it is and when it started
// ---------------------------------------------------------------------------------------------

const UK_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function formatUkDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${d} ${UK_MONTHS[(m ?? 1) - 1]} ${y}`
}

export function formatPence(pence: number): string {
  const rounded = Math.round(pence)
  return rounded < 100 ? `${rounded}p` : `£${(rounded / 100).toFixed(2)}`
}

function rateLabel(rate: TravelRate): string {
  const date = formatUkDate(rate.effectiveFrom)
  if (rate.kind === 'advisory-fuel-rate') {
    return `${rate.penceAmount}p a mile (HMRC advisory fuel rate, ${rate.fuel} ${rate.engineBand}cc, from ${date})`
  }
  if (rate.kind === 'approved-mileage-rate') {
    return `${rate.penceAmount}p a mile (HMRC approved mileage rate, from ${date})`
  }
  return `${formatPence(rate.penceAmount)} an hour (National Living Wage, from ${date})`
}

// ---------------------------------------------------------------------------------------------
// Resolving a user's settings into pence figures
// ---------------------------------------------------------------------------------------------

export interface ResolvedRatePart {
  /** Pence per mile or pence per hour, unrounded: `calculateTripCost` sums unrounded parts and
   * rounds once, so a multi-leg trip matches the worked numbers exactly (services/travel-cost's
   * README, "Rules and thresholds"). */
  pence: number
  label: string
  sourceUrl: string
}

/** `pencePerMile` from mpg and a fuel price: `fuelPricePencePerLitre × litresPerUkGallon ÷ mpg`. */
export function pencePerMileFromCustom(custom: TravelCustomRate): number {
  if (custom.mode === 'pence-per-mile') return custom.pencePerMile
  return (custom.fuelPricePencePerLitre * LITRES_PER_UK_GALLON) / custom.mpg
}

export interface MileRateSettings {
  preset: TravelCostPreset
  fuel: string | null
  engineBand: string | null
  custom: TravelCustomRate | null
}

/** The pence-per-mile part of a trip's cost, from the user's preset. Throws `no_rate` when the
 * preset names a rate no seeded row covers yet, `invalid_input` when `custom` is required and
 * missing (the contract's own refinement should already have caught this). */
export function resolveMileRate(
  settings: MileRateSettings,
  rates: readonly TravelRate[],
  asOf: Date,
): ResolvedRatePart {
  if (settings.preset === 'custom') {
    if (!settings.custom) {
      throw new TravelCostRefused(
        'travel-cost.invalid_input',
        'the custom preset needs a custom rate',
      )
    }
    const pence = pencePerMileFromCustom(settings.custom)
    return { pence, label: `${formatPence(pence)} a mile (your own rate)`, sourceUrl: '' }
  }
  const kind: TravelRateKind =
    settings.preset === 'hmrc-business' ? 'approved-mileage-rate' : 'advisory-fuel-rate'
  const match: RateMatch =
    kind === 'approved-mileage-rate'
      ? { kind, tier: 'standard' }
      : { kind, fuel: settings.fuel, engineBand: settings.engineBand }
  const rate = resolveRate(rates, match, asOf)
  if (!rate) {
    throw new TravelCostRefused(
      'travel-cost.no_rate',
      `no ${kind} rate applies on ${asOf.toISOString()}`,
    )
  }
  return { pence: rate.penceAmount, label: rateLabel(rate), sourceUrl: rate.sourceUrl }
}

/**
 * The pence-per-hour part, or `null` when time is not counted: either the user set £0
 * ("don't count my time", the card's own worked case) or the caller asked to skip it entirely
 * (`includeTime = false`, for a fuel-only figure). A user override is never checked against a
 * rate row — it is their own figure, named as such in the basis sentence.
 */
export function resolveValueOfTime(
  settings: { valueOfTimePenceHour: number | null },
  rates: readonly TravelRate[],
  asOf: Date,
  { includeTime = true }: { includeTime?: boolean } = {},
): ResolvedRatePart | null {
  if (!includeTime) return null
  if (settings.valueOfTimePenceHour != null) {
    if (settings.valueOfTimePenceHour === 0) return null
    return {
      pence: settings.valueOfTimePenceHour,
      label: `${formatPence(settings.valueOfTimePenceHour)} an hour (your own value of time)`,
      sourceUrl: '',
    }
  }
  const rate = resolveRate(rates, { kind: 'value-of-time' }, asOf)
  if (!rate) {
    throw new TravelCostRefused(
      'travel-cost.no_rate',
      `no default value-of-time rate applies on ${asOf.toISOString()}`,
    )
  }
  return { pence: rate.penceAmount, label: rateLabel(rate), sourceUrl: rate.sourceUrl }
}

// ---------------------------------------------------------------------------------------------
// tripCost(): pure arithmetic over resolved parts
// ---------------------------------------------------------------------------------------------

export interface TripCostCalculation {
  amountMinor: number
  basis: string
}

/**
 * Sums fuel and time pence *unrounded* across every leg, and rounds only the total once — rounding
 * each leg or each part separately drifts a penny off the card's worked numbers (£1.31 per extra
 * mile, £6.54 at 5 miles: services/travel-cost/README.md, "Fixtures and pass rate").
 */
export function calculateTripCost(
  legs: readonly TravelCostLeg[],
  mile: ResolvedRatePart,
  time: ResolvedRatePart | null,
): TripCostCalculation {
  const roadMiles = legs.reduce((sum, leg) => sum + leg.roadMiles, 0)
  const minutes = legs.reduce((sum, leg) => sum + leg.minutes, 0)
  const fuelPence = roadMiles * mile.pence
  const timePence = time ? (minutes / 60) * time.pence : 0
  const amountMinor = Math.round(fuelPence + timePence)
  const basis = time ? `${mile.label} plus ${time.label}` : mile.label
  return { amountMinor, basis }
}

// ---------------------------------------------------------------------------------------------
// params(): rounded figures a SQL sort can use without calling tripCost per row
// ---------------------------------------------------------------------------------------------

export interface ResolvedParams {
  pencePerMile: number
  penceHour: number | null
  roadFactor: number
  speedMph: number
}

export function resolveParams(
  settings: MileRateSettings & {
    valueOfTimePenceHour: number | null
    roadFactor: number | null
    speedMph: number | null
  },
  rates: readonly TravelRate[],
  asOf: Date,
  defaults: { roadFactor: number; speedMph: number },
): ResolvedParams {
  const mile = resolveMileRate(settings, rates, asOf)
  const time = resolveValueOfTime(settings, rates, asOf)
  // A seeded rate is an integer already; only a custom mpg rate can round to 0, and
  // `assertUsableSettings` refuses that at save time. Checked again here so `TravelParams`
  // (`pencePerMile` positive) can never be handed a 0 from a row written some other way.
  assertRoundsToAPenny(mile.pence)
  return {
    pencePerMile: Math.round(mile.pence),
    penceHour: time ? Math.round(time.pence) : null,
    roadFactor: settings.roadFactor ?? defaults.roadFactor,
    speedMph: settings.speedMph ?? defaults.speedMph,
  }
}
