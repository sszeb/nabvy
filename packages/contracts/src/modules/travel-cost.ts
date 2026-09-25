import { z } from 'zod'
import { defineEvents, IsoTimestamp, Money, Uuid } from '../index'

// Contracts of the travel-cost module (services/travel-cost): what a trip costs a user. Import
// from '@nabvy/contracts/modules/travel-cost'.
//
// "No invented numbers" (CLAUDE.md): every pence figure traces to a dated `TravelRate` row
// (packages/db/src/schema/travel-cost.ts), seeded with a `sourceUrl`, never a literal in domain
// code. `packages/config/src/modules/travel-cost.ts` carries only the non-monetary calibration
// constants the §4.2 formula needs (road-distance factor, average speed).

export const module = 'travel-cost'

// ---------------------------------------------------------------------------------------------
// Rates: dated, sourced rows (docs/design/drafts/search-map-routes.md §4.2, §7.4)
// ---------------------------------------------------------------------------------------------

/**
 * `advisory-fuel-rate`: HMRC's advisory fuel rate, fuel cost only, by fuel and engine band.
 * `approved-mileage-rate`: HMRC's approved mileage allowance rate (the "HMRC business rate"
 * preset), tiered by annual business miles.
 * `value-of-time`: the default hourly value of time (the National Living Wage), pence an hour.
 */
export const TravelRateKind = z.enum([
  'advisory-fuel-rate',
  'approved-mileage-rate',
  'value-of-time',
])
export type TravelRateKind = z.infer<typeof TravelRateKind>

export const TravelFuelType = z.enum(['petrol', 'diesel', 'lpg', 'electric'])
export type TravelFuelType = z.infer<typeof TravelFuelType>

/**
 * The engine-size bands GOV.UK's advisory-fuel-rates table publishes: `1400-or-less`, `1401-2000`
 * and `over-2000` for petrol and LPG; `1600-or-less`, `1601-2000` and `over-2000` for diesel. A
 * closed set (mirrored by a DB CHECK) so a typo can never silently match no rate row.
 */
export const TravelEngineBand = z.enum([
  '1400-or-less',
  '1401-2000',
  '1600-or-less',
  '1601-2000',
  'over-2000',
])
export type TravelEngineBand = z.infer<typeof TravelEngineBand>

/** Only `approved-mileage-rate` is tiered: `standard` for the first 10,000 business miles in the
 * tax year, `reduced` after. Empty string for a rate kind the tier does not apply to. */
export const TravelRateTier = z.enum(['', 'standard', 'reduced'])
export type TravelRateTier = z.infer<typeof TravelRateTier>

export const TravelRateUnit = z.enum(['mile', 'hour'])
export type TravelRateUnit = z.infer<typeof TravelRateUnit>

/** A calendar date, `YYYY-MM-DD`, matching the Postgres `date` column (packages/db/README.md). */
export const TravelIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export type TravelIsoDate = z.infer<typeof TravelIsoDate>

/**
 * One dated, sourced rate row: `travel_cost.travel_rates` (services/travel-cost/README.md).
 * `fuel` and `engineBand` apply to `advisory-fuel-rate` only; empty string otherwise.
 */
export const TravelRate = z.strictObject({
  kind: TravelRateKind,
  fuel: TravelFuelType.or(z.literal('')),
  engineBand: TravelEngineBand.or(z.literal('')),
  tier: TravelRateTier,
  penceAmount: z.number().int().positive(),
  unit: TravelRateUnit,
  effectiveFrom: TravelIsoDate,
  sourceUrl: z.url().max(500),
})
export type TravelRate = z.infer<typeof TravelRate>

// ---------------------------------------------------------------------------------------------
// User travel settings
// ---------------------------------------------------------------------------------------------

export const TravelCostPreset = z.enum(['fuel-only', 'hmrc-business', 'custom'])
export type TravelCostPreset = z.infer<typeof TravelCostPreset>

/** A custom per-mile rate, entered directly or worked out from fuel economy and price. */
export const TravelCustomRate = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('pence-per-mile'), pencePerMile: z.number().int().positive() }),
  z.strictObject({
    mode: z.literal('mpg'),
    mpg: z.number().positive(),
    fuelPricePencePerLitre: z.number().positive(),
  }),
])
export type TravelCustomRate = z.infer<typeof TravelCustomRate>

/**
 * One user's trip-cost preset and preferences (`user_travel_settings`, RLS). `valueOfTimePenceHour`
 * null means "use the current default rate row"; `0` means "don't count my time" (the card's own
 * worked case). `roadFactor` and `speedMph` null mean "use the config default"
 * (packages/config/src/modules/travel-cost.ts).
 */
export const TravelSettings = z
  .strictObject({
    userId: Uuid,
    preset: TravelCostPreset,
    fuel: TravelFuelType.nullable(),
    engineBand: TravelEngineBand.nullable(),
    custom: TravelCustomRate.nullable(),
    valueOfTimePenceHour: z.number().int().nonnegative().nullable(),
    roadFactor: z.number().positive().nullable(),
    speedMph: z.number().positive().nullable(),
    updatedAt: IsoTimestamp,
  })
  .refine((s) => s.preset !== 'fuel-only' || s.fuel != null, {
    message: 'fuel is required for the fuel-only preset',
    path: ['fuel'],
  })
  .refine((s) => s.preset !== 'custom' || s.custom != null, {
    message: 'custom is required for the custom preset',
    path: ['custom'],
  })
export type TravelSettings = z.infer<typeof TravelSettings>

/** What `travel.updateSettings` takes: every field but `userId` optional, at least one set. */
export const TravelUpdateSettingsInput = z
  .strictObject({
    userId: Uuid,
    preset: TravelCostPreset.optional(),
    fuel: TravelFuelType.nullable().optional(),
    engineBand: TravelEngineBand.nullable().optional(),
    custom: TravelCustomRate.nullable().optional(),
    valueOfTimePenceHour: z.number().int().nonnegative().nullable().optional(),
    roadFactor: z.number().positive().nullable().optional(),
    speedMph: z.number().positive().nullable().optional(),
  })
  .refine(
    (input) =>
      input.preset !== undefined ||
      input.fuel !== undefined ||
      input.engineBand !== undefined ||
      input.custom !== undefined ||
      input.valueOfTimePenceHour !== undefined ||
      input.roadFactor !== undefined ||
      input.speedMph !== undefined,
    { message: 'nothing to update' },
  )
export type TravelUpdateSettingsInput = z.infer<typeof TravelUpdateSettingsInput>

// ---------------------------------------------------------------------------------------------
// tripCost() and params()
// ---------------------------------------------------------------------------------------------

/** One leg of a trip: road miles and minutes already resolved (by `travel-time` or the route
 * planner) — `tripCost` prices a trip, it never measures one. */
export const TravelCostLeg = z.strictObject({
  roadMiles: z.number().positive().max(1000),
  minutes: z.number().nonnegative().max(1440),
})
export type TravelCostLeg = z.infer<typeof TravelCostLeg>

/** At most 12 legs: the route planner's own stop cap (search-map-routes.md §6.2). */
export const TravelCostInput = z.strictObject({
  userId: Uuid,
  legs: z.array(TravelCostLeg).min(1).max(12),
})
export type TravelCostInput = z.infer<typeof TravelCostInput>

/** Pence and the sentence naming every rate used and its source, so no figure is unexplained. */
export const TripCostResult = z.strictObject({
  amount: Money,
  basis: z.string().max(1000),
})
export type TripCostResult = z.infer<typeof TripCostResult>

/**
 * A user's resolved cost parameters, for a SQL "Lowest price + trip" sort that cannot call
 * `tripCost` per row (search-map-routes.md §7.4). `penceHour` is null only when the user has set
 * £0 ("don't count my time"); `pencePerMile` never is — `tripCost`/`params` refuse
 * (`travel-cost.no_rate`) rather than sort on an invented figure.
 */
export const TravelParams = z.strictObject({
  userId: Uuid,
  pencePerMile: z.number().int().positive(),
  penceHour: z.number().int().nonnegative().nullable(),
  roadFactor: z.number().positive(),
  speedMph: z.number().positive(),
  asOf: IsoTimestamp,
})
export type TravelParams = z.infer<typeof TravelParams>

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export const TravelSettingsChangedEvent = z.strictObject({ userId: Uuid, at: IsoTimestamp })
export type TravelSettingsChangedEvent = z.infer<typeof TravelSettingsChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'travel-settings.changed': { 1: TravelSettingsChangedEvent },
})

// ---------------------------------------------------------------------------------------------
// Errors: `travel-cost.<code>`
// ---------------------------------------------------------------------------------------------

export const TravelCostErrorCode = z.enum([
  'travel-cost.module_off',
  'travel-cost.no_rate',
  'travel-cost.invalid_input',
])
export type TravelCostErrorCode = z.infer<typeof TravelCostErrorCode>
