import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the pickup-routes module (services/pickup-routes, docs/design/modules/
// pickup-routes.md): the user's own record of arranged pickups, pickup days, reminders and route
// plans. Import from '@nabvy/contracts/modules/pickup-routes'. Every input is bounded. Nothing
// here carries an address, a postcode or a point except the inputs the owner types and the
// outputs returned to that same owner inside withUser: events carry identifiers and times only
// (rule 7 of docs/design/modules/_rules.md), and reminder text carries the label and time, never
// the address (search-map-routes.md §5.4, §10 row 16).

export const module = 'pickup-routes'

/** A calendar day in Europe/London, `YYYY-MM-DD` (search-map-routes.md §5.1, "Day"). */
export const PickupRoutesDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
export type PickupRoutesDay = z.infer<typeof PickupRoutesDay>

/** A wall-clock time in Europe/London, `HH:MM`. */
export const PickupRoutesTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export type PickupRoutesTime = z.infer<typeof PickupRoutesTime>

/** A WGS84 point. Only ever the owner's own pickup, home or start point, never a listing's. */
export const PickupRoutesPoint = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})
export type PickupRoutesPoint = z.infer<typeof PickupRoutesPoint>

/** Collection at the seller's, or a meet-up point (§5.1, "Stop type"). */
export const PickupRoutesStopType = z.enum(['collection', 'meetup'])
export type PickupRoutesStopType = z.infer<typeof PickupRoutesStopType>

/**
 * When the pickup is (§5.1, "When"). `at` is a fixed time (a window of -5/+10 minutes around it,
 * PICKUP_ROUTES_FIXED_TIME_BEFORE_MIN/AFTER_MIN); `between` needs both ends; `after` and
 * `before` need one; `unagreed` has no window and gets a proposed slot from the plan (§6.5).
 */
export const PickupRoutesWindowKind = z.enum(['at', 'between', 'after', 'before', 'unagreed'])
export type PickupRoutesWindowKind = z.infer<typeof PickupRoutesWindowKind>

export const PickupRoutesWindow = z
  .strictObject({
    kind: PickupRoutesWindowKind,
    start: PickupRoutesTime.optional(),
    end: PickupRoutesTime.optional(),
  })
  .superRefine((w, ctx) => {
    const need: Record<PickupRoutesWindowKind, { start: boolean; end: boolean }> = {
      at: { start: true, end: false },
      between: { start: true, end: true },
      after: { start: true, end: false },
      before: { start: false, end: true },
      unagreed: { start: false, end: false },
    }
    const rule = need[w.kind]
    if (rule.start !== (w.start !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: `${w.kind}: start ${rule.start ? 'required' : 'not allowed'}`,
      })
    }
    if (rule.end !== (w.end !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: `${w.kind}: end ${rule.end ? 'required' : 'not allowed'}`,
      })
    }
    if (w.kind === 'between' && w.start && w.end && w.end <= w.start) {
      ctx.addIssue({ code: 'custom', message: 'between: end must be after start' })
    }
  })
export type PickupRoutesWindow = z.infer<typeof PickupRoutesWindow>

/** Small, fits in the boot, or large (§5.1, "Size"); a later boot-capacity constraint. */
export const PickupRoutesSize = z.enum(['small', 'boot', 'large'])
export type PickupRoutesSize = z.infer<typeof PickupRoutesSize>

/** Arranged, Tentative, Collected, Cancelled, No-show (§5.5). */
export const PickupRoutesStatus = z.enum([
  'arranged',
  'tentative',
  'collected',
  'cancelled',
  'no_show',
])
export type PickupRoutesStatus = z.infer<typeof PickupRoutesStatus>

/** Statuses a plan includes (§6.1, "A stop"). */
export const PickupRoutesPlannableStatus = z.enum(['arranged', 'tentative'])

/** The pickup fields the user edits (§5.1). Every text is bounded; the price is minor units. */
const pickupFields = {
  label: z.string().trim().min(1).max(80),
  /** Required: geocoded in-house by location.pointForPostcode() (§5.3). */
  postcode: z.string().trim().min(5).max(8),
  /** Optional address text the user chose to keep; encrypted at rest, shown only to the owner. */
  addressText: z.string().trim().max(200).nullable().default(null),
  /** A pin the user dragged to refine the postcode point (§5.1, "Where"); encrypted at rest. */
  pin: PickupRoutesPoint.nullable().default(null),
  stopType: PickupRoutesStopType.default('collection'),
  day: PickupRoutesDay,
  window: PickupRoutesWindow,
  /** Time at the stop, minutes (§5.1); the default is PICKUP_ROUTES_SERVICE_MINUTES_DEFAULT. */
  serviceMinutes: z.int().min(1).max(240).default(10),
  /** The agreed price in pence, or null while not agreed. Never prefilled from a listing. */
  priceMinor: z.int().min(0).max(100_000_000).nullable().default(null),
  bringCash: z.boolean().default(false),
  size: PickupRoutesSize.default('small'),
  mustGet: z.boolean().default(false),
  /** Private notes; encrypted at rest. */
  notes: z.string().trim().max(1000).nullable().default(null),
  status: PickupRoutesPlannableStatus.default('arranged'),
  /** Optional linked listing, used only to show the title and the source link (§5.1). */
  listingId: Uuid.nullable().default(null),
}

/** `PickupRoutesPickupInput`: the create form, inside withUser (card, "Contracts"). */
export const PickupRoutesPickupInput = z.strictObject({ userId: Uuid, ...pickupFields })
export type PickupRoutesPickupInput = z.input<typeof PickupRoutesPickupInput>

/** The update form: any subset of the same fields. */
export const PickupRoutesUpdateInput = z
  .strictObject({ userId: Uuid, pickupId: Uuid })
  .extend(z.strictObject(pickupFields).partial().shape)
export type PickupRoutesUpdateInput = z.input<typeof PickupRoutesUpdateInput>

export const PickupRoutesSetStatusInput = z.strictObject({
  userId: Uuid,
  pickupId: Uuid,
  status: PickupRoutesStatus,
})
export type PickupRoutesSetStatusInput = z.infer<typeof PickupRoutesSetStatusInput>

export const PickupRoutesDeleteInput = z.strictObject({ userId: Uuid, pickupId: Uuid })
export type PickupRoutesDeleteInput = z.infer<typeof PickupRoutesDeleteInput>

export const PickupRoutesListForDayInput = z.strictObject({ userId: Uuid, day: PickupRoutesDay })
export type PickupRoutesListForDayInput = z.infer<typeof PickupRoutesListForDayInput>

/**
 * A pickup as returned to its owner (decrypted inside the module, inside withUser). Never crosses
 * to another user or module: no view exists over it (card, "Views: none").
 */
export const PickupRoutesPickup = z.strictObject({
  id: Uuid,
  userId: Uuid,
  label: pickupFields.label,
  postcode: z.string(),
  addressText: z.string().nullable(),
  /** The point used for planning: the pin if one was dragged, else the postcode's point. */
  point: PickupRoutesPoint.nullable(),
  pinned: z.boolean(),
  stopType: PickupRoutesStopType,
  day: PickupRoutesDay,
  window: PickupRoutesWindow,
  serviceMinutes: z.int(),
  priceMinor: z.int().nullable(),
  bringCash: z.boolean(),
  size: PickupRoutesSize,
  mustGet: z.boolean(),
  notes: z.string().nullable(),
  status: PickupRoutesStatus,
  listingId: Uuid.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type PickupRoutesPickup = z.infer<typeof PickupRoutesPickup>

/** Reminder kinds (§5.4). Each is idempotent on (pickup, kind, due time). */
export const PickupRoutesReminderKind = z.enum(['evening_before', 'leave_by', 'unagreed'])
export type PickupRoutesReminderKind = z.infer<typeof PickupRoutesReminderKind>

/** The text of a reminder: label and time only, never the address (§10 row 16). */
export const PickupRoutesReminderText = z.strictObject({
  kind: PickupRoutesReminderKind,
  text: z.string().min(1).max(200),
})
export type PickupRoutesReminderText = z.infer<typeof PickupRoutesReminderText>

/** Where a day starts and ends (§6.1). `current` is taken once, at the tap, never stored. */
export const PickupRoutesStartKind = z.enum(['home', 'current', 'custom'])
export const PickupRoutesEndKind = z.enum(['home', 'open', 'custom'])

export const PickupRoutesDayInput = z.strictObject({
  userId: Uuid,
  day: PickupRoutesDay,
  startKind: PickupRoutesStartKind.default('home'),
  /** Required for `current` and `custom`; encrypted at rest; ignored for `home`. */
  startPoint: PickupRoutesPoint.nullable().default(null),
  endKind: PickupRoutesEndKind.default('home'),
  endPoint: PickupRoutesPoint.nullable().default(null),
  startTime: PickupRoutesTime.optional(),
  latestFinish: PickupRoutesTime.optional(),
  maxDriveMinutes: z.int().min(10).max(720).nullable().default(null),
})
export type PickupRoutesDayInput = z.input<typeof PickupRoutesDayInput>

export const PickupRoutesDefaultsInput = z.strictObject({
  userId: Uuid,
  homePostcode: z.string().trim().min(5).max(8).nullable().optional(),
  /** A dragged home pin; encrypted at rest. */
  homePin: PickupRoutesPoint.nullable().optional(),
  dayStart: PickupRoutesTime.optional(),
  latestFinish: PickupRoutesTime.optional(),
  endAtHome: z.boolean().optional(),
  serviceMinutes: z.int().min(1).max(240).optional(),
})
export type PickupRoutesDefaultsInput = z.input<typeof PickupRoutesDefaultsInput>

export const PickupRoutesDefaults = z.strictObject({
  userId: Uuid,
  homePostcode: z.string().nullable(),
  homePoint: PickupRoutesPoint.nullable(),
  dayStart: PickupRoutesTime,
  latestFinish: PickupRoutesTime,
  endAtHome: z.boolean(),
  serviceMinutes: z.int(),
})
export type PickupRoutesDefaults = z.infer<typeof PickupRoutesDefaults>

/** `optimised` (the solver's order) or `my_order` (the user's, with lateness reported; §6.4). */
export const PickupRoutesPlanMode = z.enum(['optimised', 'my_order'])
export type PickupRoutesPlanMode = z.infer<typeof PickupRoutesPlanMode>

/** `PickupRoutesPlanInput`: plan one day (card, "Contracts"; §7.9 `routes.plan`). */
export const PickupRoutesPlanInput = z.strictObject({
  userId: Uuid,
  day: PickupRoutesDay,
  mode: PickupRoutesPlanMode.default('optimised'),
  /** `my_order`: the user's sequence of pickup IDs for the day. */
  order: z.array(Uuid).min(1).max(12).optional(),
  pinFirst: Uuid.nullable().default(null),
  pinLast: Uuid.nullable().default(null),
})
export type PickupRoutesPlanInput = z.input<typeof PickupRoutesPlanInput>

/** "I'm running late" (§6.4): re-plan the remaining stops from now and the current position. */
export const PickupRoutesReplanInput = z.strictObject({
  userId: Uuid,
  day: PickupRoutesDay,
  /** Taken once, at the tap; used for this plan and never stored (§6.4). */
  position: PickupRoutesPoint.nullable().default(null),
})
export type PickupRoutesReplanInput = z.input<typeof PickupRoutesReplanInput>

/** One planned stop. Times are ISO instants; the point is returned to the owner only. */
export const PickupRoutesPlannedStop = z.strictObject({
  pickupId: Uuid,
  order: z.int().min(1).max(12),
  /** When to leave the previous stop (or the start). A wait shows here as a later departure. */
  leaveAt: IsoTimestamp,
  arriveAt: IsoTimestamp,
  departAt: IsoTimestamp,
  waitSeconds: z.int().min(0),
  lateSeconds: z.int().min(0),
  legSeconds: z.int().min(0),
  legMetres: z.int().min(0),
  /** For an `unagreed` stop: the slot to propose to the seller (§6.5), else null. */
  proposedWindow: z.strictObject({ start: PickupRoutesTime, end: PickupRoutesTime }).nullable(),
})
export type PickupRoutesPlannedStop = z.infer<typeof PickupRoutesPlannedStop>

export const PickupRoutesUnassignedReason = z.enum([
  'window',
  'latest_finish',
  'max_drive',
  'no_point',
  'stop_limit',
])

export const PickupRoutesUnassigned = z.strictObject({
  pickupId: Uuid,
  reason: PickupRoutesUnassignedReason,
  /** The lateness inserting it at its cheapest place would cause (§6.4), when known. */
  lateSeconds: z.int().min(0).nullable(),
})
export type PickupRoutesUnassigned = z.infer<typeof PickupRoutesUnassigned>

/** `PickupRoutesPlan`: a stored plan version (card, "Contracts"; §7.9 `route_plans`). */
export const PickupRoutesPlan = z.strictObject({
  id: Uuid,
  userId: Uuid,
  dayId: Uuid,
  day: PickupRoutesDay,
  version: z.int().min(1),
  mode: PickupRoutesPlanMode,
  /** `router`: an OSRM matrix through router-gateway; `estimate`: straight line × 1.3 (§6.2). */
  basis: z.enum(['router', 'estimate']),
  osmBuild: z.string().max(64).nullable(),
  startAt: IsoTimestamp,
  finishAt: IsoTimestamp,
  driveSeconds: z.int().min(0),
  distanceMetres: z.int().min(0),
  /** From travel-cost.tripCost() when that module is on; otherwise null, and no £ is shown. */
  costMinor: z.int().min(0).nullable(),
  costBasis: z.string().max(200).nullable(),
  stops: z.array(PickupRoutesPlannedStop).max(12),
  unassigned: z.array(PickupRoutesUnassigned).max(12),
  createdAt: IsoTimestamp,
})
export type PickupRoutesPlan = z.infer<typeof PickupRoutesPlan>

/** Navigation deep links built from coordinates only (§6.5); built on demand, never stored. */
export const PickupRoutesNavigationLinks = z.strictObject({
  google: z.array(z.url()).max(12),
  apple: z.array(z.url()).max(12),
  wazeNext: z.url().nullable(),
})
export type PickupRoutesNavigationLinks = z.infer<typeof PickupRoutesNavigationLinks>

/** Error codes returned as values (rule 3 of docs/design/modules/_rules.md). */
export const PickupRoutesErrorCode = z.enum([
  'pickup-routes.off', //                the module is off: the pickups pages are hidden
  'pickup-routes.invalid_input', //      the form failed its schema
  'pickup-routes.account_restricted', // the account is suspended or banned
  'pickup-routes.not_found', //          no such pickup, day or plan for this user
  'pickup-routes.no_point', //           the postcode could not be resolved (location off or unknown)
  'pickup-routes.too_many_stops', //     more than PICKUP_ROUTES_MAX_STOPS plannable pickups
  'pickup-routes.nothing_to_plan', //    no plannable pickup with a point on that day
  'pickup-routes.no_home', //            the start or end is home but no home is set
  'pickup-routes.key_missing', //        PICKUPS_DATA_KEY is not configured
])
export type PickupRoutesErrorCode = z.infer<typeof PickupRoutesErrorCode>

export const PickupRoutesError = z.strictObject({
  code: PickupRoutesErrorCode,
  message: z.string().min(1),
})
export type PickupRoutesError = z.infer<typeof PickupRoutesError>

/** `pickup-routes.changed`: a pickup was created, updated, re-statused or deleted (§7.8). */
export const PickupRoutesChangedEvent = z.strictObject({
  pickupId: Uuid,
  userId: Uuid,
  change: z.enum(['created', 'updated', 'status', 'deleted']),
})
export type PickupRoutesChangedEvent = z.infer<typeof PickupRoutesChangedEvent>

/** `pickup-routes.reminder-due`: the dispatcher asks reminderText() for the words (§5.4). */
export const PickupRoutesReminderDueEvent = z.strictObject({
  reminderId: Uuid,
  pickupId: Uuid,
  userId: Uuid,
  kind: PickupRoutesReminderKind,
  dueAt: IsoTimestamp,
})
export type PickupRoutesReminderDueEvent = z.infer<typeof PickupRoutesReminderDueEvent>

/**
 * `pickup-routes.planned` (card: planId, userId, dayId, at, departures[]). Identifiers and times
 * only, as two parallel arrays (the registry refuses objects inside an array): `pickupIds[i]`
 * leaves at `leaveAts[i]`.
 */
export const PickupRoutesPlannedEvent = z
  .strictObject({
    planId: Uuid,
    userId: Uuid,
    dayId: Uuid,
    pickupIds: z.array(Uuid).max(12),
    leaveAts: z.array(IsoTimestamp).max(12),
  })
  .refine((e) => e.pickupIds.length === e.leaveAts.length, {
    message: 'pickupIds and leaveAts must pair up',
  })
export type PickupRoutesPlannedEvent = z.infer<typeof PickupRoutesPlannedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'pickup-routes.changed': { 1: PickupRoutesChangedEvent },
  'pickup-routes.reminder-due': { 1: PickupRoutesReminderDueEvent },
  'pickup-routes.planned': { 1: PickupRoutesPlannedEvent },
})
