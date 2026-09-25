import { readdirSync, readFileSync } from 'node:fs'
import type { PickupRoutesWindow } from '@nabvy/contracts/modules/pickup-routes'
import { describe, expect, it } from 'vitest'
import {
  estimateMatrix,
  londonToEpoch,
  type SolverInput,
  schedule,
  solve,
  windowBounds,
} from '../../src/domain'

// Stage "plan": synthetic days around Chichester (the team's rtx3090 hunt area, search-map-routes.md
// §9.4), solved on the estimate matrix (straight line × 1.3 at the config speed), so the cases
// need no router and no database. Each case states the order it expects, which stops must be
// left out and why, and invariants every plan keeps (windows honoured, waits shown as later
// departures, pins). notes.md in each case folder gives the reasoning.

interface Stop {
  id: string
  point: { lat: number; lng: number }
  window: PickupRoutesWindow
  serviceMinutes?: number
  mustGet?: boolean
}
interface Input {
  synthetic: true
  day: string
  start: { lat: number; lng: number }
  end: { lat: number; lng: number } | null
  startTime: string
  latestFinish: string
  maxDriveMinutes?: number | null
  mode?: 'optimised' | 'my_order'
  order?: string[]
  pinFirst?: string | null
  pinLast?: string | null
  stops: Stop[]
}
interface Expected {
  order: string[]
  unassigned: { id: string; reason: string }[]
  /** Any stop whose arrival must equal its window start (a wait absorbed as a later departure). */
  arrivesAtWindowStart?: string[]
  late?: Record<string, boolean>
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()

describe('plan', () => {
  for (const id of cases) {
    it(id, () => {
      const input = read(new URL(`${id}/input.json`, CASES)) as Input
      const expected = read(new URL(`${id}/expected.json`, CASES)) as Expected
      const points = [
        input.start,
        ...input.stops.map((s) => s.point),
        ...(input.end ? [input.end] : []),
      ]
      const { durations, distances } = estimateMatrix(points, 1.3, 40)
      const dayStart = londonToEpoch(input.day, input.startTime)
      const latestFinish = londonToEpoch(input.day, input.latestFinish)
      const solverInput: SolverInput = {
        stops: input.stops.map((s, i) => {
          const b = windowBounds(input.day, s.window, dayStart, latestFinish)
          return {
            id: s.id,
            index: i + 1,
            windowStart: b.start,
            windowEnd: b.end,
            serviceSeconds: (s.serviceMinutes ?? 10) * 60,
            mustGet: s.mustGet ?? false,
          }
        }),
        startIndex: 0,
        endIndex: input.end ? points.length - 1 : null,
        startAt: dayStart,
        latestFinish,
        maxDriveSeconds: input.maxDriveMinutes ? input.maxDriveMinutes * 60 : null,
        pinFirst: input.pinFirst ?? null,
        pinLast: input.pinLast ?? null,
        durations,
        distances,
      }
      const solution =
        input.mode === 'my_order'
          ? { ...schedule(solverInput, input.order ?? []), unassigned: [] }
          : solve(solverInput)
      expect(solution.stops.map((s) => s.id)).toEqual(expected.order)
      expect(solution.unassigned.map((u) => ({ id: u.id, reason: u.reason }))).toEqual(
        expected.unassigned,
      )
      for (const id of expected.arrivesAtWindowStart ?? []) {
        const stop = solution.stops.find((s) => s.id === id)
        const w = solverInput.stops.find((s) => s.id === id)
        expect(stop?.arriveAt).toBe(w?.windowStart)
        expect(stop && stop.leaveAt + stop.legSeconds).toBe(stop?.arriveAt)
      }
      for (const [id, late] of Object.entries(expected.late ?? {})) {
        const stop = solution.stops.find((s) => s.id === id)
        expect((stop?.lateSeconds ?? 0) > 0).toBe(late)
      }
      if (input.mode !== 'my_order') {
        for (const stop of solution.stops) expect(stop.lateSeconds).toBe(0)
        expect(solution.finishAt).toBeLessThanOrEqual(latestFinish)
      }
    })
  }
})
