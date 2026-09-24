// Database access: this module's own schema, relist_merge, and the published views it reads:
// listing-ingest's v_listings and detail-evidence's v_fingerprints and v_text, as nabvy_pipeline
// inside withPipeline.
import { vFingerprints, vText } from '@nabvy/db/schema/detail-evidence'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import { groups, members } from '@nabvy/db/schema/relist-merge'
import { eq, inArray, sql } from 'drizzle-orm'
import type { Evidence, ListingFacts, Step } from '../domain'

// A type query rather than a separate statement, as in detail-evidence: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows
const ms = (value: Date | string) => new Date(value).getTime()
const iso = (value: Date | string) => new Date(value).toISOString()

/** Serialises merge calls, so two deliveries never open two groups for one pair. */
export async function lockMerges(q: Queryable): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtextextended('relist-merge', 0))`)
}

/** listing-ingest's facts for these listings (missing ones are left out). */
export async function selectFacts(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, ListingFacts>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({
      id: vListings.id,
      source: vListings.source,
      cityPageId: vListings.cityPageId,
      listedAt: vListings.listedAt,
      firstFetchedAt: vListings.firstFetchedAt,
      lastSeenAt: vListings.lastSeenAt,
    })
    .from(vListings)
    .where(inArray(vListings.id, listingIds))
  return new Map(
    rows.map((row) => {
      const firstFetched = ms(row.firstFetchedAt)
      const from = row.listedAt ? Math.min(ms(row.listedAt), firstFetched) : firstFetched
      return [
        row.id,
        {
          listingId: row.id,
          source: row.source,
          cityPageId: row.cityPageId,
          fromMs: from,
          toMs: Math.max(ms(row.lastSeenAt), from),
          firstFetchedAt: iso(row.firstFetchedAt),
        },
      ]
    }),
  )
}

/**
 * Description evidence: other listings whose current description has the same fingerprint as an
 * arriving listing's, on the same source and city page. Descriptions shorter than `minChars`
 * (whitespace collapsed and trimmed) never match. Window and seller-key rules run in the domain.
 */
export async function selectDescriptionEvidence(
  q: Queryable,
  listingIds: string[],
  minChars: number,
): Promise<Evidence[]> {
  if (listingIds.length === 0) return []
  const ids = sql.join(
    listingIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
  const result = await q.execute(sql`
    with arriving as (
      select l.id, l.source, l.city_page_id, f.fingerprint
      from ${vListings} l
      join ${vFingerprints} f on f.listing_id = l.id
      join ${vText} t on t.listing_id = f.listing_id and t.evidence_hash = f.evidence_hash
      where l.id in (${ids})
        and l.city_page_id is not null
        and char_length(btrim(regexp_replace(t.description, '\\s+', ' ', 'g'))) >= ${minChars}
    )
    select distinct a.id as listing_id, o.listing_id as other_listing_id
    from arriving a
    join ${vFingerprints} o on o.fingerprint = a.fingerprint and o.listing_id <> a.id
    join ${vListings} ol on ol.id = o.listing_id
      and ol.source = a.source and ol.city_page_id = a.city_page_id
    order by 1, 2
  `)
  return rowsOf<{ listing_id: string; other_listing_id: string }>(result).map((row) => ({
    listingId: row.listing_id,
    otherListingId: row.other_listing_id,
    basis: 'description',
  }))
}

/** The group of each listing that has one, and every member of those groups. */
export async function selectGroups(
  q: Queryable,
  listingIds: string[],
): Promise<{ groupOf: Map<string, string>; membersOf: Map<string, string[]> }> {
  const groupOf = new Map<string, string>()
  const membersOf = new Map<string, string[]>()
  if (listingIds.length === 0) return { groupOf, membersOf }
  const rows = await q
    .select({ groupId: members.groupId, listingId: members.listingId })
    .from(members)
    .where(
      inArray(
        members.groupId,
        q
          .select({ groupId: members.groupId })
          .from(members)
          .where(inArray(members.listingId, listingIds)),
      ),
    )
    .orderBy(members.groupId, members.listingId)
  for (const row of rows) {
    groupOf.set(row.listingId, row.groupId)
    membersOf.set(row.groupId, [...(membersOf.get(row.groupId) ?? []), row.listingId])
  }
  return { groupOf, membersOf }
}

/** Writes the planned steps; returns how many memberships were written. */
export async function applySteps(q: Queryable, steps: Step[]): Promise<number> {
  const opened = new Map<string, string>()
  let written = 0
  for (const step of steps) {
    if (step.kind === 'open') {
      const [group] = await q.insert(groups).values({}).returning({ id: groups.id })
      if (!group) throw new Error('relist-merge: a group was not created')
      opened.set(step.ref, group.id)
      const rows = await q
        .insert(members)
        .values([
          {
            groupId: group.id,
            listingId: step.origin.listingId,
            basis: 'origin',
            matchedListingId: null,
            inputFetchedAt: new Date(step.origin.firstFetchedAt),
          },
          {
            groupId: group.id,
            listingId: step.member.listingId,
            basis: step.basis,
            matchedListingId: step.origin.listingId,
            inputFetchedAt: new Date(step.member.firstFetchedAt),
          },
        ])
        .onConflictDoNothing({ target: members.listingId })
        .returning({ id: members.id })
      written += rows.length
      continue
    }
    const groupId = 'groupId' in step.group ? step.group.groupId : opened.get(step.group.ref)
    if (!groupId) throw new Error('relist-merge: a planned group was not opened')
    const rows = await q
      .insert(members)
      .values({
        groupId,
        listingId: step.member.listingId,
        basis: step.basis,
        matchedListingId: step.matched,
        inputFetchedAt: new Date(step.member.firstFetchedAt),
      })
      .onConflictDoNothing({ target: members.listingId })
      .returning({ id: members.id })
    written += rows.length
  }
  return written
}

/**
 * Removes the groups that hold any of these listings, with all their members (erasure dissolves
 * the group: its other listings stand alone again, the card's "When off" outcome).
 */
export async function deleteGroupsOf(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  const removed = await q
    .delete(groups)
    .where(
      inArray(
        groups.id,
        q
          .select({ groupId: members.groupId })
          .from(members)
          .where(inArray(members.listingId, listingIds)),
      ),
    )
    .returning({ id: groups.id })
  return removed.length
}

/** Every member of one group (tests and backtests). */
export function selectMembers(q: Queryable, groupId: string) {
  return q.select().from(members).where(eq(members.groupId, groupId))
}
