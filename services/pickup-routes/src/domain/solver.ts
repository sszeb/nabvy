// The in-house exact route solver (search-map-routes.md §6.2, §6.3; §10 row 25: the conservative
// default over VROOM). Pure: takes a duration and distance matrix and absolute times in seconds,
// returns an order with ETAs. A dynamic programme over (visited set, last stop) keeps, per state,
// the Pareto set of (ready time, driving seconds) labels, so it is optimal for the objective:
// most must-get stops, then most stops, then least driving, then earliest finish. Hard windows,
// time at the stop, a pinned first or last stop, the latest finish and a maximum drive time are
// constraints. A wait at a stop is absorbed as a later departure from the previous stop (§6.5),
// never a wait at the seller's. At most PICKUP_ROUTES_MAX_STOPS stops (12): 2^12 × 12 states.

export interface SolverStop {
  id: string
  /** Row/column in the matrices. */
  index: number
  /** Hard window as epoch seconds, or null for "not agreed yet". */
  windowStart: number | null
  windowEnd: number | null
  serviceSeconds: number
  mustGet: boolean
}

export interface SolverInput {
  stops: SolverStop[]
  startIndex: number
  /** null: an open end (the day ends at the last stop). */
  endIndex: number | null
  startAt: number
  latestFinish: number
  maxDriveSeconds: number | null
  pinFirst?: string | null
  pinLast?: string | null
  /** Seconds and metres, square over every index used. */
  durations: number[][]
  distances: number[][]
}

export interface ScheduledStop {
  id: string
  order: number
  leaveAt: number
  arriveAt: number
  departAt: number
  waitSeconds: number
  lateSeconds: number
  legSeconds: number
  legMetres: number
}

export type UnassignedReason = 'window' | 'latest_finish' | 'max_drive'

export interface Unassigned {
  id: string
  reason: UnassignedReason
  lateSeconds: number | null
}

export interface Schedule {
  stops: ScheduledStop[]
  finishAt: number
  driveSeconds: number
  distanceMetres: number
  /** True when every window, the latest finish and the drive cap hold. */
  feasible: boolean
  /** Seconds past the latest finish, 0 when none. */
  overrunSeconds: number
}

export interface Solution extends Schedule {
  unassigned: Unassigned[]
}

const cell = (m: number[][], i: number, j: number): number => m[i]?.[j] ?? Number.POSITIVE_INFINITY

/**
 * Walks a fixed order with soft windows: an early arrival waits (shown as a later departure from
 * the previous stop), a late arrival is recorded as lateness. Used for "My order" (§6.4) and to
 * cost the cheapest insertion of an unassigned stop.
 */
export function schedule(input: SolverInput, orderIds: readonly string[]): Schedule {
  const byId = new Map(input.stops.map((s) => [s.id, s]))
  let t = input.startAt
  let from = input.startIndex
  let drive = 0
  let metres = 0
  let feasible = true
  const stops: ScheduledStop[] = []
  orderIds.forEach((id, i) => {
    const stop = byId.get(id)
    if (!stop) throw new Error(`schedule: unknown stop ${id}`)
    const travel = cell(input.durations, from, stop.index)
    const legMetres = cell(input.distances, from, stop.index)
    const raw = t + travel
    const wait = stop.windowStart !== null && raw < stop.windowStart ? stop.windowStart - raw : 0
    const arriveAt = raw + wait
    const late =
      stop.windowEnd !== null && arriveAt > stop.windowEnd ? arriveAt - stop.windowEnd : 0
    if (late > 0) feasible = false
    const departAt = arriveAt + stop.serviceSeconds
    drive += travel
    metres += legMetres
    stops.push({
      id,
      order: i + 1,
      leaveAt: t + wait,
      arriveAt,
      departAt,
      waitSeconds: wait,
      lateSeconds: late,
      legSeconds: travel,
      legMetres,
    })
    t = departAt
    from = stop.index
  })
  if (input.endIndex !== null && stops.length > 0) {
    drive += cell(input.durations, from, input.endIndex)
    metres += cell(input.distances, from, input.endIndex)
    t += cell(input.durations, from, input.endIndex)
  }
  const overrun = Math.max(0, t - input.latestFinish)
  if (overrun > 0) feasible = false
  if (input.maxDriveSeconds !== null && drive > input.maxDriveSeconds) feasible = false
  return {
    stops,
    finishAt: t,
    driveSeconds: drive,
    distanceMetres: metres,
    feasible,
    overrunSeconds: overrun,
  }
}

interface Label {
  time: number
  drive: number
  metres: number
  parent: { mask: number; last: number; label: number } | null
}

/** The objective as a comparable tuple: larger is better on the first two, smaller after. */
export function objective(s: { mustGet: number; count: number; drive: number; finish: number }) {
  return [-s.mustGet, -s.count, s.drive, s.finish] as const
}

export function compareObjective(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Solves the day. Stops that cannot fit come back unassigned with their cheapest lateness. */
export function solve(input: SolverInput): Solution {
  const n = input.stops.length
  if (n === 0) {
    return { ...schedule(input, []), unassigned: [] }
  }
  const pinFirst = input.pinFirst ? input.stops.findIndex((s) => s.id === input.pinFirst) : -1
  const pinLast = input.pinLast ? input.stops.findIndex((s) => s.id === input.pinLast) : -1
  const full = (1 << n) - 1
  // labels[mask][last] = Pareto set
  const labels: Label[][][] = Array.from({ length: full + 1 }, () =>
    Array.from({ length: n }, () => []),
  )

  const push = (mask: number, last: number, candidate: Label): void => {
    const set = labels[mask]?.[last]
    if (!set) return
    for (const l of set) {
      if (l.time <= candidate.time && l.drive <= candidate.drive) return
    }
    for (let i = set.length - 1; i >= 0; i--) {
      const l = set[i] as Label
      if (candidate.time <= l.time && candidate.drive <= l.drive) set.splice(i, 1)
    }
    set.push(candidate)
  }

  const tryMove = (
    fromIndex: number,
    label: Label,
    mask: number,
    j: number,
    parent: Label['parent'],
  ) => {
    const stop = input.stops[j] as SolverStop
    const travel = cell(input.durations, fromIndex, stop.index)
    if (!Number.isFinite(travel)) return
    let arrive = label.time + travel
    if (stop.windowStart !== null && arrive < stop.windowStart) arrive = stop.windowStart
    if (stop.windowEnd !== null && arrive > stop.windowEnd) return
    const depart = arrive + stop.serviceSeconds
    if (depart > input.latestFinish) return
    const drive = label.drive + travel
    if (input.maxDriveSeconds !== null && drive > input.maxDriveSeconds) return
    push(mask | (1 << j), j, {
      time: depart,
      drive,
      metres: label.metres + cell(input.distances, fromIndex, stop.index),
      parent,
    })
  }

  const root: Label = { time: input.startAt, drive: 0, metres: 0, parent: null }
  for (let j = 0; j < n; j++) {
    if (pinFirst >= 0 && j !== pinFirst) continue
    tryMove(input.startIndex, root, 0, j, null)
  }
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue
      if (last === pinLast) continue // nothing follows the pinned-last stop
      const set = labels[mask]?.[last] ?? []
      for (let li = 0; li < set.length; li++) {
        const label = set[li] as Label
        const lastStop = input.stops[last] as SolverStop
        for (let j = 0; j < n; j++) {
          if (mask & (1 << j)) continue
          tryMove(lastStop.index, label, mask, j, { mask, last, label: li })
        }
      }
    }
  }

  // Pick the best terminal label.
  let best: { mask: number; last: number; label: number; objective: readonly number[] } | null =
    null
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue
      if (pinLast >= 0 && mask & (1 << pinLast) && last !== pinLast) continue
      const set = labels[mask]?.[last] ?? []
      const lastStop = input.stops[last] as SolverStop
      const tail =
        input.endIndex === null ? 0 : cell(input.durations, lastStop.index, input.endIndex)
      let mustGet = 0
      let count = 0
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) {
          count++
          if ((input.stops[j] as SolverStop).mustGet) mustGet++
        }
      }
      set.forEach((label, li) => {
        const finish = label.time + tail
        const drive = label.drive + tail
        if (finish > input.latestFinish) return
        if (input.maxDriveSeconds !== null && drive > input.maxDriveSeconds) return
        const o = objective({ mustGet, count, drive, finish })
        if (!best || compareObjective(o, best.objective) < 0) {
          best = { mask, last, label: li, objective: o }
        }
      })
    }
  }

  const order: string[] = []
  if (best) {
    let cursor: { mask: number; last: number; label: number } | null = best
    while (cursor) {
      order.unshift((input.stops[cursor.last] as SolverStop).id)
      const label = labels[cursor.mask]?.[cursor.last]?.[cursor.label] as Label
      cursor = label.parent
    }
  }
  const chosen = schedule(input, order)
  const assigned = new Set(order)
  const unassigned: Unassigned[] = input.stops
    .filter((s) => !assigned.has(s.id))
    .map((s) => cheapestInsertion(input, order, s.id))
  return { ...chosen, unassigned }
}

/**
 * Why a stop was left out: the lateness that inserting it at its cheapest place would cause
 * (§6.4, "You'd be about 25 minutes late"), or the finish or drive cap it would break.
 */
export function cheapestInsertion(
  input: SolverInput,
  order: readonly string[],
  id: string,
): Unassigned {
  let best: { late: number; overrun: number; drive: number; sched: Schedule } | null = null
  for (let pos = 0; pos <= order.length; pos++) {
    const candidate = [...order.slice(0, pos), id, ...order.slice(pos)]
    const s = schedule(input, candidate)
    const late = s.stops.reduce((m, st) => Math.max(m, st.lateSeconds), 0)
    const key = { late, overrun: s.overrunSeconds, drive: s.driveSeconds, sched: s }
    if (
      !best ||
      late < best.late ||
      (late === best.late &&
        (s.overrunSeconds < best.overrun ||
          (s.overrunSeconds === best.overrun && s.driveSeconds < best.drive)))
    ) {
      best = key
    }
  }
  if (!best) return { id, reason: 'window', lateSeconds: null }
  if (best.late > 0) return { id, reason: 'window', lateSeconds: best.late }
  if (best.overrun > 0) return { id, reason: 'latest_finish', lateSeconds: best.overrun }
  if (input.maxDriveSeconds !== null && best.drive > input.maxDriveSeconds) {
    return { id, reason: 'max_drive', lateSeconds: null }
  }
  return { id, reason: 'window', lateSeconds: null }
}

const EARTH_RADIUS_M = 6_371_000
const rad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle metres between two points. */
export function haversineMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The fallback matrix when router-gateway is off or down (card, "Does / does not"): straight line
 * × `factor` for distance, at `speedKmh` for time, labelled "estimate" by the caller.
 */
export function estimateMatrix(
  points: readonly { lat: number; lng: number }[],
  factor: number,
  speedKmh: number,
): { durations: number[][]; distances: number[][] } {
  const metresPerSecond = (speedKmh * 1000) / 3600
  const distances = points.map((a) => points.map((b) => Math.round(haversineMetres(a, b) * factor)))
  const durations = distances.map((row) => row.map((m) => Math.round(m / metresPerSecond)))
  return { durations, distances }
}
