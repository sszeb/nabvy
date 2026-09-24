// Database access to the travel_cost schema only. Other modules read dated rates through
// travel_cost.v_rates, or call this module's exported listRates()/params()/tripCost() directly
// (packages/db/README.md; rule 12 of docs/design/modules/_rules.md); this file is for
// services/travel-cost's own use.
import type { Queryable } from '@nabvy/db'
import { travelRates, userTravelSettings } from '@nabvy/db/schema/travel-cost'
import { eq } from 'drizzle-orm'

export type RateRow = typeof travelRates.$inferSelect
export type SettingsRow = typeof userTravelSettings.$inferSelect

/** Every rate row. The table holds at most a few dozen rows (one per rate, per quarter), so
 * callers filter in memory (services/travel-cost/src/domain/index.ts, `resolveRate`) rather than
 * this repo taking on the date-and-band matching logic. */
export async function selectAllRates(q: Queryable): Promise<RateRow[]> {
  return q.select().from(travelRates)
}

export async function selectSettings(
  q: Queryable,
  userId: string,
): Promise<SettingsRow | undefined> {
  const [row] = await q
    .select()
    .from(userTravelSettings)
    .where(eq(userTravelSettings.userId, userId))
  return row
}

export interface SettingsPatch {
  preset?: string
  fuel?: string | null
  engineBand?: string | null
  custom?: unknown
  valueOfTimePenceHour?: number | null
  roadFactor?: number | null
  speedMph?: number | null
}

/** The defaults a first-time user gets: `resolveMileRate`/`resolveValueOfTime` in
 * services/travel-cost/src/domain/index.ts read the rest as "use the current rate row". */
const DEFAULT_SETTINGS: SettingsPatch = {
  preset: 'fuel-only',
  fuel: 'petrol',
  engineBand: '1401-2000',
}

export async function upsertSettings(
  q: Queryable,
  userId: string,
  patch: SettingsPatch,
): Promise<SettingsRow> {
  const [row] = await q
    .insert(userTravelSettings)
    .values({ userId, ...DEFAULT_SETTINGS, ...patch })
    .onConflictDoUpdate({
      target: userTravelSettings.userId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning()
  if (!row) throw new Error(`travel settings for ${userId} were not written`)
  return row
}
