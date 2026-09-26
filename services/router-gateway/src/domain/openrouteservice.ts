import type { RouterPoint } from '@nabvy/contracts/modules/router-gateway'
import { z } from 'zod'
import { ProviderResponseInvalid, type RouterProvider, safeBuild } from './provider'

// openrouteservice (HeiGIT) hosted API, V2 endpoints, `driving-car` profile. Shapes from its
// published documentation and API source (docs/api-reference/endpoints/matrix, JSONRouteResponse,
// JSONSummary, EngineInfo in GIScience/openrouteservice, read 2026-09-25):
// - Matrix V2: POST /v2/matrix/{profile}, body { locations: [[lon, lat]], sources, destinations,
//   metrics, units }; response { durations, distances, metadata.engine }. Durations are always
//   seconds; with units 'm' distances are metres; an unroutable pair is null.
// - Directions V2: POST /v2/directions/{profile}/json; response { routes: [{ summary: { distance,
//   duration } }], metadata.engine }. The summary omits empty values, so a missing distance or
//   duration is read as 0 (a zero-length route).
// - The key goes in the Authorization header, never the URL, so no log line can carry it.
// - engine.osm_date and engine.graph_date default to "0000-00-00T00:00:00Z" when unknown.
// Coordinates are sent [lon, lat] rounded to 6 decimals (about 0.1 m).

const PROFILE = 'driving-car'
const UNKNOWN_DATE = '0000-00-00T00:00:00Z'

const Engine = z
  .object({
    version: z.string().max(100).optional(),
    build_date: z.string().max(100).optional(),
    graph_date: z.string().max(100).optional(),
    osm_date: z.string().max(100).optional(),
  })
  .optional()
const Metadata = z.object({ engine: Engine }).optional()

const Cell = z.number().nonnegative().nullable()
const Matrix = z.array(z.array(Cell).max(1000)).max(1000)

const MatrixResponse = z.object({
  durations: Matrix,
  distances: Matrix,
  metadata: Metadata,
})

const DirectionsResponse = z.object({
  routes: z
    .array(
      z.object({
        summary: z.object({
          distance: z.number().nonnegative().optional(),
          duration: z.number().nonnegative().optional(),
        }),
      }),
    )
    .min(1)
    .max(10),
  metadata: Metadata,
})

const lonLat = (p: RouterPoint) => [round6(p.lon), round6(p.lat)]
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** The data build: the OSM extract date, else the graph date; null when neither is known. */
export function orsBuild(engine: z.infer<typeof Engine>): string | null {
  for (const value of [engine?.osm_date, engine?.graph_date]) {
    if (value && value !== UNKNOWN_DATE) {
      const build = safeBuild(value)
      if (build) return build
    }
  }
  return null
}

function parse<T extends z.ZodType>(schema: T, json: unknown): z.output<T> {
  const result = schema.safeParse(json)
  if (!result.success) throw new ProviderResponseInvalid(result.error.issues[0]?.message ?? 'shape')
  return result.data
}

function checkShape(
  rows: readonly (readonly unknown[])[],
  width: number,
  height: number,
  name: string,
) {
  if (rows.length !== height || rows.some((row) => row.length !== width)) {
    throw new ProviderResponseInvalid(`${name} is not ${height}×${width}`)
  }
}

export const openrouteservice: RouterProvider = {
  name: 'openrouteservice',
  authHeader: (key) => ({ Authorization: key }),
  tableRequest(sources, destinations) {
    const locations = [...sources, ...destinations].map(lonLat)
    return {
      method: 'POST',
      path: `/v2/matrix/${PROFILE}`,
      body: {
        locations,
        sources: sources.map((_, i) => i),
        destinations: destinations.map((_, i) => sources.length + i),
        metrics: ['distance', 'duration'],
        units: 'm',
      },
    }
  },
  parseTable(json, sourceCount, destinationCount) {
    const response = parse(MatrixResponse, json)
    checkShape(response.distances, destinationCount, sourceCount, 'distances')
    checkShape(response.durations, destinationCount, sourceCount, 'durations')
    return {
      build: orsBuild(response.metadata?.engine),
      distancesM: response.distances,
      durationsS: response.durations,
    }
  },
  routeRequest(points) {
    return {
      method: 'POST',
      path: `/v2/directions/${PROFILE}/json`,
      body: {
        coordinates: points.map(lonLat),
        units: 'm',
        instructions: false,
        geometry: false,
      },
    }
  },
  parseRoute(json) {
    const response = parse(DirectionsResponse, json)
    const summary = response.routes[0]?.summary
    return {
      build: orsBuild(response.metadata?.engine),
      distanceM: summary?.distance ?? 0,
      durationS: summary?.duration ?? 0,
    }
  },
}
