// Pure logic of the pickup-routes module: windows, reminders, event keys, the .ics document and
// navigation links. No I/O. The solver is in ./solver, encryption in ./crypto, time in ./time.
import {
  PICKUP_ROUTES_EVENING_REMINDER_TIME,
  PICKUP_ROUTES_FIXED_TIME_AFTER_MIN,
  PICKUP_ROUTES_FIXED_TIME_BEFORE_MIN,
  PICKUP_ROUTES_LEAVE_BY_LEAD_MIN,
  PICKUP_ROUTES_LEAVE_BY_NO_PLAN_MIN,
  PICKUP_ROUTES_PROPOSED_SLOT_ROUND_MIN,
  PICKUP_ROUTES_PROPOSED_SLOT_WIDTH_MIN,
  PICKUP_ROUTES_UNAGREED_REMINDER_TIME,
} from '@nabvy/config/modules/pickup-routes'
import type {
  PickupRoutesNavigationLinks,
  PickupRoutesPlan,
  PickupRoutesPoint,
  PickupRoutesReminderKind,
  PickupRoutesStatus,
  PickupRoutesWindow,
} from '@nabvy/contracts/modules/pickup-routes'
import { epochToLondonTime, fromIso, londonToEpoch, shiftDay, toIso } from './time'

export { open, parseDataKey, SealError, seal } from './crypto'
export * from './solver'
export * from './time'

/** The plain columns a reminder or a window needs; never an address. */
export interface PickupPlain {
  id: string
  label: string
  day: string
  window: PickupRoutesWindow
  status: PickupRoutesStatus
}

/**
 * A window as hard epoch bounds for its day (search-map-routes.md §5.1, "When"): a fixed time is
 * −5/+10 minutes; `after` runs to the day's latest finish, `before` from the day's start;
 * `unagreed` has none.
 */
export function windowBounds(
  day: string,
  window: PickupRoutesWindow,
  dayStart: number,
  latestFinish: number,
): { start: number | null; end: number | null } {
  switch (window.kind) {
    case 'at': {
      const at = londonToEpoch(day, window.start as string)
      return {
        start: at - PICKUP_ROUTES_FIXED_TIME_BEFORE_MIN * 60,
        end: at + PICKUP_ROUTES_FIXED_TIME_AFTER_MIN * 60,
      }
    }
    case 'between':
      return {
        start: londonToEpoch(day, window.start as string),
        end: londonToEpoch(day, window.end as string),
      }
    case 'after':
      return { start: londonToEpoch(day, window.start as string), end: latestFinish }
    case 'before':
      return { start: dayStart, end: londonToEpoch(day, window.end as string) }
    case 'unagreed':
      return { start: null, end: null }
  }
}

/** The agreed time to show in a reminder: the fixed time, a window's start, or null. */
export function agreedTime(window: PickupRoutesWindow): string | null {
  switch (window.kind) {
    case 'at':
    case 'between':
    case 'after':
      return window.start ?? null
    case 'before':
      return window.end ?? null
    case 'unagreed':
      return null
  }
}

/** A proposed slot for an unagreed stop (§6.5): the ETA rounded to 10 minutes, 20 minutes wide. */
export function proposedSlot(arriveAt: number): { start: string; end: string } {
  const round = PICKUP_ROUTES_PROPOSED_SLOT_ROUND_MIN * 60
  const start = Math.round(arriveAt / round) * round
  return {
    start: epochToLondonTime(start),
    end: epochToLondonTime(start + PICKUP_ROUTES_PROPOSED_SLOT_WIDTH_MIN * 60),
  }
}

/**
 * The reminders a pickup should have (§5.4), each idempotent on (pickup, kind, due time): the
 * evening before at 19:00; leave-by at the plan's departure minus 10 minutes, or 60 minutes
 * before the agreed time with no plan; "not agreed yet" at 18:00 the day before. None for a
 * collected, cancelled or no-show pickup.
 */
export function reminderSchedule(
  pickup: PickupPlain,
  plannedLeaveAt: number | null,
): { kind: PickupRoutesReminderKind; dueAt: number }[] {
  if (pickup.status !== 'arranged' && pickup.status !== 'tentative') return []
  const eve = shiftDay(pickup.day, -1)
  const out: { kind: PickupRoutesReminderKind; dueAt: number }[] = [
    { kind: 'evening_before', dueAt: londonToEpoch(eve, PICKUP_ROUTES_EVENING_REMINDER_TIME) },
  ]
  if (pickup.window.kind === 'unagreed') {
    out.push({ kind: 'unagreed', dueAt: londonToEpoch(eve, PICKUP_ROUTES_UNAGREED_REMINDER_TIME) })
  }
  if (plannedLeaveAt !== null) {
    out.push({ kind: 'leave_by', dueAt: plannedLeaveAt - PICKUP_ROUTES_LEAVE_BY_LEAD_MIN * 60 })
  } else {
    const agreed = agreedTime(pickup.window)
    if (agreed !== null && pickup.window.kind !== 'before') {
      out.push({
        kind: 'leave_by',
        dueAt: londonToEpoch(pickup.day, agreed) - PICKUP_ROUTES_LEAVE_BY_NO_PLAN_MIN * 60,
      })
    }
  }
  return out
}

/**
 * Reminder words: the label and time only, never the address, postcode, notes or a point
 * (§5.4; §10 row 16). `dayPickups` are the plannable pickups of the same day, for the count.
 */
export function reminderText(
  kind: PickupRoutesReminderKind,
  pickup: PickupPlain,
  dayPickups: readonly PickupPlain[],
  leaveAt: number | null,
): string {
  const plannable = dayPickups.filter((p) => p.status === 'arranged' || p.status === 'tentative')
  const n = Math.max(1, plannable.length)
  const noun = n === 1 ? 'pickup' : 'pickups'
  switch (kind) {
    case 'evening_before': {
      const times = plannable
        .map((p) => agreedTime(p.window))
        .filter((t): t is string => t !== null)
        .sort()
      const first = times[0]
      return first ? `${n} ${noun} tomorrow · first at ${first}` : `${n} ${noun} tomorrow`
    }
    case 'unagreed': {
      const open = plannable.filter((p) => p.window.kind === 'unagreed').length
      return open <= 1
        ? 'One pickup tomorrow has no agreed time'
        : `${open} pickups tomorrow have no agreed time`
    }
    case 'leave_by': {
      const at = agreedTime(pickup.window)
      const leave = leaveAt !== null ? epochToLondonTime(leaveAt) : null
      const forWhat = `'${pickup.label}'${at ? ` at ${at}` : ''}`
      return leave ? `Leave by ${leave} for ${forWhat}` : `Time to leave for ${forWhat}`
    }
  }
}

/** Event keys: natural ID plus version (rule 8 of docs/design/modules/_rules.md). */
export const changedKey = (pickupId: string, updatedAt: string, change: string): string =>
  `pickup-routes.changed:${pickupId}@${updatedAt}:${change}`
export const reminderDueKey = (reminderId: string): string =>
  `pickup-routes.reminder-due:${reminderId}`
export const plannedKey = (planId: string): string => `pickup-routes.planned:${planId}`

const icsTime = (iso: string): string => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const icsEscape = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const fold = (line: string): string => {
  const out: string[] = []
  let rest = line
  while (rest.length > 73) {
    out.push(rest.slice(0, 73))
    rest = ` ${rest.slice(73)}`
  }
  out.push(rest)
  return out.join('\r\n')
}

export interface IcsStop {
  pickupId: string
  label: string
  status: PickupRoutesStatus
  /** The owner's own address text, for the LOCATION line of their own download (§6.5). */
  addressText: string | null
  notes: string | null
  arriveAt: string
  departAt: string
  leaveAt: string
}

/**
 * One VEVENT per stop (§6.5): DTSTART the arrival and DTEND arrival plus time at the stop, in
 * UTC; a VALARM at the leg's departure; a UID stable per pickup; SEQUENCE the plan version;
 * STATUS from the pickup's status. Served only as a download to the signed-in owner.
 */
export function icsDocument(
  plan: Pick<PickupRoutesPlan, 'version' | 'day' | 'createdAt'>,
  stops: readonly IcsStop[],
): string {
  const status = (s: PickupRoutesStatus) =>
    s === 'tentative'
      ? 'TENTATIVE'
      : s === 'cancelled' || s === 'no_show'
        ? 'CANCELLED'
        : 'CONFIRMED'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nabvy//Pickup routes//EN',
    'CALSCALE:GREGORIAN',
  ]
  for (const stop of stops) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:pickup-${stop.pickupId}@nabvy`,
      `SEQUENCE:${plan.version}`,
      `DTSTAMP:${icsTime(plan.createdAt)}`,
      `DTSTART:${icsTime(stop.arriveAt)}`,
      `DTEND:${icsTime(stop.departAt)}`,
      `SUMMARY:${icsEscape(stop.label)}`,
      `STATUS:${status(stop.status)}`,
    )
    if (stop.addressText) lines.push(`LOCATION:${icsEscape(stop.addressText)}`)
    if (stop.notes) lines.push(`DESCRIPTION:${icsEscape(stop.notes)}`)
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`Leave for ${stop.label}`)}`,
      `TRIGGER;VALUE=DATE-TIME:${icsTime(stop.leaveAt)}`,
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}

const coord = (p: PickupRoutesPoint): string => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`

/**
 * Navigation deep links from coordinates only (§6.5), built on demand and never stored. Google
 * takes up to 9 waypoints on desktop and 3 on mobile browsers, so a longer route is split into
 * consecutive legs; Apple takes repeated `waypoint` parameters; Waze takes one destination, so
 * it gets "navigate to next pickup" only.
 */
export function navigationLinks(
  start: PickupRoutesPoint,
  stops: readonly PickupRoutesPoint[],
  end: PickupRoutesPoint | null,
  options: { mobile?: boolean } = {},
): PickupRoutesNavigationLinks {
  if (stops.length === 0) return { google: [], apple: [], wazeNext: null }
  const points = [...stops, ...(end ? [end] : [])]
  const maxWaypoints = options.mobile ? 3 : 9
  const google: string[] = []
  let origin = start
  let i = 0
  while (i < points.length) {
    const chunk = points.slice(i, i + maxWaypoints + 1)
    const destination = chunk[chunk.length - 1] as PickupRoutesPoint
    const waypoints = chunk.slice(0, -1)
    const params = new URLSearchParams({
      api: '1',
      origin: coord(origin),
      destination: coord(destination),
      travelmode: 'driving',
    })
    if (waypoints.length > 0) params.set('waypoints', waypoints.map(coord).join('|'))
    google.push(`https://www.google.com/maps/dir/?${params.toString()}`)
    origin = destination
    i += chunk.length
  }
  const last = points[points.length - 1] as PickupRoutesPoint
  const apple = new URLSearchParams({
    source: coord(start),
    destination: coord(last),
    mode: 'driving',
  })
  for (const p of points.slice(0, -1)) apple.append('waypoint', coord(p))
  const next = stops[0] as PickupRoutesPoint
  return {
    google,
    apple: [`https://maps.apple.com/directions?${apple.toString()}`],
    wazeNext: `https://waze.com/ul?ll=${coord(next)}&navigate=yes`,
  }
}

export const isoAt = toIso
export const epochOf = fromIso
