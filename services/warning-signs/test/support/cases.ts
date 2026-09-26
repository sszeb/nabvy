import { readdirSync, readFileSync } from 'node:fs'
import { evaluate } from '../../src'
import { observe, type SeedListing, seed, type TestDatabase } from './database'

// One fixture case run end to end: its listings seeded into the upstream modules' tables (from a
// recorded run's rows, or synthetic rows), then this module over them, as nabvy_pipeline. Each
// case checks, per listing, the codes `v_facts` shows (`code` or `code:reason`, sorted).

/** A fixture case's input (README.md, "Fixtures and pass rate"). */
export type CaseInput =
  | {
      /** `facebook/runs/<date>-<runId>` under fixtures/listings. */
      run: string
      /** Source listing IDs to take; all listing rows when absent. */
      listingIds?: string[]
    }
  | {
      synthetic: true
      /** What the rows are built from. */
      source: string
      listings: SeedListing[]
    }

type Json = Record<string, unknown>

const CASES = new URL('../fixtures/cases/', import.meta.url)
const FIXTURES = new URL('../../../../fixtures/listings/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))

export const caseIds = (): string[] => readdirSync(CASES).sort()

/** A stable listing UUID for the n-th recorded row. */
const uuidOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

/** The recorded run's listing rows as seeded listings, keyed by source listing ID. */
export function recordedListings(run: string, only?: string[]): Map<string, SeedListing> {
  const rows = (read(new URL(`${run}/dataset.json`, FIXTURES)) as Json[]).filter(
    (r) => r.recordType === 'listing',
  )
  const out = new Map<string, SeedListing>()
  for (const [i, r] of rows.entries()) {
    const sid = String(r.listingId)
    if (only && !only.includes(sid)) continue
    out.set(sid, {
      id: uuidOf(i + 1),
      title: String(r.title ?? ''),
      description: (r.description as string | null) ?? null,
      descriptionStatus: r.descriptionStatus as SeedListing['descriptionStatus'],
      priceMinor: Math.round(Number((r.price as Json | null)?.amount ?? r.price ?? 0) * 100),
      cautions: [],
    })
  }
  return out
}

/** Runs one case on `t` and returns what it observed beside what the case expects. */
export async function runCase(
  t: TestDatabase,
  id: string,
): Promise<{ observed: Record<string, string[]>; expected: Record<string, string[]> }> {
  const input = read(new URL(`${id}/input.json`, CASES)) as CaseInput
  const expected = (
    read(new URL(`${id}/expected.json`, CASES)) as { listings: Record<string, string[]> }
  ).listings
  const keyed =
    'run' in input
      ? recordedListings(input.run, input.listingIds)
      : new Map(input.listings.map((l) => [l.id, l]))
  await seed(t, [...keyed.values()])
  const result = await t.as('nabvy_pipeline', (q) =>
    evaluate(q, { listingIds: [...keyed.values()].map((l) => l.id), now: new Date() }),
  )
  if (!result.ok) throw new Error(result.error.message)
  const facts = await observe(t)
  const observed: Record<string, string[]> = {}
  for (const key of Object.keys(expected)) {
    const listing = keyed.get(key)
    observed[key] = listing ? (facts[listing.id] ?? []) : ['<not in case>']
  }
  return { observed, expected }
}
