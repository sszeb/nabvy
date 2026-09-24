// Public API of the city-pages module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/city-pages' only, never from its internals.
import { record } from '@nabvy/audit-log'
import { CITY_PAGES_AREA_KM, CITY_PAGES_EVENT_BATCH_SIZE } from '@nabvy/config/modules/city-pages'
import { createEvent, type EventEnvelope } from '@nabvy/contracts'
import {
  type CityPagesAreaMembership,
  type CityPagesCentre,
  type CityPagesCityPage,
  events,
} from '@nabvy/contracts/modules/city-pages'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import { CityPagesRefused, newCityPagesFrom } from './domain'
import {
  insertCardCityPages,
  selectAreaMembership,
  selectCentre,
  selectCentres,
  selectCityPages,
  selectKnownCityPageIds,
  selectQualifyingSearch,
  selectSeen,
  upsertVerifiedCentre,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/city-pages'
export { CityPagesRefused } from './domain'

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function changedEvents(cityPageIds: string[]): EventEnvelope[] {
  return batches(cityPageIds, CITY_PAGES_EVENT_BATCH_SIZE).map(
    (batch, index) =>
      createEvent(
        events,
        'city-pages.changed',
        1,
        { cityPageIds: batch },
        { key: `city-pages.changed:${batch[0]}:${index}` },
      ) as EventEnvelope,
  )
}

/**
 * Adds any city page listing-ingest has seen (`v_city_pages_seen`) that this module does not
 * know yet. Never parses names or town slugs: a new page's `name` and `towns` are exactly the
 * raw town label listing-ingest reported, and it gets no coordinate (`coord_source = 'card'`).
 * Called by an ops job, not on an event: the card lists no event input, so there is nothing to
 * make this idempotent by replay other than the table's own primary key, which `onConflictDoNothing`
 * already gives it. Returns the `city-pages.changed` envelopes for the caller to publish after
 * its transaction commits.
 */
export async function reconcileSeen(q: Queryable): Promise<{ event: EventEnvelope[] }> {
  if ((await state(q, 'city-pages')) === 'off' || !(await isOn(q, 'pipeline'))) return { event: [] }
  const [known, seen] = await Promise.all([selectKnownCityPageIds(q), selectSeen(q)])
  const additions = newCityPagesFrom(seen, known)
  const insertedIds = await insertCardCityPages(q, additions)
  return { event: changedEvents(insertedIds) }
}

/**
 * Binds verification: a qualifying newest-first, non-degraded search of `jobId` for `cityPageId`
 * (run-coverage's `v_search_coverage`/`v_search_controls`) marks the centre verified and active,
 * and records Facebook's reported centre. The caller has already checked the admin session;
 * `verify` itself writes the audit-log entry in the same transaction (rule: "admin verification
 * (audited)"), as switches' `set()` does. Throws `CityPagesRefused`:
 * - `city-pages.already_verified` if the centre is already verified (verify() is not a re-run);
 * - `city-pages.no_qualifying_search` if the job has no newest-first, non-degraded search of it.
 */
export async function verify(
  q: Queryable,
  input: { cityPageId: string; jobId: number; actorUserId: string },
): Promise<{ event: EventEnvelope[] }> {
  if ((await state(q, 'city-pages')) === 'off' || !(await isOn(q, 'pipeline'))) return { event: [] }
  const existing = await selectCentre(q, input.cityPageId)
  if (existing?.verified) {
    throw new CityPagesRefused(
      'city-pages.already_verified',
      `${input.cityPageId} is already verified`,
    )
  }
  const qualifying = await selectQualifyingSearch(q, input.jobId, input.cityPageId)
  if (!qualifying) {
    throw new CityPagesRefused(
      'city-pages.no_qualifying_search',
      `job ${input.jobId} has no qualifying newest-first search of ${input.cityPageId}`,
    )
  }
  await upsertVerifiedCentre(q, {
    cityPageId: input.cityPageId,
    verifiedByJob: input.jobId,
    reportedLat: qualifying.reportedLat,
    reportedLng: qualifying.reportedLng,
    areaKm: existing?.areaKm ?? CITY_PAGES_AREA_KM,
  })
  await record(q, {
    actorUserId: input.actorUserId,
    action: 'city-pages.verified',
    target: `city-page:${input.cityPageId}`,
    after: { jobId: input.jobId, searchIndex: qualifying.searchIndex },
  })
  return { event: changedEvents([input.cityPageId]) }
}

/** Every Facebook city page known (`city_pages.v_city_pages`). */
export async function listCityPages(q: Queryable): Promise<CityPagesCityPage[]> {
  const rows = await selectCityPages(q)
  return rows.map((row) => ({
    cityPageId: row.cityPageId,
    name: row.name,
    towns: row.towns,
    lat: row.lat,
    lng: row.lng,
    coordSource: row.coordSource as CityPagesCityPage['coordSource'],
    firstSeenAt: row.firstSeenAt,
  }))
}

/** Every candidate or verified search centre (`city_pages.v_centres`). */
export async function listCentres(q: Queryable): Promise<CityPagesCentre[]> {
  const rows = await selectCentres(q)
  return rows.map((row) => ({
    cityPageId: row.cityPageId,
    active: row.active,
    verified: row.verified,
    verifiedByJob: row.verifiedByJob,
    country: row.country as CityPagesCentre['country'],
    currency: row.currency as CityPagesCentre['currency'],
    reportedLat: row.reportedLat,
    reportedLng: row.reportedLng,
    areaKm: row.areaKm,
  }))
}

/** Every city page's nearest active centre and distance (`city_pages.v_area_membership`). */
export async function listAreaMembership(q: Queryable): Promise<CityPagesAreaMembership[]> {
  const rows = await selectAreaMembership(q)
  return rows.map((row) => ({
    cityPageId: row.cityPageId,
    centreId: row.centreId,
    distanceKm: row.distanceKm,
    inArea: row.inArea,
  }))
}
