import { z } from 'zod'
import { defineEvents, IsoTimestamp } from '../index'

// Contracts of the demand-signals module (services/demand-signals, docs/design/modules/
// demand-signals.md): weekly demand per search centre and catalogue family, from first-party
// wants plus wanted and swap adverts, with small counts suppressed. Import from
// '@nabvy/contracts/modules/demand-signals'. No schema here carries a user ID, a seller field or a
// per-user row: every count is an aggregate, and a count under the threshold (10) is never
// carried at all.

export const module = 'demand-signals'

/** The lowest count a cell may carry (the card's "cells under 10 suppressed"; decisions n≥10). */
const MIN_COUNT = 10

/** A week, as the ISO date of its Monday (weeks run Monday 00:00 UTC to the next Monday). */
export const DemandSignalsWeekStart = z.iso
  .date()
  .refine((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1, 'weekStart must be a Monday')
export type DemandSignalsWeekStart = z.infer<typeof DemandSignalsWeekStart>

/** A shown count: at least the threshold, or null when it was under it (suppressed). */
const ShownCount = z.int().min(MIN_COUNT).nullable()

/**
 * One row of `demand_signals.v_cells` (and of the `cells` table): a centre, a week and a catalogue
 * family, with the active wants and the wanted or swap adverts counted there. A count under 10 is
 * null; a cell whose counts are all null is `suppressed`. No user ID, no seller field.
 */
export const DemandSignalsCell = z
  .strictObject({
    weekStart: DemandSignalsWeekStart,
    centreId: z.string().min(1).max(64),
    family: z.string().min(1).max(200),
    wants: ShownCount,
    adverts: ShownCount,
    suppressed: z.boolean(),
    ruleVersion: z.string().regex(/^ds-\d+$/),
    publishedAt: IsoTimestamp,
  })
  .refine((c) => c.suppressed === (c.wants === null && c.adverts === null), {
    message: 'suppressed must be true exactly when every count is null',
  })
export type DemandSignalsCell = z.infer<typeof DemandSignalsCell>

/** Input of `publishWeek`: the closed week to publish. */
export const DemandSignalsPublishInput = z.strictObject({ weekStart: DemandSignalsWeekStart })
export type DemandSignalsPublishInput = z.infer<typeof DemandSignalsPublishInput>

// ---------------------------------------------------------------------------------------------
// Errors and events
// ---------------------------------------------------------------------------------------------

/** Error codes returned as values (rule 3 of docs/design/modules/_rules.md). */
export const DemandSignalsErrorCode = z.enum([
  'demand-signals.invalid_input', //   the week failed its schema
  'demand-signals.week_not_closed', // the week has not ended yet: only a closed week is published
])
export type DemandSignalsErrorCode = z.infer<typeof DemandSignalsErrorCode>

export const DemandSignalsError = z.strictObject({
  code: DemandSignalsErrorCode,
  message: z.string().min(1),
})
export type DemandSignalsError = z.infer<typeof DemandSignalsError>

/**
 * The payload of `demand-signals.published`: the week only (rule 7: identifiers and times, no
 * counts). The receiver reads `demand_signals.v_cells` for that week.
 */
export const DemandSignalsPublishedEvent = z.strictObject({ weekStart: DemandSignalsWeekStart })
export type DemandSignalsPublishedEvent = z.infer<typeof DemandSignalsPublishedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  /** A week's cells were written. */
  'demand-signals.published': { 1: DemandSignalsPublishedEvent },
})
