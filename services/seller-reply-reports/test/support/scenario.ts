import { readdirSync, readFileSync } from 'node:fs'
import { aggregate } from '../../src/index'
import {
  ALL_ON,
  evidence,
  type SeedReason,
  seedListing,
  seedReport,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
} from './database'

// Synthetic scenarios for the fixture stages (aggregate, spread, privacy): listings, reporters
// and reports by alias, seeded as the migration superuser, then one aggregation as the pipeline.
// Every case is synthetic (`"synthetic": true`), built from the owner's examples
// (docs/decisions.md:156) and the too-good-to-be-true design §8.3: no recorded run holds a buyer's
// report, and none can (Nabvy never sees conversations).

export interface Scenario {
  synthetic: true
  listings: Record<string, { point?: [number, number] }>
  places?: Record<string, [number, number]>
  reporters: Record<
    string,
    { ageDays: number; verified?: boolean; group?: string; notUpheld?: number }
  >
  cluster?: string[]
  originals?: string[]
  gems?: string[]
  faults?: string[]
  reports: Array<{
    listing: string
    reporter: string
    hoursAgo: number
    reasons: SeedReason[]
    shippingOffered?: boolean
  }>
}

export interface Row {
  listing: string
  family: string
  scope: string
  level: string
  persons: number
  holdReason: string | null
}

export const CASES = new URL('../fixtures/cases/', import.meta.url)
export const readCase = (id: string, file: string) =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, CASES), 'utf8'))
/** The case folders of one stage: those named `<stage>-…`. */
export const casesOf = (stage: string) =>
  readdirSync(CASES)
    .filter((c) => c.startsWith(`${stage}-`))
    .sort()

export async function runScenario(
  t: TestDatabase,
  id: string,
  input: Scenario,
  now: Date,
): Promise<{ rows: Row[]; alias: Map<string, string> }> {
  if (input.synthetic !== true) throw new Error(`${id}: cases must be marked synthetic`)
  await setSwitches(t, ALL_ON)
  const listingIds = new Map<string, string>()
  for (const alias of Object.keys(input.listings))
    listingIds.set(alias, await seedListing(t, `${id}-${alias}`))
  const userIds = new Map<string, string>()
  let n = 0
  for (const [alias, r] of Object.entries(input.reporters)) {
    n += 1
    const userId = `0190f1d2-0000-7000-8000-${String(n).padStart(12, '0')}`
    userIds.set(alias, userId)
    await seedUser(t, userId, r.ageDays, now)
    if (r.notUpheld) {
      await t.sql(
        'insert into seller_reply_reports.reporter_stats (user_id, not_upheld) values ($1, $2)',
        [userId, r.notUpheld],
      )
    }
  }
  for (const r of input.reports) {
    await seedReport(t, {
      listingId: listingIds.get(r.listing) as string,
      userId: userIds.get(r.reporter) as string,
      createdAt: new Date(now.getTime() - r.hoursAgo * 3_600_000),
      reasons: r.reasons,
      shippingOffered: r.shippingOffered ?? null,
    })
  }
  const uuid = (alias: string) => listingIds.get(alias) as string
  const user = (alias: string) => userIds.get(alias) as string
  const deps = testDeps({
    unverified: Object.entries(input.reporters)
      .filter(([, r]) => r.verified === false)
      .map(([a]) => user(a)),
    groups: Object.fromEntries(
      Object.entries(input.reporters).map(([a, r]) => [user(a), r.group ?? user(a)]),
    ),
    clusters: input.cluster ? [{ key: `${id}-cluster`, members: input.cluster.map(uuid) }] : [],
    originals: (input.originals ?? []).map(uuid),
    gems: (input.gems ?? []).map(uuid),
    faults: (input.faults ?? []).map(uuid),
    listingPoints: Object.fromEntries(
      Object.entries(input.listings).flatMap(([a, l]) =>
        l.point ? [[uuid(a), { lat: l.point[0], lng: l.point[1] }]] : [],
      ),
    ),
    placePoints: Object.fromEntries(
      Object.entries(input.places ?? {}).map(([p, [lat, lng]]) => [p, { lat, lng }]),
    ),
  })
  await t.as('nabvy_pipeline', (q) =>
    aggregate(q, { listingIds: [...listingIds.values()] }, deps, { now }),
  )
  const alias = new Map([...listingIds].map(([a, id]) => [id, a]))
  const rows = (await evidence(t))
    .map((e) => ({
      listing: alias.get(String(e.listing_id)) as string,
      family: String(e.family),
      scope: String(e.scope),
      level: String(e.level),
      persons: Number(e.persons),
      holdReason: (e.hold_reason as string | null) ?? null,
    }))
    .sort((a, b) =>
      `${a.listing}|${a.family}|${a.scope}`.localeCompare(`${b.listing}|${b.family}|${b.scope}`),
    )
  return { rows, alias }
}
