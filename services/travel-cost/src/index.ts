// Public API of the travel-cost module: what a trip costs a user. Other modules import from
// '@nabvy/travel-cost' only, never from its internals.
import {
  AVERAGE_SPEED_MPH,
  ROAD_MILES_PER_STRAIGHT_LINE_MILE,
} from '@nabvy/config/modules/travel-cost'
import { createEvent, type EventEnvelope, money, Uuid } from '@nabvy/contracts'
import {
  events,
  type TravelCostInput,
  TravelCustomRate,
  type TravelParams,
  type TravelRate,
  type TravelSettings,
  type TravelUpdateSettingsInput,
  type TripCostResult,
} from '@nabvy/contracts/modules/travel-cost'
import type { Queryable } from '@nabvy/db'
import { isOn } from '@nabvy/switches'
import {
  assertUsableSettings,
  calculateTripCost,
  DEFAULT_SETTINGS,
  resolveMileRate,
  resolveParams,
  resolveValueOfTime,
  TravelCostRefused,
} from './domain'
import type { RateRow, SettingsRow } from './repo'
import * as repo from './repo'

export { events, module } from '@nabvy/contracts/modules/travel-cost'
export { TravelCostRefused } from './domain'

async function assertModuleOn(q: Queryable): Promise<void> {
  if (!(await isOn(q, 'travel-cost'))) {
    throw new TravelCostRefused('travel-cost.module_off', 'the travel-cost module is off')
  }
}

function toTravelRate(row: RateRow): TravelRate {
  return {
    kind: row.kind as TravelRate['kind'],
    fuel: row.fuel as TravelRate['fuel'],
    engineBand: row.engineBand as TravelRate['engineBand'],
    tier: row.tier as TravelRate['tier'],
    penceAmount: row.penceAmount,
    unit: row.unit as TravelRate['unit'],
    effectiveFrom: row.effectiveFrom,
    sourceUrl: row.sourceUrl,
  }
}

/** Never written to the database until a user changes something: a settings row this module has
 * never seen reads as the domain's `DEFAULT_SETTINGS`. */
const UNSET_UPDATED_AT = new Date(0).toISOString()

function toTravelSettings(userId: string, row: SettingsRow | undefined): TravelSettings {
  if (!row) {
    return { userId, ...DEFAULT_SETTINGS, updatedAt: UNSET_UPDATED_AT }
  }
  return {
    userId: row.userId,
    preset: row.preset as TravelSettings['preset'],
    fuel: (row.fuel as TravelSettings['fuel']) ?? null,
    engineBand: (row.engineBand as TravelSettings['engineBand']) ?? null,
    custom: row.custom ? TravelCustomRate.parse(row.custom) : null,
    valueOfTimePenceHour: row.valueOfTimePenceHour ?? null,
    roadFactor: row.roadFactor ?? null,
    speedMph: row.speedMph ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The public rate table (card: "user-facing app.v_travel_rates"). No `app.*` view exists yet —
 * no module has created the `app` schema (services/account/README.md, "Decisions"); this is the
 * function a future oRPC procedure calls in the meantime (rule 12). */
export async function listRates(q: Queryable): Promise<TravelRate[]> {
  await assertModuleOn(q)
  const rows = await repo.selectAllRates(q)
  return rows.map(toTravelRate)
}

export async function getSettings(q: Queryable, userId: string): Promise<TravelSettings> {
  const row = await repo.selectSettings(q, Uuid.parse(userId))
  return toTravelSettings(userId, row)
}

function settingsChangedEvent(userId: string, at: Date): EventEnvelope {
  return createEvent(
    events,
    'travel-settings.changed',
    1,
    { userId, at: at.toISOString() },
    { key: `user:${userId}@${at.toISOString()}` },
  ) as EventEnvelope
}

/** The keys of `patch` the caller actually sent (`undefined` means "leave as is"). */
function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

export async function updateSettings(
  q: Queryable,
  input: TravelUpdateSettingsInput,
): Promise<{ settings: TravelSettings; event: EventEnvelope }> {
  await assertModuleOn(q)
  const now = new Date()
  const { userId, ...patch } = input
  // Validate the row as it will be after the merge, not the patch alone: `{ preset: 'custom' }`
  // with no custom rate saved, or `{ fuel: null }` on the fuel-only preset, would otherwise make
  // every later tripCost()/params() call fail (assertUsableSettings, domain).
  const current = toTravelSettings(userId, await repo.selectSettings(q, userId))
  assertUsableSettings({ ...current, ...definedOnly(patch) })
  const row = await repo.upsertSettings(q, input.userId, {
    ...(input.preset !== undefined ? { preset: input.preset } : {}),
    ...(input.fuel !== undefined ? { fuel: input.fuel } : {}),
    ...(input.engineBand !== undefined ? { engineBand: input.engineBand } : {}),
    ...(input.custom !== undefined ? { custom: input.custom } : {}),
    ...(input.valueOfTimePenceHour !== undefined
      ? { valueOfTimePenceHour: input.valueOfTimePenceHour }
      : {}),
    ...(input.roadFactor !== undefined ? { roadFactor: input.roadFactor } : {}),
    ...(input.speedMph !== undefined ? { speedMph: input.speedMph } : {}),
  })
  return {
    settings: toTravelSettings(input.userId, row),
    event: settingsChangedEvent(input.userId, now),
  }
}

/**
 * Pence and the sentence naming every rate used (its date and, for an HMRC rate, its source),
 * for the given legs (already resolved road miles and minutes — `travel-time` or the route
 * planner measures a trip, this module only prices one). GBP only: Nabvy prices UK asks in GBP
 * (packages/contracts/src/core/money.ts).
 */
export async function tripCost(
  q: Queryable,
  input: TravelCostInput,
  now: Date = new Date(),
): Promise<TripCostResult> {
  await assertModuleOn(q)
  const [row, rates] = await Promise.all([
    repo.selectSettings(q, input.userId),
    repo.selectAllRates(q),
  ])
  const settings = toTravelSettings(input.userId, row)
  const rateRows = rates.map(toTravelRate)
  const mile = resolveMileRate(settings, rateRows, now)
  const time = resolveValueOfTime(settings, rateRows, now)
  const { amountMinor, basis } = calculateTripCost(input.legs, mile, time)
  return { amount: money(amountMinor, 'GBP'), basis }
}

/** Rounded cost parameters for a SQL "Lowest price + trip" sort that cannot call `tripCost` per
 * row (docs/design/drafts/search-map-routes.md §7.4). */
export async function params(
  q: Queryable,
  userId: string,
  now: Date = new Date(),
): Promise<TravelParams> {
  await assertModuleOn(q)
  const [row, rates] = await Promise.all([repo.selectSettings(q, userId), repo.selectAllRates(q)])
  const settings = toTravelSettings(userId, row)
  const rateRows = rates.map(toTravelRate)
  const resolved = resolveParams(settings, rateRows, now, {
    roadFactor: ROAD_MILES_PER_STRAIGHT_LINE_MILE,
    speedMph: AVERAGE_SPEED_MPH,
  })
  return { userId, ...resolved, asOf: now.toISOString() }
}
