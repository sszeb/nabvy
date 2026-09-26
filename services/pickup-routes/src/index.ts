// Public API of the pickup-routes module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/pickup-routes' only, never from its internals. The user's pickups,
// days, plans and defaults are read and written only here, inside withUser as nabvy_app, and
// their addresses, notes and points are sealed with PICKUPS_DATA_KEY on the way in and opened on
// the way out (README.md). Nothing here contacts a seller, a marketplace or a map provider: the
// road matrix comes from router-gateway's function when injected and on, else a labelled
// estimate; the £ figure from travel-cost's function when injected, else none.
import { isActive } from '@nabvy/account'
import { loadEnv } from '@nabvy/config'
import {
  PICKUP_ROUTES_DAY_START_DEFAULT,
  PICKUP_ROUTES_ESTIMATE_FACTOR,
  PICKUP_ROUTES_ESTIMATE_SPEED_KMH,
  PICKUP_ROUTES_LATEST_FINISH_DEFAULT,
  PICKUP_ROUTES_MAX_STOPS,
  PICKUP_ROUTES_RETENTION_DAYS,
  PICKUP_ROUTES_SERVICE_MINUTES_DEFAULT,
} from '@nabvy/config/modules/pickup-routes'
import { createEvent, type EventEnvelope, err, ok, type Result } from '@nabvy/contracts'
import {
  events,
  PickupRoutesDayInput,
  PickupRoutesDefaults,
  PickupRoutesDefaultsInput,
  PickupRoutesDeleteInput,
  type PickupRoutesError,
  PickupRoutesListForDayInput,
  type PickupRoutesNavigationLinks,
  PickupRoutesPickup,
  PickupRoutesPickupInput,
  PickupRoutesPlan,
  PickupRoutesPlanInput,
  type PickupRoutesPlannedStop,
  type PickupRoutesPoint,
  type PickupRoutesReminderKind,
  PickupRoutesReplanInput,
  PickupRoutesSetStatusInput,
  type PickupRoutesStatus,
  type PickupRoutesUnassigned,
  PickupRoutesUpdateInput,
  type PickupRoutesWindow,
} from '@nabvy/contracts/modules/pickup-routes'
import type { Queryable } from '@nabvy/db'
import { pointForPostcode } from '@nabvy/location'
import { state } from '@nabvy/switches'
import {
  changedKey,
  epochToLondonDay,
  estimateMatrix,
  type IcsStop,
  icsDocument,
  londonToEpoch,
  navigationLinks,
  open,
  type PickupPlain,
  parseDataKey,
  plannedKey,
  proposedSlot,
  reminderDueKey,
  reminderSchedule,
  reminderText as reminderWords,
  SealError,
  type SolverInput,
  type SolverStop,
  schedule,
  seal,
  shiftDay,
  solve,
  toIso,
  windowBounds,
} from './domain'
import * as repo from './repo'

export { events, module } from '@nabvy/contracts/modules/pickup-routes'
export { navigationLinks, SealError } from './domain'
export { onAccountDeleted } from './handlers'

/**
 * router-gateway's `table()` (docs/design/modules/router-gateway.md), the soft dependency: one
 * OSRM table call over bare coordinates, no labels or IDs. `undefined` when the gateway is off or
 * the VM is down, and the plan falls back to an estimate. Not merged yet: the default is the
 * stub below (docs/questions/pickup-routes.md).
 */
export interface RouterGatewayPort {
  table(
    points: readonly PickupRoutesPoint[],
  ): Promise<{ durations: number[][]; distances: number[][]; osmBuild: string | null } | undefined>
}

/**
 * travel-cost's `tripCost()` (docs/design/modules/travel-cost.md), the other soft dependency:
 * pence and a basis sentence for the day's legs, or `undefined` when off (no £ shown). Not merged
 * yet (PR #50): the default is the stub below.
 */
export interface TravelCostPort {
  tripCost(
    q: Queryable,
    userId: string,
    legs: readonly { roadMiles: number; minutes: number }[],
  ): Promise<{ pence: number; basis: string } | undefined>
}

/** The documented stubs: no route matrix, no cost (the conservative default). */
export const noRouter: RouterGatewayPort = { table: async () => undefined }
export const noTravelCost: TravelCostPort = { tripCost: async () => undefined }

export interface PickupRoutesDeps {
  /** PICKUPS_DATA_KEY. Default: `loadEnv(['pickupsData'])` at call time; tests pass a fixed key. */
  dataKey?: string
  /** Default: `location.pointForPostcode()`; never postcodes.io directly (§5.3). */
  geocode?: (q: Queryable, postcode: string) => Promise<PickupRoutesPoint | undefined>
  router?: RouterGatewayPort
  travelCost?: TravelCostPort
  /** Server time for stamps and the retention cut-off; never taken from a form. */
  now?: Date
}

type Outcome<T> = Result<T, PickupRoutesError>

interface PickupPrivate {
  postcode: string
  addressText: string | null
  notes: string | null
  point: PickupRoutesPoint | null
  pin: PickupRoutesPoint | null
}
interface DayPrivate {
  startPoint: PickupRoutesPoint | null
  endPoint: PickupRoutesPoint | null
}
interface DefaultsPrivate {
  homePostcode: string | null
  homePoint: PickupRoutesPoint | null
  homePin: PickupRoutesPoint | null
}

const invalid = (message: string): PickupRoutesError => ({
  code: 'pickup-routes.invalid_input',
  message,
})

function keyOf(deps: PickupRoutesDeps): Outcome<Buffer> {
  try {
    const raw = deps.dataKey ?? loadEnv(['pickupsData']).PICKUPS_DATA_KEY
    return ok(parseDataKey(raw))
  } catch (cause) {
    return err({
      code: 'pickup-routes.key_missing',
      message: cause instanceof SealError ? cause.message : 'PICKUPS_DATA_KEY is not configured',
    })
  }
}

async function gate(q: Queryable, userId: string): Promise<PickupRoutesError | undefined> {
  if ((await state(q, 'pickup-routes')) === 'off') {
    return { code: 'pickup-routes.off', message: 'Pickups are unavailable.' }
  }
  if (!(await isActive(q, userId))) {
    return {
      code: 'pickup-routes.account_restricted',
      message: 'The account may not use pickups right now.',
    }
  }
  return undefined
}

async function geocode(
  q: Queryable,
  deps: PickupRoutesDeps,
  postcode: string,
): Promise<PickupRoutesPoint | undefined> {
  const resolve = deps.geocode ?? pointForPostcode
  try {
    return await resolve(q, postcode)
  } catch {
    return undefined // an unreachable provider: saved without a point, planning unavailable (§5.3)
  }
}

const windowOf = (row: {
  windowKind: string
  windowStart: string | null
  windowEnd: string | null
}): PickupRoutesWindow =>
  ({
    kind: row.windowKind,
    ...(row.windowStart ? { start: row.windowStart } : {}),
    ...(row.windowEnd ? { end: row.windowEnd } : {}),
  }) as PickupRoutesWindow

const plainOf = (row: repo.PickupRow | repo.PickupPlainRow): PickupPlain => ({
  id: row.id,
  label: row.label,
  day: row.day,
  window: windowOf(row),
  status: row.status as PickupRoutesStatus,
})

function toPickup(row: repo.PickupRow, key: Buffer): PickupRoutesPickup {
  const p = open(key, row.privateEnc) as PickupPrivate
  return PickupRoutesPickup.parse({
    id: row.id,
    userId: row.userId,
    label: row.label,
    postcode: p.postcode,
    addressText: p.addressText,
    point: p.pin ?? p.point,
    pinned: p.pin !== null,
    stopType: row.stopType,
    day: row.day,
    window: windowOf(row),
    serviceMinutes: row.serviceMinutes,
    priceMinor: row.priceMinor,
    bringCash: row.bringCash,
    size: row.size,
    mustGet: row.mustGet,
    notes: p.notes,
    status: row.status,
    listingId: row.listingId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

function changedEvent(
  row: repo.PickupRow,
  change: 'created' | 'updated' | 'status' | 'deleted',
  now: Date,
): EventEnvelope {
  return createEvent(
    events,
    'pickup-routes.changed',
    1,
    { pickupId: row.id, userId: row.userId, change },
    {
      key: changedKey(
        row.id,
        change === 'deleted' ? now.toISOString() : row.updatedAt.toISOString(),
        change,
      ),
    },
  ) as EventEnvelope
}

/** Re-derives a pickup's reminders from its row and the day's current plan (§5.4). */
async function rescheduleReminders(
  q: Queryable,
  userId: string,
  pickup: PickupPlain,
): Promise<void> {
  const day = await repo.selectDay(q, userId, pickup.day)
  const plan = day ? await repo.selectCurrentPlan(q, userId, day.id) : undefined
  const planned = (plan?.stops as PickupRoutesPlannedStop[] | undefined)?.find(
    (s) => s.pickupId === pickup.id,
  )
  const wanted = reminderSchedule(
    pickup,
    planned ? Math.floor(Date.parse(planned.leaveAt) / 1000) : null,
  )
  await repo.replaceReminders(
    q,
    userId,
    pickup.id,
    wanted.map((w) => ({ kind: w.kind, dueAt: new Date(w.dueAt * 1000) })),
  )
}

/** Records an arranged pickup (§5.1, §5.2). The postcode is geocoded in-house; the private fields are sealed. */
export async function createPickup(
  q: Queryable,
  rawInput: PickupRoutesPickupInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<{ pickup: PickupRoutesPickup; event: EventEnvelope }>> {
  const parsed = PickupRoutesPickupInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  const now = deps.now ?? new Date()
  const point = (await geocode(q, deps, input.postcode)) ?? null
  const priv: PickupPrivate = {
    postcode: input.postcode,
    addressText: input.addressText,
    notes: input.notes,
    point,
    pin: input.pin,
  }
  const row = await repo.insertPickup(q, {
    userId: input.userId,
    label: input.label,
    privateEnc: seal(key.value, priv),
    hasPoint: point !== null || input.pin !== null,
    stopType: input.stopType,
    day: input.day,
    windowKind: input.window.kind,
    windowStart: input.window.start ?? null,
    windowEnd: input.window.end ?? null,
    serviceMinutes: input.serviceMinutes,
    priceMinor: input.priceMinor,
    bringCash: input.bringCash,
    size: input.size,
    mustGet: input.mustGet,
    status: input.status,
    listingId: input.listingId,
  })
  await rescheduleReminders(q, input.userId, plainOf(row))
  return ok({ pickup: toPickup(row, key.value), event: changedEvent(row, 'created', now) })
}

/** Edits a pickup. A changed postcode is geocoded again; a cleared pin falls back to it. */
export async function updatePickup(
  q: Queryable,
  rawInput: PickupRoutesUpdateInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<{ pickup: PickupRoutesPickup; event: EventEnvelope }>> {
  const parsed = PickupRoutesUpdateInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  const now = deps.now ?? new Date()
  const existing = await repo.selectPickup(q, input.userId, input.pickupId)
  if (!existing) return err({ code: 'pickup-routes.not_found', message: 'No such pickup.' })
  const priv = open(key.value, existing.privateEnc) as PickupPrivate
  if (input.postcode !== undefined && input.postcode !== priv.postcode) {
    priv.postcode = input.postcode
    priv.point = (await geocode(q, deps, input.postcode)) ?? null
  }
  if (input.addressText !== undefined) priv.addressText = input.addressText
  if (input.notes !== undefined) priv.notes = input.notes
  if (input.pin !== undefined) priv.pin = input.pin
  const patch: Partial<repo.PickupInsert> = {
    privateEnc: seal(key.value, priv),
    hasPoint: priv.point !== null || priv.pin !== null,
  }
  if (input.label !== undefined) patch.label = input.label
  if (input.stopType !== undefined) patch.stopType = input.stopType
  if (input.day !== undefined) patch.day = input.day
  if (input.window !== undefined) {
    patch.windowKind = input.window.kind
    patch.windowStart = input.window.start ?? null
    patch.windowEnd = input.window.end ?? null
  }
  if (input.serviceMinutes !== undefined) patch.serviceMinutes = input.serviceMinutes
  if (input.priceMinor !== undefined) patch.priceMinor = input.priceMinor
  if (input.bringCash !== undefined) patch.bringCash = input.bringCash
  if (input.size !== undefined) patch.size = input.size
  if (input.mustGet !== undefined) patch.mustGet = input.mustGet
  if (input.status !== undefined) patch.status = input.status
  if (input.listingId !== undefined) patch.listingId = input.listingId
  const row = await repo.updatePickup(q, input.userId, input.pickupId, patch)
  if (!row) return err({ code: 'pickup-routes.not_found', message: 'No such pickup.' })
  if (input.day !== undefined && input.day !== existing.day) {
    await repo.deleteDayForDate(q, input.userId, existing.day) // the old day's plan is stale (§7.9)
  }
  await rescheduleReminders(q, input.userId, plainOf(row))
  return ok({ pickup: toPickup(row, key.value), event: changedEvent(row, 'updated', now) })
}

/** Arranged, Tentative, Collected, Cancelled or No-show (§5.5). Reminders follow the status. */
export async function setStatus(
  q: Queryable,
  rawInput: PickupRoutesSetStatusInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<{ pickup: PickupRoutesPickup; event: EventEnvelope }>> {
  const parsed = PickupRoutesSetStatusInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  const now = deps.now ?? new Date()
  const row = await repo.updatePickup(q, input.userId, input.pickupId, { status: input.status })
  if (!row) return err({ code: 'pickup-routes.not_found', message: 'No such pickup.' })
  await rescheduleReminders(q, input.userId, plainOf(row))
  return ok({ pickup: toPickup(row, key.value), event: changedEvent(row, 'status', now) })
}

/** Deletes a pickup; its reminders, and every plan and day row for its day, go with it (§7.9). */
export async function deletePickup(
  q: Queryable,
  rawInput: PickupRoutesDeleteInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<{ deleted: boolean; event: EventEnvelope | null }>> {
  const parsed = PickupRoutesDeleteInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const now = deps.now ?? new Date()
  const existing = await repo.selectPickup(q, input.userId, input.pickupId)
  if (!existing) return ok({ deleted: false, event: null })
  await repo.deletePickup(q, input.userId, input.pickupId)
  await repo.deleteDayForDate(q, input.userId, existing.day)
  return ok({ deleted: true, event: changedEvent(existing, 'deleted', now) })
}

/** The user's pickups for a day, decrypted for the owner (card, `listForDay(userId, date)`). */
export async function listForDay(
  q: Queryable,
  rawInput: PickupRoutesListForDayInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<PickupRoutesPickup[]>> {
  const parsed = PickupRoutesListForDayInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const refused = await gate(q, parsed.data.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  const rows = await repo.selectPickupsForDay(q, parsed.data.userId, parsed.data.day)
  return ok(rows.map((row) => toPickup(row, key.value)))
}

/**
 * The words of a reminder (card, `reminderText(userId, pickupId)`): label and time only, never
 * the address (§5.4). Called by the dispatcher inside `withUser(userId)` for the reminder-due
 * event's user. Needs no key: nothing sealed is opened.
 */
export async function reminderText(
  q: Queryable,
  input: { userId: string; pickupId: string; kind: PickupRoutesReminderKind },
): Promise<Outcome<{ kind: PickupRoutesReminderKind; text: string }>> {
  if ((await state(q, 'pickup-routes')) === 'off') {
    return err({ code: 'pickup-routes.off', message: 'Pickups are unavailable.' })
  }
  const row = await repo.selectPickupPlain(q, input.userId, input.pickupId)
  if (!row) return err({ code: 'pickup-routes.not_found', message: 'No such pickup.' })
  const dayRows = await repo.selectPickupsPlainForDay(q, input.userId, row.day)
  const day = await repo.selectDay(q, input.userId, row.day)
  const plan = day ? await repo.selectCurrentPlan(q, input.userId, day.id) : undefined
  const planned = (plan?.stops as PickupRoutesPlannedStop[] | undefined)?.find(
    (s) => s.pickupId === row.id,
  )
  const text = reminderWords(
    input.kind,
    plainOf(row),
    dayRows.map(plainOf),
    planned ? Math.floor(Date.parse(planned.leaveAt) / 1000) : null,
  )
  return ok({ kind: input.kind, text })
}

/**
 * Reminders due by `now` (a pipeline scan, as nabvy_pipeline), as `pickup-routes.reminder-due`
 * events for the dispatcher, then `markRemindersSent()` once delivered. Off: none (reminders are
 * paused, card "When off"). Idempotent: a reminder is returned until it is marked sent.
 */
export async function dueReminders(
  q: Queryable,
  options: { now: Date; limit?: number },
): Promise<{ reminderIds: string[]; events: EventEnvelope[] }> {
  if ((await state(q, 'pickup-routes')) === 'off') return { reminderIds: [], events: [] }
  const rows = await repo.selectDueReminders(q, options.now, Math.min(500, options.limit ?? 500))
  return {
    reminderIds: rows.map((r) => r.id),
    events: rows.map(
      (r) =>
        createEvent(
          events,
          'pickup-routes.reminder-due',
          1,
          {
            reminderId: r.id,
            pickupId: r.pickupId,
            userId: r.userId,
            kind: r.kind as PickupRoutesReminderKind,
            dueAt: r.dueAt.toISOString(),
          },
          { key: reminderDueKey(r.id) },
        ) as EventEnvelope,
    ),
  }
}

export async function markRemindersSent(
  q: Queryable,
  reminderIds: readonly string[],
  now: Date,
): Promise<number> {
  return repo.markRemindersSent(q, reminderIds, now)
}

/** Sets or changes a day's start, end, window and drive cap (§6.1; `routes.upsertDay`). */
export async function upsertDay(
  q: Queryable,
  rawInput: PickupRoutesDayInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<{ dayId: string }>> {
  const parsed = PickupRoutesDayInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  if (input.startKind !== 'home' && !input.startPoint) return err(invalid('startPoint is required'))
  if (input.endKind === 'custom' && !input.endPoint) return err(invalid('endPoint is required'))
  const defaults = await repo.selectDefaults(q, input.userId)
  const priv: DayPrivate = {
    startPoint: input.startKind === 'home' ? null : input.startPoint,
    endPoint: input.endKind === 'custom' ? input.endPoint : null,
  }
  const row = await repo.upsertDay(q, {
    userId: input.userId,
    day: input.day,
    startKind: input.startKind,
    endKind: input.endKind,
    privateEnc: seal(key.value, priv),
    startTime: input.startTime ?? defaults?.dayStart ?? PICKUP_ROUTES_DAY_START_DEFAULT,
    latestFinish:
      input.latestFinish ?? defaults?.latestFinish ?? PICKUP_ROUTES_LATEST_FINISH_DEFAULT,
    maxDriveMinutes: input.maxDriveMinutes,
  })
  return ok({ dayId: row.id })
}

function toDefaults(
  userId: string,
  row: repo.DefaultsRow | undefined,
  key: Buffer,
): PickupRoutesDefaults {
  const priv = row?.privateEnc ? (open(key, row.privateEnc) as DefaultsPrivate) : null
  return PickupRoutesDefaults.parse({
    userId,
    homePostcode: priv?.homePostcode ?? null,
    homePoint: priv?.homePin ?? priv?.homePoint ?? null,
    dayStart: row?.dayStart ?? PICKUP_ROUTES_DAY_START_DEFAULT,
    latestFinish: row?.latestFinish ?? PICKUP_ROUTES_LATEST_FINISH_DEFAULT,
    endAtHome: row?.endAtHome ?? true,
    serviceMinutes: row?.serviceMinutes ?? PICKUP_ROUTES_SERVICE_MINUTES_DEFAULT,
  })
}

/** The planner defaults (§7.9), the module's starting values when none are stored. */
export async function getDefaults(
  q: Queryable,
  userId: string,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<PickupRoutesDefaults>> {
  const refused = await gate(q, userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  return ok(toDefaults(userId, await repo.selectDefaults(q, userId), key.value))
}

export async function updateDefaults(
  q: Queryable,
  rawInput: PickupRoutesDefaultsInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<PickupRoutesDefaults>> {
  const parsed = PickupRoutesDefaultsInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  const existing = await repo.selectDefaults(q, input.userId)
  const priv: DefaultsPrivate = existing?.privateEnc
    ? (open(key.value, existing.privateEnc) as DefaultsPrivate)
    : { homePostcode: null, homePoint: null, homePin: null }
  if (input.homePostcode !== undefined) {
    priv.homePostcode = input.homePostcode
    priv.homePoint = input.homePostcode
      ? ((await geocode(q, deps, input.homePostcode)) ?? null)
      : null
  }
  if (input.homePin !== undefined) priv.homePin = input.homePin
  const patch: Parameters<typeof repo.upsertDefaults>[2] = { privateEnc: seal(key.value, priv) }
  if (input.dayStart !== undefined) patch.dayStart = input.dayStart
  if (input.latestFinish !== undefined) patch.latestFinish = input.latestFinish
  if (input.endAtHome !== undefined) patch.endAtHome = input.endAtHome
  if (input.serviceMinutes !== undefined) patch.serviceMinutes = input.serviceMinutes
  const row = await repo.upsertDefaults(q, input.userId, patch)
  return ok(toDefaults(input.userId, row, key.value))
}

/** The user's home point for the feed's "Home" origin (card, `homePoint(userId)`), or undefined. */
export async function homePoint(
  q: Queryable,
  userId: string,
  deps: PickupRoutesDeps = {},
): Promise<PickupRoutesPoint | undefined> {
  const defaults = await getDefaults(q, userId, deps)
  return defaults.ok ? (defaults.value.homePoint ?? undefined) : undefined
}

interface PlanRun {
  userId: string
  day: string
  mode: 'optimised' | 'my_order'
  order?: string[]
  pinFirst: string | null
  pinLast: string | null
  /** A replan: start from here, now. */
  from?: { point: PickupRoutesPoint | null; at: Date }
}

async function runPlan(
  q: Queryable,
  run: PlanRun,
  deps: PickupRoutesDeps,
  key: Buffer,
): Promise<Outcome<{ plan: PickupRoutesPlan; event: EventEnvelope }>> {
  const now = deps.now ?? new Date()
  const rows = await repo.selectPickupsForDay(q, run.userId, run.day)
  const plannable = rows.filter((r) => r.status === 'arranged' || r.status === 'tentative')
  const decrypted = plannable.map((row) => ({ row, pickup: toPickup(row, key) }))
  const withPoint = decrypted.filter((d) => d.pickup.point !== null)
  if (withPoint.length === 0)
    return err({
      code: 'pickup-routes.nothing_to_plan',
      message: 'No pickup on that day has a location.',
    })
  if (withPoint.length > PICKUP_ROUTES_MAX_STOPS) {
    return err({
      code: 'pickup-routes.too_many_stops',
      message: `A day holds at most ${PICKUP_ROUTES_MAX_STOPS} stops.`,
    })
  }
  const defaultsRow = await repo.selectDefaults(q, run.userId)
  const defaults = toDefaults(run.userId, defaultsRow, key)
  let day = await repo.selectDay(q, run.userId, run.day)
  if (!day) {
    day = await repo.upsertDay(q, {
      userId: run.userId,
      day: run.day,
      startKind: 'home',
      endKind: defaults.endAtHome ? 'home' : 'open',
      privateEnc: null,
      startTime: defaults.dayStart,
      latestFinish: defaults.latestFinish,
      maxDriveMinutes: null,
    })
  }
  const dayPriv: DayPrivate = day.privateEnc
    ? (open(key, day.privateEnc) as DayPrivate)
    : { startPoint: null, endPoint: null }
  const home = defaults.homePoint
  const start = run.from
    ? (run.from.point ?? home)
    : day.startKind === 'home'
      ? home
      : dayPriv.startPoint
  if (!start)
    return err({
      code: 'pickup-routes.no_home',
      message: 'Set a home postcode, or a start point for the day.',
    })
  const end = day.endKind === 'home' ? home : day.endKind === 'custom' ? dayPriv.endPoint : null
  if (day.endKind === 'home' && !end)
    return err({
      code: 'pickup-routes.no_home',
      message: 'Set a home postcode, or end the day at the last stop.',
    })

  const points: PickupRoutesPoint[] = [
    start,
    ...withPoint.map((d) => d.pickup.point as PickupRoutesPoint),
    ...(end ? [end] : []),
  ]
  const table = await (deps.router ?? noRouter).table(points)
  const matrix =
    table ?? estimateMatrix(points, PICKUP_ROUTES_ESTIMATE_FACTOR, PICKUP_ROUTES_ESTIMATE_SPEED_KMH)
  const dayStart = londonToEpoch(run.day, day.startTime)
  const latestFinish = londonToEpoch(run.day, day.latestFinish)
  const startAt = run.from ? Math.floor(run.from.at.getTime() / 1000) : dayStart
  const stops: SolverStop[] = withPoint.map((d, i) => {
    const bounds = windowBounds(run.day, d.pickup.window, dayStart, latestFinish)
    return {
      id: d.pickup.id,
      index: i + 1,
      windowStart: bounds.start,
      windowEnd: bounds.end,
      serviceSeconds: d.pickup.serviceMinutes * 60,
      mustGet: d.pickup.mustGet,
    }
  })
  const input: SolverInput = {
    stops,
    startIndex: 0,
    endIndex: end ? points.length - 1 : null,
    startAt,
    latestFinish,
    maxDriveSeconds: day.maxDriveMinutes === null ? null : day.maxDriveMinutes * 60,
    pinFirst: run.pinFirst,
    pinLast: run.pinLast,
    durations: matrix.durations,
    distances: matrix.distances,
  }
  const known = new Set(stops.map((s) => s.id))
  const solution =
    run.mode === 'my_order'
      ? (() => {
          const order = (run.order ?? []).filter((id) => known.has(id))
          const s = schedule(input, order)
          const inOrder = new Set(order)
          return {
            ...s,
            unassigned: stops
              .filter((st) => !inOrder.has(st.id))
              .map((st) => ({ id: st.id, reason: 'window' as const, lateSeconds: null })),
          }
        })()
      : solve(input)

  const byId = new Map(decrypted.map((d) => [d.pickup.id, d.pickup]))
  const plannedStops: PickupRoutesPlannedStop[] = solution.stops.map((s) => {
    const pickup = byId.get(s.id) as PickupRoutesPickup
    return {
      pickupId: s.id,
      order: s.order,
      leaveAt: toIso(s.leaveAt),
      arriveAt: toIso(s.arriveAt),
      departAt: toIso(s.departAt),
      waitSeconds: s.waitSeconds,
      lateSeconds: s.lateSeconds,
      legSeconds: s.legSeconds,
      legMetres: s.legMetres,
      proposedWindow: pickup.window.kind === 'unagreed' ? proposedSlot(s.arriveAt) : null,
    }
  })
  const unassigned: PickupRoutesUnassigned[] = [
    ...solution.unassigned.map((u) => ({
      pickupId: u.id,
      reason: u.reason,
      lateSeconds: u.lateSeconds,
    })),
    ...decrypted
      .filter((d) => d.pickup.point === null)
      .map((d) => ({ pickupId: d.pickup.id, reason: 'no_point' as const, lateSeconds: null })),
  ]
  const legs = solution.stops.map((s) => ({
    roadMiles: s.legMetres / 1609.344,
    minutes: s.legSeconds / 60,
  }))
  const cost =
    legs.length > 0
      ? await (deps.travelCost ?? noTravelCost).tripCost(q, run.userId, legs)
      : undefined

  const stored = await repo.insertPlan(
    q,
    {
      userId: run.userId,
      dayId: day.id,
      mode: run.mode,
      basis: table ? 'router' : 'estimate',
      osmBuild: table?.osmBuild ?? null,
      startAt: new Date(startAt * 1000),
      finishAt: new Date(solution.finishAt * 1000),
      driveSeconds: solution.driveSeconds,
      distanceMetres: solution.distanceMetres,
      costMinor: cost?.pence ?? null,
      costBasis: cost?.basis ?? null,
      stops: plannedStops,
      unassigned,
    },
    now,
  )
  for (const d of decrypted) await rescheduleReminders(q, run.userId, plainOf(d.row))
  const plan = PickupRoutesPlan.parse({
    id: stored.id,
    userId: stored.userId,
    dayId: stored.dayId,
    day: run.day,
    version: stored.version,
    mode: stored.mode,
    basis: stored.basis,
    osmBuild: stored.osmBuild,
    startAt: stored.startAt.toISOString(),
    finishAt: stored.finishAt.toISOString(),
    driveSeconds: stored.driveSeconds,
    distanceMetres: stored.distanceMetres,
    costMinor: stored.costMinor,
    costBasis: stored.costBasis,
    stops: plannedStops,
    unassigned,
    createdAt: stored.createdAt.toISOString(),
  })
  const event = createEvent(
    events,
    'pickup-routes.planned',
    1,
    {
      planId: plan.id,
      userId: plan.userId,
      dayId: plan.dayId,
      pickupIds: plan.stops.map((s) => s.pickupId),
      leaveAts: plan.stops.map((s) => s.leaveAt),
    },
    { key: plannedKey(plan.id) },
  ) as EventEnvelope
  return ok({ plan, event })
}

/** Plans a day (card, `planDay()`; §6.3): the optimised order, or "My order" with lateness. */
export async function planDay(
  q: Queryable,
  rawInput: PickupRoutesPlanInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<{ plan: PickupRoutesPlan; event: EventEnvelope }>> {
  const parsed = PickupRoutesPlanInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  if (input.mode === 'my_order' && !input.order) return err(invalid('my_order needs an order'))
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  return runPlan(
    q,
    {
      userId: input.userId,
      day: input.day,
      mode: input.mode,
      order: input.order,
      pinFirst: input.pinFirst,
      pinLast: input.pinLast,
    },
    deps,
    key.value,
  )
}

/** "I'm running late" (card, `replan()`; §6.4): the remaining stops from now and the current position, which is never stored. */
export async function replan(
  q: Queryable,
  rawInput: PickupRoutesReplanInput,
  deps: PickupRoutesDeps = {},
): Promise<Outcome<{ plan: PickupRoutesPlan; event: EventEnvelope }>> {
  const parsed = PickupRoutesReplanInput.safeParse(rawInput)
  if (!parsed.success) return err(invalid(parsed.error.message))
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  return runPlan(
    q,
    {
      userId: input.userId,
      day: input.day,
      mode: 'optimised',
      pinFirst: null,
      pinLast: null,
      from: { point: input.position, at: deps.now ?? new Date() },
    },
    deps,
    key.value,
  )
}

/** The current plan for a day, or undefined when none. */
export async function currentPlan(
  q: Queryable,
  userId: string,
  day: string,
): Promise<PickupRoutesPlan | undefined> {
  const dayRow = await repo.selectDay(q, userId, day)
  if (!dayRow) return undefined
  const stored = await repo.selectCurrentPlan(q, userId, dayRow.id)
  if (!stored) return undefined
  return PickupRoutesPlan.parse({
    id: stored.id,
    userId: stored.userId,
    dayId: stored.dayId,
    day,
    version: stored.version,
    mode: stored.mode,
    basis: stored.basis,
    osmBuild: stored.osmBuild,
    startAt: stored.startAt.toISOString(),
    finishAt: stored.finishAt.toISOString(),
    driveSeconds: stored.driveSeconds,
    distanceMetres: stored.distanceMetres,
    costMinor: stored.costMinor,
    costBasis: stored.costBasis,
    stops: stored.stops,
    unassigned: stored.unassigned,
    createdAt: stored.createdAt.toISOString(),
  })
}

/** The `.ics` download for a planned day (card, `icsFor()`; §6.5), for the signed-in owner only. */
export async function icsFor(
  q: Queryable,
  input: { userId: string; day: string },
  deps: PickupRoutesDeps = {},
): Promise<Outcome<string>> {
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  const plan = await currentPlan(q, input.userId, input.day)
  if (!plan) return err({ code: 'pickup-routes.not_found', message: 'No plan for that day.' })
  const rows = await repo.selectPickupsForDay(q, input.userId, input.day)
  const byId = new Map(rows.map((row) => [row.id, toPickup(row, key.value)]))
  const stops: IcsStop[] = plan.stops.flatMap((s) => {
    const pickup = byId.get(s.pickupId)
    if (!pickup) return []
    return [
      {
        pickupId: pickup.id,
        label: pickup.label,
        status: pickup.status,
        addressText: pickup.addressText,
        notes: pickup.notes,
        arriveAt: s.arriveAt,
        departAt: s.departAt,
        leaveAt: s.leaveAt,
      },
    ]
  })
  return ok(icsDocument(plan, stops))
}

/** Navigation links for the current plan (§6.5), from the owner's points, built on demand. */
export async function navigationLinksFor(
  q: Queryable,
  input: { userId: string; day: string; mobile?: boolean },
  deps: PickupRoutesDeps = {},
): Promise<Outcome<PickupRoutesNavigationLinks>> {
  const refused = await gate(q, input.userId)
  if (refused) return err(refused)
  const key = keyOf(deps)
  if (!key.ok) return key
  const plan = await currentPlan(q, input.userId, input.day)
  if (!plan) return err({ code: 'pickup-routes.not_found', message: 'No plan for that day.' })
  const dayRow = await repo.selectDay(q, input.userId, input.day)
  const rows = await repo.selectPickupsForDay(q, input.userId, input.day)
  const byId = new Map(rows.map((row) => [row.id, toPickup(row, key.value)]))
  const defaults = toDefaults(input.userId, await repo.selectDefaults(q, input.userId), key.value)
  const dayPriv: DayPrivate = dayRow?.privateEnc
    ? (open(key.value, dayRow.privateEnc) as DayPrivate)
    : { startPoint: null, endPoint: null }
  const start = dayRow?.startKind === 'home' || !dayRow ? defaults.homePoint : dayPriv.startPoint
  if (!start) return err({ code: 'pickup-routes.no_home', message: 'No start point.' })
  const end =
    dayRow?.endKind === 'home'
      ? defaults.homePoint
      : dayRow?.endKind === 'custom'
        ? dayPriv.endPoint
        : null
  const points = plan.stops.flatMap((s) => {
    const p = byId.get(s.pickupId)?.point
    return p ? [p] : []
  })
  return ok(navigationLinks(start, points, end, { mobile: input.mobile }))
}

/**
 * Retention (§5.6; §10 row 15, the interim conservative default): as the pipeline, deletes every
 * pickup, day and plan whose day is more than PICKUP_ROUTES_RETENTION_DAYS before today in
 * Europe/London. Off: nothing is deleted (records are kept, card "When off"). Idempotent.
 */
export async function purgeExpired(
  q: Queryable,
  options: { now: Date },
): Promise<{ pickups: number; days: number }> {
  if ((await state(q, 'pickup-routes')) === 'off') return { pickups: 0, days: 0 }
  const today = epochToLondonDay(Math.floor(options.now.getTime() / 1000))
  return repo.deleteBeforeDay(q, shiftDay(today, -PICKUP_ROUTES_RETENTION_DAYS))
}

export type { DayRow, DefaultsRow, PickupRow, PlanRow, ReminderRow } from './repo'
