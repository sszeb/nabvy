// Database access: this module's own schema, pickup_location, plus listing-ingest's v_listings,
// detail-evidence's v_current and v_text, and city-pages' v_city_pages, as nabvy_pipeline inside
// withPipeline. Nothing here reads a seller field.

import type { LocationPoint } from '@nabvy/contracts/modules/location'
import type {
  PickupLocationBasis,
  PickupLocationHandover,
  PickupLocationPass,
  PickupLocationStatus,
} from '@nabvy/contracts/modules/pickup-location'
import { vCityPages } from '@nabvy/db/schema/city-pages'
import { vCurrent, vText } from '@nabvy/db/schema/detail-evidence'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import {
  aiQueue,
  candidates,
  current,
  handover,
  mentions,
  overrides,
  resolutions,
} from '@nabvy/db/schema/pickup-location'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Candidate, Decision, GazetteerPage } from '../domain'

// A type query rather than a separate statement, as in parts-rules: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

/** Every city page, as the gazetteer's pages (empty while city-pages is off). */
export async function selectCityPages(q: Queryable): Promise<GazetteerPage[]> {
  const rows = await q
    .select({
      cityPageId: vCityPages.cityPageId,
      name: vCityPages.name,
      towns: vCityPages.towns,
      lat: vCityPages.lat,
      lng: vCityPages.lng,
    })
    .from(vCityPages)
  return rows.map((r) => ({ ...r, towns: r.towns ?? [] }))
}

/** One listing version to resolve: the field signals and the text of one pass. */
export interface Version {
  listingId: string
  evidenceHash: string
  title: string
  description: string | null
  cityPageId: string | null
  townLabel: string | null
  coordinates: LocationPoint | null
  deliveryTypes: string[]
  inputFetchedAt: Date
}

/** The card of each listing (the `card` pass): title, town label, page; no coordinates. */
export async function selectCards(q: Queryable, listingIds: string[]): Promise<Version[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({
      listingId: vListings.id,
      evidenceHash: vListings.cardHash,
      title: vListings.title,
      cityPageId: vListings.cityPageId,
      townLabel: vListings.townLabel,
      deliveryTypes: vListings.deliveryTypes,
      inputFetchedAt: vListings.lastSeenAt,
    })
    .from(vListings)
    .where(inArray(vListings.id, listingIds))
  return rows.map((r) => ({
    ...r,
    description: null,
    coordinates: null,
    deliveryTypes: r.deliveryTypes ?? [],
  }))
}

/** The current detail version of each listing (the `detail` pass); listings with none are left out. */
export async function selectVersions(q: Queryable, listingIds: string[]): Promise<Version[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({
      listingId: vCurrent.listingId,
      evidenceHash: vCurrent.evidenceHash,
      versionTitle: vText.title,
      cardTitle: vListings.title,
      description: vText.description,
      cityPageId: vListings.cityPageId,
      townLabel: vListings.townLabel,
      deliveryTypes: vListings.deliveryTypes,
      lat: vCurrent.lat,
      lng: vCurrent.lng,
      inputFetchedAt: vCurrent.lastSeenAt,
    })
    .from(vCurrent)
    .innerJoin(
      vText,
      and(eq(vText.listingId, vCurrent.listingId), eq(vText.evidenceHash, vCurrent.evidenceHash)),
    )
    .leftJoin(vListings, eq(vListings.id, vCurrent.listingId))
    .where(inArray(vCurrent.listingId, listingIds))
  return rows.map((r) => ({
    listingId: r.listingId,
    evidenceHash: r.evidenceHash,
    title: r.versionTitle?.trim() ? r.versionTitle : (r.cardTitle ?? ''),
    description: r.description,
    cityPageId: r.cityPageId ?? null,
    townLabel: r.townLabel ?? null,
    coordinates: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
    deliveryTypes: r.deliveryTypes ?? [],
    inputFetchedAt: r.inputFetchedAt,
  }))
}

/** The (listing, evidence hash) pairs among these listings already resolved at this pass and version. */
export async function selectDone(
  q: Queryable,
  listingIds: string[],
  pass: PickupLocationPass,
  ruleVersion: string,
): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set()
  const rows = await q
    .select({ listingId: resolutions.listingId, evidenceHash: resolutions.evidenceHash })
    .from(resolutions)
    .where(
      and(
        inArray(resolutions.listingId, listingIds),
        eq(resolutions.pass, pass),
        eq(resolutions.ruleVersion, ruleVersion),
      ),
    )
  return new Set(rows.map((r) => `${r.listingId}@${r.evidenceHash}`))
}

export interface CurrentRow {
  listingId: string
  resolutionId: string
  pass: PickupLocationPass
  evidenceHash: string
  status: PickupLocationStatus
  basis: PickupLocationBasis
  source: string
  decidedBy: 'rules' | 'ai' | 'review'
  conflict: boolean
  approximate: boolean
  townOrArea: string | null
  areaId: string | null
  areaDistrict: string | null
  lat: number | null
  lng: number | null
  uncertaintyKm: number | null
  noteCode: string | null
  notePlaceLabel: string | null
  listedInLabel: string | null
  inputFetchedAt: Date | null
}

/** The current resolution of each listing, with the time of the input it came from. */
export async function selectCurrent(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, CurrentRow>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({
      listingId: current.listingId,
      resolutionId: current.resolutionId,
      pass: current.pass,
      evidenceHash: current.evidenceHash,
      status: current.status,
      basis: current.basis,
      source: current.source,
      decidedBy: current.decidedBy,
      conflict: current.conflict,
      approximate: current.approximate,
      townOrArea: current.townOrArea,
      areaId: current.areaId,
      areaDistrict: current.areaDistrict,
      lat: current.lat,
      lng: current.lng,
      uncertaintyKm: current.uncertaintyKm,
      noteCode: current.noteCode,
      notePlaceLabel: current.notePlaceLabel,
      listedInLabel: current.listedInLabel,
      inputFetchedAt: resolutions.inputFetchedAt,
    })
    .from(current)
    .innerJoin(resolutions, eq(resolutions.id, current.resolutionId))
    .where(inArray(current.listingId, listingIds))
  return new Map(rows.map((r) => [r.listingId, r as CurrentRow]))
}

export interface OverrideRow {
  listingId: string
  areaId: string
  townOrArea: string
  lat: number
  lng: number
}

export async function selectOverrides(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, OverrideRow>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({
      listingId: overrides.listingId,
      areaId: overrides.areaId,
      townOrArea: overrides.townOrArea,
      lat: overrides.lat,
      lng: overrides.lng,
    })
    .from(overrides)
    .where(inArray(overrides.listingId, listingIds))
  return new Map(rows.map((r) => [r.listingId, r]))
}

export async function selectHandover(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, PickupLocationHandover>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({
      listingId: handover.listingId,
      collection: handover.collection,
      meetupOffered: handover.meetupOffered,
      localDelivery: handover.localDelivery,
      postage: handover.postage,
      deliveryOnlyText: handover.deliveryOnlyText,
      postageOnlyText: handover.postageOnlyText,
      courierOnlyText: handover.courierOnlyText,
    })
    .from(handover)
    .where(inArray(handover.listingId, listingIds))
  return new Map(rows.map(({ listingId, ...rest }) => [listingId, rest as PickupLocationHandover]))
}

export interface ResolutionRow {
  version: Version
  pass: PickupLocationPass
  decision: Decision
  candidates: Candidate[]
  /** Each candidate's quote after quote-redaction, by seq. */
  redactedQuotes: string[]
  fieldLabel: string | null
  fieldPoint: LocationPoint | null
}

/**
 * Writes each resolution with its candidates and mentions. A resolution already stored (same
 * listing, pass, evidence hash and rule version) is skipped with its evidence, so a replay
 * writes nothing. Returns the ID of each freshly written resolution by `listing@hash`.
 */
export async function insertResolutions(
  q: Queryable,
  ruleVersion: string,
  rows: ResolutionRow[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  if (rows.length === 0) return ids
  const inserted = await q
    .insert(resolutions)
    .values(
      rows.map((r) => ({
        listingId: r.version.listingId,
        pass: r.pass,
        evidenceHash: r.version.evidenceHash,
        ruleVersion,
        status: r.decision.status,
        basis: r.decision.basis,
        source: r.decision.source,
        confidence: r.decision.confidence,
        decidedBy: 'rules',
        conflict: r.decision.conflict,
        approximate: r.decision.approximate,
        townOrArea: r.decision.display?.point ? r.decision.display.label : null,
        areaId: r.decision.display?.point ? r.decision.display.areaId : null,
        areaDistrict: r.decision.district,
        lat: r.decision.display?.point?.lat ?? null,
        lng: r.decision.display?.point?.lng ?? null,
        uncertaintyKm: null,
        noteCode: r.decision.noteCode,
        notePlaceLabel: r.decision.notePlaceLabel,
        listedInLabel: r.decision.listedInLabel,
        fieldLabel: r.fieldLabel,
        fieldLat: r.fieldPoint?.lat ?? null,
        fieldLng: r.fieldPoint?.lng ?? null,
        fieldDistanceKm: r.decision.fieldDistanceKm,
        aiEligible: r.decision.aiReason !== null,
        inputFetchedAt: r.version.inputFetchedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: resolutions.id,
      listingId: resolutions.listingId,
      evidenceHash: resolutions.evidenceHash,
    })
  for (const r of inserted) ids.set(`${r.listingId}@${r.evidenceHash}`, r.id)

  const fresh = rows.filter((r) => ids.has(`${r.version.listingId}@${r.version.evidenceHash}`))
  const candidateRows = fresh.flatMap((r) => {
    const resolutionId = ids.get(`${r.version.listingId}@${r.version.evidenceHash}`) as string
    return r.candidates.map((c) => ({
      resolutionId,
      listingId: r.version.listingId,
      seq: c.seq,
      kind: c.kind,
      value: c.value,
      label: c.display?.label ?? (c.kind === 'place' ? null : c.value.split(' ')[0]),
      areaId: c.display?.areaId ?? null,
      lat: c.point?.lat ?? null,
      lng: c.point?.lng ?? null,
      role: c.role,
      cue: c.cue,
      strength: c.strength,
      rejection: c.rejection,
      fieldDistanceKm: c.fieldDistanceKm,
    }))
  })
  const mentionRows = fresh.flatMap((r) => {
    const resolutionId = ids.get(`${r.version.listingId}@${r.version.evidenceHash}`) as string
    return r.candidates.map((c) => ({
      resolutionId,
      listingId: r.version.listingId,
      seq: c.seq,
      candidateSeq: c.seq,
      source: c.source,
      quoteStart: c.start,
      quoteEnd: c.end,
      quoteRedacted: r.redactedQuotes[c.seq] ?? '',
      role: c.role,
      cue: c.cue,
      strength: c.strength,
    }))
  })
  for (let i = 0; i < candidateRows.length; i += 1000) {
    await q
      .insert(candidates)
      .values(candidateRows.slice(i, i + 1000))
      .onConflictDoNothing()
  }
  for (let i = 0; i < mentionRows.length; i += 1000) {
    await q
      .insert(mentions)
      .values(mentionRows.slice(i, i + 1000))
      .onConflictDoNothing()
  }
  return ids
}

export interface CurrentWrite {
  listingId: string
  resolutionId: string
  pass: PickupLocationPass
  evidenceHash: string
  status: PickupLocationStatus
  basis: PickupLocationBasis
  source: string
  decidedBy: 'rules' | 'ai' | 'review'
  conflict: boolean
  approximate: boolean
  townOrArea: string | null
  areaId: string | null
  areaDistrict: string | null
  lat: number | null
  lng: number | null
  noteCode: string | null
  notePlaceLabel: string | null
  listedInLabel: string | null
}

/** Replaces each listing's current row (the caller has decided the new one wins). */
export async function upsertCurrent(q: Queryable, rows: CurrentWrite[]): Promise<void> {
  if (rows.length === 0) return
  await q
    .insert(current)
    .values(rows.map((r) => ({ ...r, uncertaintyKm: null })))
    .onConflictDoUpdate({
      target: current.listingId,
      set: {
        resolutionId: sql`excluded.resolution_id`,
        pass: sql`excluded.pass`,
        evidenceHash: sql`excluded.evidence_hash`,
        status: sql`excluded.status`,
        basis: sql`excluded.basis`,
        source: sql`excluded.source`,
        decidedBy: sql`excluded.decided_by`,
        conflict: sql`excluded.conflict`,
        approximate: sql`excluded.approximate`,
        townOrArea: sql`excluded.town_or_area`,
        areaId: sql`excluded.area_id`,
        areaDistrict: sql`excluded.area_district`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        uncertaintyKm: sql`excluded.uncertainty_km`,
        noteCode: sql`excluded.note_code`,
        notePlaceLabel: sql`excluded.note_place_label`,
        listedInLabel: sql`excluded.listed_in_label`,
      },
    })
}

export async function upsertHandover(
  q: Queryable,
  rows: ({ listingId: string; evidenceHash: string } & PickupLocationHandover)[],
): Promise<void> {
  if (rows.length === 0) return
  await q
    .insert(handover)
    .values(rows)
    .onConflictDoUpdate({
      target: handover.listingId,
      set: {
        evidenceHash: sql`excluded.evidence_hash`,
        collection: sql`excluded.collection`,
        meetupOffered: sql`excluded.meetup_offered`,
        localDelivery: sql`excluded.local_delivery`,
        postage: sql`excluded.postage`,
        deliveryOnlyText: sql`excluded.delivery_only_text`,
        postageOnlyText: sql`excluded.postage_only_text`,
        courierOnlyText: sql`excluded.courier_only_text`,
      },
    })
}

/** Queues versions for the AI lane; a version already queued stays as it is. */
export async function enqueueAi(
  q: Queryable,
  rows: { listingId: string; evidenceHash: string; reason: 'uncertain' | 'delivers_elsewhere' }[],
): Promise<void> {
  if (rows.length === 0) return
  await q.insert(aiQueue).values(rows).onConflictDoNothing()
}

/** Stores a reviewer's override (one per listing; a newer one replaces it). */
export async function upsertOverride(
  q: Queryable,
  row: OverrideRow & { by: string; reason: string },
): Promise<void> {
  await q
    .insert(overrides)
    .values(row)
    .onConflictDoUpdate({
      target: overrides.listingId,
      set: {
        areaId: sql`excluded.area_id`,
        townOrArea: sql`excluded.town_or_area`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        by: sql`excluded.by`,
        reason: sql`excluded.reason`,
      },
    })
}

/** Removes everything this module holds about these listings (erasure). Returns rows removed from `current`. */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0
  const removed = await q
    .delete(current)
    .where(inArray(current.listingId, listingIds))
    .returning({ listingId: current.listingId })
  await q.delete(handover).where(inArray(handover.listingId, listingIds))
  await q.delete(aiQueue).where(inArray(aiQueue.listingId, listingIds))
  await q.delete(overrides).where(inArray(overrides.listingId, listingIds))
  // candidates and mentions cascade from resolutions
  await q.delete(resolutions).where(inArray(resolutions.listingId, listingIds))
  return removed.length
}

/** listing-ingest's page and town label of each listing, for the fallback point. */
export async function selectCardFields(
  q: Queryable,
  listingIds: string[],
): Promise<{ listingId: string; cityPageId: string | null; townLabel: string | null }[]> {
  if (listingIds.length === 0) return []
  return q
    .select({
      listingId: vListings.id,
      cityPageId: vListings.cityPageId,
      townLabel: vListings.townLabel,
    })
    .from(vListings)
    .where(inArray(vListings.id, listingIds))
}
