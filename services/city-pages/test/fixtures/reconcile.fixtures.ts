import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { newCityPagesFrom, type SeenRow } from '../../src/domain'

// Stage `reconcile`: which city pages `newCityPagesFrom` (called by `reconcileSeen`) adds, given
// what listing-ingest's `v_city_pages_seen` reports and the city pages already known. A recorded
// run's case reads the real dataset and reproduces the reverse-geocoded city page listing-ingest
// would report, exactly as `packages/db/README.md`'s fixture layout expects: real data where the
// case can use it, synthetic rows marked as such otherwise.

const SeenInput = z.strictObject({
  cityPageId: z.string(),
  townLabel: z.string().nullable(),
  firstSeenAt: z.iso.datetime(),
})
const Input = z.union([
  z.strictObject({ run: z.string() }),
  z.strictObject({
    synthetic: z.literal(true),
    seen: z.array(SeenInput),
    knownIds: z.array(z.string()),
  }),
])
const Expected = z.strictObject({
  additions: z.array(
    z.strictObject({ cityPageId: z.string(), name: z.string(), towns: z.array(z.string()) }),
  ),
})

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))

const seedIds: Set<string> = new Set(
  (
    JSON.parse(readFileSync(new URL('../../city-pages.seed.json', import.meta.url), 'utf8'))
      .cityPages as { cityPageId: string }[]
  ).map((c) => c.cityPageId),
)

const fixturesRoot = new URL('../../../../fixtures/listings/', import.meta.url)

/** Reproduces listing-ingest's `v_city_pages_seen` from a recorded run's dataset, one row per
 * distinct city page carried by a "listing" record, using its first occurrence's town label
 * (`sourceFields.search.location.reverse_geocode.city` — never `city_page.display_name`). */
function seenFromRun(run: string): { seen: SeenRow[]; knownIds: Set<string> } {
  const dataset = JSON.parse(
    readFileSync(new URL(`${run}/dataset.json`, fixturesRoot), 'utf8'),
  ) as Record<string, unknown>[]
  const runSummary = JSON.parse(
    readFileSync(new URL(`${run}/run-summary.json`, fixturesRoot), 'utf8'),
  ) as { collectedAt: string }
  const byId = new Map<string, string | null>()
  for (const row of dataset) {
    if (row.recordType !== 'listing') continue
    const rg = (
      (
        (row.sourceFields as Record<string, unknown> | undefined)?.search as
          | Record<string, unknown>
          | undefined
      )?.location as Record<string, unknown> | undefined
    )?.reverse_geocode as Record<string, unknown> | undefined
    const cityPage = rg?.city_page as { id?: string } | undefined
    if (!cityPage?.id || byId.has(cityPage.id)) continue
    byId.set(cityPage.id, (rg?.city as string | undefined) ?? null)
  }
  const seen = [...byId.entries()].map(([cityPageId, townLabel]) => ({
    cityPageId,
    townLabel,
    firstSeenAt: new Date(runSummary.collectedAt),
  }))
  return { seen, knownIds: seedIds }
}

const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

describe('reconcile', () => {
  it.each(cases)('$id', ({ input, expected }) => {
    const { seen, knownIds } =
      'run' in input
        ? seenFromRun(input.run)
        : {
            seen: input.seen.map((row) => ({ ...row, firstSeenAt: new Date(row.firstSeenAt) })),
            knownIds: new Set(input.knownIds),
          }
    const additions = newCityPagesFrom(seen, knownIds)
    expect(additions.map(({ cityPageId, name, towns }) => ({ cityPageId, name, towns }))).toEqual(
      expected.additions,
    )
  })
})
