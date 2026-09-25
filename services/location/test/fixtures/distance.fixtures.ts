import { readdirSync, readFileSync } from 'node:fs'
import type { LocationDistanceBasis } from '@nabvy/contracts/modules/location'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { distanceKm } from '../../src'

// Stage `distance`: the card's own tests (docs/design/modules/location.md, "Tests and fixtures")
// — the recorded run's spread of distances, rounding, and the city-page fallback basis — run
// through the real, pure distanceKm(). No database: distanceKm() is a plain TypeScript function
// (README.md, "Job").

const Point = z.strictObject({ lat: z.number(), lng: z.number() })
const Input = z.strictObject({
  synthetic: z.boolean(),
  source: z.string().min(1),
  basis: z.enum(['coordinates', 'city_page']),
  centre: Point.optional(),
  points: z
    .array(z.strictObject({ label: z.string(), lat: z.number(), lng: z.number() }))
    .optional(),
  cases: z.array(z.strictObject({ from: Point, to: Point })).optional(),
})
const Expected = z.strictObject({
  distancesKm: z.array(z.number()),
  countOver65Raw: z.number().int().optional(),
})

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

describe('distance', () => {
  it.each(cases)('$id', ({ input, expected }) => {
    const basis = input.basis as LocationDistanceBasis
    const centre = input.centre
    const pairs = centre
      ? (input.points ?? []).map((point) => ({ from: centre, to: point }))
      : (input.cases ?? [])
    const results = pairs.map((pair) => distanceKm(pair.from, pair.to, basis))
    expect(results.map((r) => r.km)).toEqual(expected.distancesKm)
    for (const result of results) expect(result.basis).toBe(basis)
    if (expected.countOver65Raw !== undefined) {
      // The card's own claim is about the *unrounded* distance, which distanceKm() does not
      // expose; recomputed here the same way the recorded-run case's expected.json was built.
      const R = 6371
      const toRad = (deg: number) => (deg * Math.PI) / 180
      const rawKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
        const dLat = toRad(b.lat - a.lat)
        const dLng = toRad(b.lng - a.lng)
        const x =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
      }
      const over65 = pairs.filter((pair) => rawKm(pair.from, pair.to) > 65).length
      expect(over65).toBe(expected.countOver65Raw)
    }
  })
})
