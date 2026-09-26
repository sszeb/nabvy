import { describe, expect, it } from 'vitest'
import {
  compareObjective,
  estimateMatrix,
  objective,
  type SolverInput,
  type SolverStop,
  schedule,
  solve,
} from '../src/domain/solver'

// Card: "solver order matches a brute-force optimum up to 8 stops; 12 stops solve inside the
// test's time budget; hard windows honoured; a wait shows as a later departure, never a wait at
// the seller's; pin first/last".

/** A small deterministic PRNG (mulberry32) so a failing instance can be replayed by seed. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY_START = 1_790_000_000 // an arbitrary epoch second
const HOUR = 3600

function instance(
  seed: number,
  n: number,
  options: { pins?: boolean; maxDrive?: boolean } = {},
): SolverInput {
  const r = rng(seed)
  const points = Array.from({ length: n + 2 }, () => ({
    lat: 50.8 + r() * 0.3,
    lng: -1.1 + r() * 0.6,
  }))
  const { durations, distances } = estimateMatrix(points, 1.3, 40)
  const stops: SolverStop[] = Array.from({ length: n }, (_, i) => {
    const kind = r()
    let windowStart: number | null = null
    let windowEnd: number | null = null
    if (kind < 0.35) {
      const at = DAY_START + Math.floor(r() * 8 * HOUR)
      windowStart = at - 300
      windowEnd = at + 600
    } else if (kind < 0.7) {
      windowStart = DAY_START + Math.floor(r() * 6 * HOUR)
      windowEnd = windowStart + Math.floor(1 * HOUR + r() * 2 * HOUR)
    }
    return {
      id: `s${i}`,
      index: i + 1,
      windowStart,
      windowEnd,
      serviceSeconds: 600,
      mustGet: r() < 0.25,
    }
  })
  const openEnd = r() < 0.3
  return {
    stops,
    startIndex: 0,
    endIndex: openEnd ? null : n + 1,
    startAt: DAY_START,
    latestFinish: DAY_START + 9 * HOUR,
    maxDriveSeconds: options.maxDrive ? 3 * HOUR : null,
    pinFirst: options.pins && n > 1 && r() < 0.5 ? 's0' : null,
    pinLast: options.pins && n > 2 && r() < 0.5 ? 's1' : null,
    durations,
    distances,
  }
}

function objectiveOf(input: SolverInput, order: readonly string[]) {
  const s = schedule(input, order)
  if (!s.feasible) return null
  const set = new Set(order)
  const mustGet = input.stops.filter((st) => set.has(st.id) && st.mustGet).length
  return objective({ mustGet, count: order.length, drive: s.driveSeconds, finish: s.finishAt })
}

/** Every ordered subset that respects the pins, evaluated with hard windows: the true optimum. */
function bruteForce(input: SolverInput) {
  let best: readonly number[] | null = null
  const ids = input.stops.map((s) => s.id)
  const visit = (order: string[], rest: string[]) => {
    const ok =
      (!input.pinFirst || order.length === 0 || order[0] === input.pinFirst) &&
      (!input.pinLast ||
        !order.includes(input.pinLast) ||
        order[order.length - 1] === input.pinLast)
    if (ok) {
      const o = objectiveOf(input, order)
      if (o && (!best || compareObjective(o, best) < 0)) best = o
    }
    for (const id of rest) {
      if (input.pinLast && order.includes(input.pinLast)) break
      visit(
        [...order, id],
        rest.filter((x) => x !== id),
      )
    }
  }
  visit([], ids)
  return best
}

describe('solver', () => {
  it('matches a brute-force optimum on random instances of up to 8 stops', () => {
    let compared = 0
    for (let seed = 1; seed <= 60; seed++) {
      const n = 2 + (seed % 7) // 2..8
      const input = instance(seed, n, { pins: seed % 3 === 0, maxDrive: seed % 4 === 0 })
      const solution = solve(input)
      const got = objectiveOf(
        input,
        solution.stops.map((s) => s.id),
      )
      const want = bruteForce(input)
      expect(got, `seed ${seed}`).toEqual(want)
      if (want) compared++
    }
    expect(compared).toBeGreaterThan(40)
  })

  it('solves 12 stops inside the time budget', () => {
    const input = instance(4242, 12)
    const started = performance.now()
    const solution = solve(input)
    const ms = performance.now() - started
    expect(solution.stops.length + solution.unassigned.length).toBe(12)
    expect(ms).toBeLessThan(2000)
  })

  it('honours hard windows: every planned arrival sits inside its window, every miss is explained', () => {
    for (let seed = 100; seed < 130; seed++) {
      const input = instance(seed, 6)
      const solution = solve(input)
      const byId = new Map(input.stops.map((s) => [s.id, s]))
      for (const stop of solution.stops) {
        const w = byId.get(stop.id) as SolverStop
        if (w.windowStart !== null) expect(stop.arriveAt).toBeGreaterThanOrEqual(w.windowStart)
        if (w.windowEnd !== null) expect(stop.arriveAt).toBeLessThanOrEqual(w.windowEnd)
        expect(stop.lateSeconds).toBe(0)
      }
      expect(solution.finishAt).toBeLessThanOrEqual(input.latestFinish)
      for (const u of solution.unassigned) {
        expect(['window', 'latest_finish', 'max_drive']).toContain(u.reason)
      }
    }
  })

  it('a wait becomes a later departure from the previous stop, never a wait at the seller', () => {
    const points = [
      { lat: 50.8365, lng: -0.7792 },
      { lat: 50.7825, lng: -0.6746 },
      { lat: 50.7989, lng: -1.0912 },
    ]
    const { durations, distances } = estimateMatrix(points, 1.3, 40)
    const input: SolverInput = {
      stops: [
        {
          id: 'a',
          index: 1,
          windowStart: DAY_START + 2 * HOUR,
          windowEnd: DAY_START + 3 * HOUR,
          serviceSeconds: 600,
          mustGet: false,
        },
        {
          id: 'b',
          index: 2,
          windowStart: null,
          windowEnd: null,
          serviceSeconds: 600,
          mustGet: false,
        },
      ],
      startIndex: 0,
      endIndex: null,
      startAt: DAY_START,
      latestFinish: DAY_START + 9 * HOUR,
      maxDriveSeconds: null,
      durations,
      distances,
    }
    const solution = solve(input)
    const a = solution.stops.find((s) => s.id === 'a')
    expect(a).toBeDefined()
    if (!a) return
    expect(a.arriveAt).toBe(DAY_START + 2 * HOUR)
    expect(a.waitSeconds).toBeGreaterThan(0)
    // Leaving later absorbs the whole wait: leave + leg = arrival, exactly at the window's start.
    expect(a.leaveAt + a.legSeconds).toBe(a.arriveAt)
    expect(a.leaveAt).toBeGreaterThan(DAY_START)
  })

  it('pins the first and last stop', () => {
    for (let seed = 200; seed < 215; seed++) {
      const input = { ...instance(seed, 5), pinFirst: 's3', pinLast: 's1' }
      const solution = solve(input)
      const order = solution.stops.map((s) => s.id)
      if (order.length > 0) expect(order[0]).toBe('s3')
      if (order.includes('s1')) expect(order[order.length - 1]).toBe('s1')
    }
  })

  it('"My order" reports lateness instead of dropping a stop', () => {
    const input = instance(7, 4)
    const late = {
      ...input,
      stops: input.stops.map((s, i) =>
        i === 0 ? { ...s, windowStart: DAY_START, windowEnd: DAY_START + 60 } : s,
      ),
    }
    const s = schedule(late, ['s1', 's2', 's3', 's0'])
    expect(s.stops).toHaveLength(4)
    expect(s.stops[3]?.lateSeconds).toBeGreaterThan(0)
    expect(s.feasible).toBe(false)
  })
})
