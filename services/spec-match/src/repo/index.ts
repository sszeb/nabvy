// Database access: this module's own schema, spec_match; want-manager's v_wants;
// listing-assessment's v_assessments; parts-record's v_records and v_parts; listing-ingest's
// v_listings and v_sightings; noise-filter's v_classifications and app.v_noise_filter_reasons.
// Pipeline reads run as nabvy_pipeline inside withPipeline; `selectResults` and
// `selectNoiseReasonsForApp` run as nabvy_app inside withUser.

import type { SpecMatchCriterionResult } from '@nabvy/contracts/modules/spec-match'
import type { WantManagerCriterion } from '@nabvy/contracts/modules/want-manager'
import { vAssessments } from '@nabvy/db/schema/listing-assessment'
import { vListings, vSightings } from '@nabvy/db/schema/listing-ingest'
import { vClassifications, vNoiseFilterReasons } from '@nabvy/db/schema/noise-filter'
import { vParts, vRecords } from '@nabvy/db/schema/parts-record'
import { matches, vSpecMatchResults } from '@nabvy/db/schema/spec-match'
import { vWants } from '@nabvy/db/schema/want-manager'
import { and, desc, eq, gte, inArray, notInArray, or, sql } from 'drizzle-orm'
import type { AssessmentInput, ListingInput, PartInput, WantInput } from '../domain'

// A type query rather than a separate statement, as in parts-record: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString())

// ---------------------------------------------------------------------------------------------
// Wants
// ---------------------------------------------------------------------------------------------

export interface StoredWant extends WantInput {
  id: string
  active: boolean
}

const wantColumns = {
  id: vWants.id,
  centreId: vWants.centreId,
  lat: vWants.lat,
  lng: vWants.lng,
  radiusKm: vWants.radiusKm,
  priceCapMinor: vWants.priceCapMinor,
  currency: vWants.currency,
  active: vWants.active,
  deliveryMethods: vWants.deliveryMethods,
  criteria: vWants.criteria,
}

const toWant = (r: {
  id: string
  centreId: string | null
  lat: number
  lng: number
  radiusKm: number
  priceCapMinor: number | null
  currency: string
  active: boolean
  deliveryMethods: string[]
  criteria: unknown
}): StoredWant => ({
  id: r.id,
  centreId: r.centreId,
  point: { lat: r.lat, lng: r.lng },
  radiusKm: r.radiusKm,
  priceCapMinor: r.priceCapMinor === null ? null : Number(r.priceCapMinor),
  currency: r.currency,
  active: r.active,
  deliveryMethods: r.deliveryMethods,
  criteria: r.criteria as WantManagerCriterion[],
})

/** Every active want (want-manager's `v_wants`; empty while that module is off). */
export async function selectActiveWants(q: Queryable): Promise<StoredWant[]> {
  const rows = await q
    .select(wantColumns)
    .from(vWants)
    .where(eq(vWants.active, true))
    .orderBy(vWants.id)
  return rows.map(toWant)
}

/** These wants as `v_wants` shows them, active or not. */
export async function selectWants(q: Queryable, wantIds: string[]): Promise<StoredWant[]> {
  if (wantIds.length === 0) return []
  const rows = await q.select(wantColumns).from(vWants).where(inArray(vWants.id, wantIds))
  return rows.map(toWant)
}

// ---------------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------------

/** Listing IDs first fetched at or after `since` (the backfill window), oldest first. */
export async function selectListingIdsSince(q: Queryable, since: Date): Promise<string[]> {
  const rows = await q
    .select({ id: vListings.id })
    .from(vListings)
    .where(gte(vListings.firstFetchedAt, since))
    .orderBy(vListings.firstFetchedAt, vListings.id)
  return rows.map((r) => r.id)
}

/**
 * Candidates for a spec search: listings whose included parts could meet one of the criteria,
 * not sold or hidden, most recently seen first, at most `limit`.
 */
export async function selectCandidateIds(
  q: Queryable,
  criteria: readonly WantManagerCriterion[],
  limit: number,
): Promise<string[]> {
  const conditions = criteria.map((c) => {
    if (c.partType === 'ram') return eq(vParts.partType, 'ram_size')
    if (c.partType === 'storage') return eq(vParts.partType, 'storage_size')
    // GPUs and CPUs: every part of the type; the rules decide the fit.
    return eq(vParts.partType, c.partType)
  })
  const rows = await q
    .selectDistinct({ id: vListings.id, seen: vListings.lastSeenAt })
    .from(vParts)
    .innerJoin(vListings, eq(vListings.id, vParts.listingId))
    .where(
      and(
        eq(vParts.inclusion, 'offered'),
        eq(vParts.rejected, false),
        notInArray(vListings.availability, ['sold', 'hidden']),
        or(...conditions),
      ),
    )
    .orderBy(desc(vListings.lastSeenAt), vListings.id)
    .limit(limit)
  return rows.map((r) => r.id)
}

/** Card facts a search sorts by. */
export interface CardFacts {
  listingId: string
  priceMinor: number | null
  currency: string | null
  listedAt: string | null
}

type Exclusion = AssessmentInput['exclusions'][number]
type Coverage = { fullDescription?: boolean }

/**
 * Everything the rules read about each listing's current version: listing-ingest's card and
 * search sightings, the current version (the latest assessment, else the latest parts record),
 * its parts and its assessment. Listings with no parts record are left out: nothing to match yet.
 */
export async function selectListings(
  q: Queryable,
  listingIds: string[],
): Promise<{ inputs: ListingInput[]; cards: Map<string, CardFacts> }> {
  const cards = new Map<string, CardFacts>()
  if (listingIds.length === 0) return { inputs: [], cards }
  const listingRows = await q
    .select({
      id: vListings.id,
      cardHash: vListings.cardHash,
      priceMinor: vListings.priceMinor,
      currency: vListings.currency,
      listedAt: vListings.listedAt,
      deliveryTypes: vListings.deliveryTypes,
    })
    .from(vListings)
    .where(inArray(vListings.id, listingIds))
  if (listingRows.length === 0) return { inputs: [], cards }
  const ids = listingRows.map((r) => r.id)

  const assessmentRows = await q
    .select({
      listingId: vAssessments.listingId,
      evidenceHash: vAssessments.evidenceHash,
      kind: vAssessments.kind,
      container: vAssessments.container,
      gpuState: vAssessments.gpuState,
      coverage: vAssessments.coverage,
      exclusions: vAssessments.exclusions,
      assessedAt: vAssessments.assessedAt,
    })
    .from(vAssessments)
    .where(inArray(vAssessments.listingId, ids))
    .orderBy(vAssessments.listingId, desc(vAssessments.assessedAt))
  const assessmentOf = new Map<string, (typeof assessmentRows)[number]>()
  for (const r of assessmentRows)
    if (!assessmentOf.has(r.listingId)) assessmentOf.set(r.listingId, r)

  const recordRows = await q
    .select({
      listingId: vRecords.listingId,
      evidenceHash: vRecords.evidenceHash,
      kind: vRecords.kind,
      recordedAt: vRecords.recordedAt,
    })
    .from(vRecords)
    .where(inArray(vRecords.listingId, ids))
    .orderBy(vRecords.listingId, desc(vRecords.recordedAt))
  const recordOf = new Map<string, (typeof recordRows)[number]>()
  for (const r of recordRows) if (!recordOf.has(r.listingId)) recordOf.set(r.listingId, r)

  // The current version: the assessed one when listing-assessment has one, else the latest record.
  const versionOf = new Map<string, string>()
  for (const id of ids) {
    const assessed = assessmentOf.get(id)
    const recorded = recordOf.get(id)
    if (
      assessed &&
      recordRows.some((r) => r.listingId === id && r.evidenceHash === assessed.evidenceHash)
    ) {
      versionOf.set(id, assessed.evidenceHash)
    } else if (recorded) {
      versionOf.set(id, recorded.evidenceHash)
    }
  }
  const current = [...versionOf.keys()]
  if (current.length === 0) return { inputs: [], cards }

  const partRows = await q
    .select({
      listingId: vParts.listingId,
      evidenceHash: vParts.evidenceHash,
      seq: vParts.seq,
      partType: vParts.partType,
      catalogueId: vParts.catalogueId,
      attrs: vParts.attrs,
      inclusion: vParts.inclusion,
      rejected: vParts.rejected,
      source: vParts.source,
      extractor: vParts.extractor,
      quote: vParts.quote,
      start: vParts.start,
      end: vParts.end,
      conflict: vParts.conflict,
    })
    .from(vParts)
    .where(inArray(vParts.listingId, current))
    .orderBy(vParts.listingId, vParts.seq)
  const partsOf = new Map<string, PartInput[]>()
  for (const p of partRows) {
    if (versionOf.get(p.listingId) !== p.evidenceHash) continue
    const list = partsOf.get(p.listingId) ?? []
    list.push({ ...p, attrs: (p.attrs ?? {}) as PartInput['attrs'] } as PartInput)
    partsOf.set(p.listingId, list)
  }

  const sightingRows = await q
    .select({
      listingId: vSightings.listingId,
      terms: vSightings.terms,
      centreIds: vSightings.centreIds,
    })
    .from(vSightings)
    .where(and(inArray(vSightings.listingId, current), eq(vSightings.kind, 'search')))
  const sightingsOf = new Map<string, { terms: string[]; centreIds: string[] }[]>()
  for (const s of sightingRows) {
    const list = sightingsOf.get(s.listingId) ?? []
    list.push({ terms: s.terms, centreIds: s.centreIds })
    sightingsOf.set(s.listingId, list)
  }

  const inputs: ListingInput[] = []
  for (const l of listingRows) {
    cards.set(l.id, {
      listingId: l.id,
      priceMinor: l.priceMinor === null ? null : Number(l.priceMinor),
      currency: l.currency,
      listedAt: iso(l.listedAt),
    })
    const evidenceHash = versionOf.get(l.id)
    if (!evidenceHash) continue
    const a = assessmentOf.get(l.id)
    const assessment: AssessmentInput | null =
      a && a.evidenceHash === evidenceHash
        ? {
            container: a.container,
            gpuState: a.gpuState,
            fullDescription: (a.coverage as Coverage).fullDescription === true,
            exclusions: a.exclusions as Exclusion[],
          }
        : null
    inputs.push({
      listingId: l.id,
      evidenceHash,
      cardHash: l.cardHash,
      kind: (a?.evidenceHash === evidenceHash ? a.kind : null) ?? recordOf.get(l.id)?.kind ?? null,
      priceMinor: l.priceMinor === null ? null : Number(l.priceMinor),
      currency: l.currency,
      deliveryTypes: l.deliveryTypes,
      parts: partsOf.get(l.id) ?? [],
      assessment,
      distanceKm: null,
      sightings: sightingsOf.get(l.id) ?? [],
    })
  }
  inputs.sort((x, y) => x.listingId.localeCompare(y.listingId))
  return { inputs, cards }
}

// ---------------------------------------------------------------------------------------------
// Own table
// ---------------------------------------------------------------------------------------------

/** The latest stored row of each want and listing pair among these listings. */
export interface LatestRow {
  id: string
  wantId: string
  listingId: string
  inputHash: string
  ruleVersion: string
  verdict: string
}

const pairKey = (r: { wantId: string; listingId: string }) => `${r.wantId}@${r.listingId}`

/** The latest row of each (want, listing) pair for these wants and listings, read from the table. */
export async function selectLatest(
  q: Queryable,
  wantIds: string[],
  listingIds: string[],
): Promise<Map<string, LatestRow>> {
  const out = new Map<string, LatestRow>()
  if (wantIds.length === 0 || listingIds.length === 0) return out
  const rows = await q
    .select({
      id: matches.id,
      wantId: matches.wantId,
      listingId: matches.listingId,
      inputHash: matches.inputHash,
      ruleVersion: matches.ruleVersion,
      verdict: matches.verdict,
    })
    .from(matches)
    .where(and(inArray(matches.wantId, wantIds), inArray(matches.listingId, listingIds)))
    .orderBy(matches.wantId, matches.listingId, desc(matches.matchedAt), desc(matches.id))
  for (const r of rows) if (!out.has(pairKey(r))) out.set(pairKey(r), r)
  return out
}

/** A stored row with the same key, if any (inputs that returned to an earlier state). */
export async function selectByKey(
  q: Queryable,
  key: { wantId: string; listingId: string; inputHash: string; ruleVersion: string },
): Promise<{ id: string } | undefined> {
  const [row] = await q
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.wantId, key.wantId),
        eq(matches.listingId, key.listingId),
        eq(matches.inputHash, key.inputHash),
        eq(matches.ruleVersion, key.ruleVersion),
      ),
    )
  return row
}

export interface MatchRow {
  wantId: string
  userId: string
  listingId: string
  evidenceHash: string
  cardHash: string | null
  inputHash: string
  ruleVersion: string
  verdict: string
  criteria: SpecMatchCriterionResult[]
  insidePc: boolean
  origin: string
  backfill: boolean
  matchedAt: Date
}

/** Inserts a verdict; a replay of the same key writes nothing. Returns the new row's ID. */
export async function insertMatch(q: Queryable, row: MatchRow): Promise<string | undefined> {
  const [inserted] = await q
    .insert(matches)
    .values(row)
    .onConflictDoNothing({
      target: [matches.wantId, matches.listingId, matches.inputHash, matches.ruleVersion],
    })
    .returning({ id: matches.id })
  return inserted?.id
}

/** Makes an earlier row the latest again (its inputs came back): a new T5. */
export async function touchMatch(q: Queryable, id: string, matchedAt: Date): Promise<void> {
  await q.update(matches).set({ matchedAt }).where(eq(matches.id, id))
}

export async function deleteByWants(q: Queryable, wantIds: string[]): Promise<number> {
  if (wantIds.length === 0) return 0
  const rows = await q
    .delete(matches)
    .where(inArray(matches.wantId, wantIds))
    .returning({ id: matches.id })
  return rows.length
}

export async function deleteByListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  const rows = await q
    .delete(matches)
    .where(inArray(matches.listingId, listingIds))
    .returning({ id: matches.id })
  return rows.length
}

export async function deleteByUser(q: Queryable, userId: string): Promise<number> {
  const rows = await q
    .delete(matches)
    .where(eq(matches.userId, userId))
    .returning({ id: matches.id })
  return rows.length
}

// ---------------------------------------------------------------------------------------------
// Noise and user-facing reads
// ---------------------------------------------------------------------------------------------

/** Listings whose latest classification has a reason (pipeline; the caller checks the switch). */
export async function selectNoisy(q: Queryable, listingIds: string[]): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set()
  const rows = await q
    .select({ listingId: vClassifications.listingId })
    .from(vClassifications)
    .where(
      and(
        inArray(vClassifications.listingId, listingIds),
        sql`jsonb_array_length(${vClassifications.reasons}) > 0`,
        sql`${vClassifications.classifiedAt} = (select max(x.classified_at) from noise_filter.v_classifications x where x.listing_id = ${vClassifications.listingId})`,
      ),
    )
  return new Set(rows.map((r) => r.listingId))
}

/** Listings with noise reasons as the app sees them (`app.v_noise_filter_reasons`, withUser). */
export async function selectNoiseReasonsForApp(
  q: Queryable,
  listingIds: string[],
): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set()
  const rows = await q
    .select({ listingId: vNoiseFilterReasons.listingId })
    .from(vNoiseFilterReasons)
    .where(inArray(vNoiseFilterReasons.listingId, listingIds))
  return new Set(rows.map((r) => r.listingId))
}

/** The caller's results (`app.v_spec_match_results`, withUser), newest first. */
export async function selectResults(q: Queryable, wantId?: string) {
  return q
    .select()
    .from(vSpecMatchResults)
    .where(wantId ? eq(vSpecMatchResults.wantId, wantId) : undefined)
    .orderBy(desc(vSpecMatchResults.matchedAt), vSpecMatchResults.listingId)
    .limit(500)
}
