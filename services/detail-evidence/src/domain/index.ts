// Pure logic of detail-evidence: read one actor row into detail evidence, hash the evidence, and
// work out when gallery links stop working. No I/O. It interprets nothing: values are kept as the
// actor gave them, and the hash only decides whether a version is new.
import { createHash } from 'node:crypto'
import type {
  DetailEvidenceAttribute,
  DetailEvidenceDescriptionStatus,
} from '@nabvy/contracts/modules/detail-evidence'
import { DetailEvidenceDescriptionStatus as DescriptionStatus } from '@nabvy/contracts/modules/detail-evidence'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/** IDs arrive as strings; a number is accepted only while it is a safe integer. */
const idText = (value: unknown): string | null => {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return null
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const iso = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Text normalisation for the evidence hash: NFKC, line endings unified, trailing whitespace of
 * every line removed, and the whole trimmed. Case and inner spacing are kept: they are the
 * seller's edits. The recorded run has the same description with and without trailing
 * whitespace (`dataset.json:3722,3745`), which must not read as a new version.
 */
export function normaliseText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .join('\n')
    .trim()
}

const normalised = (value: string | null) => (value === null ? null : normaliseText(value))

/** The actor's `attributes` or `detailSections`: `{ label, value, attribute_name }` objects. */
export function attributesOf(value: unknown): DetailEvidenceAttribute[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((a) => ({
    name: text(a.attribute_name),
    label: text(a.label),
    value: text(a.value),
  }))
}

/** The machine value of the Condition attribute (`used_good`), never its label ("Used – good"). */
export function conditionOf(attributes: readonly DetailEvidenceAttribute[]): string | null {
  return attributes.find((a) => a.name === 'Condition')?.value ?? null
}

export interface EvidenceHashInput {
  title: string
  description: string | null
  attributes: readonly DetailEvidenceAttribute[]
  detailSections: readonly DetailEvidenceAttribute[]
  customTitle: string | null
  customSubtitles: readonly string[]
  condition: string | null
  categoryId: string | null
  categoryPath: readonly string[]
}

const attributeKey = (a: DetailEvidenceAttribute) =>
  [normalised(a.name), normalised(a.label), normalised(a.value)] as const

const sortedAttributes = (list: readonly DetailEvidenceAttribute[]) =>
  list.map(attributeKey).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

/**
 * Rule 8: SHA-256 of the brief's allowlist only (title, full description, attributes, detail
 * sections, custom title and subtitles, condition, category). Price, availability, listing
 * status, location, photos and cache status stay out, so a price change or a re-fetch of the same
 * text is not a new version (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:127-131).
 * Attribute order does not count.
 */
export function evidenceHash(input: EvidenceHashInput): string {
  const parts = [
    normaliseText(input.title),
    normalised(input.description),
    sortedAttributes(input.attributes),
    sortedAttributes(input.detailSections),
    normalised(input.customTitle),
    input.customSubtitles.map(normaliseText),
    input.condition,
    input.categoryId,
    input.categoryPath.map(normaliseText),
  ]
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

/**
 * When gallery links stop working. Facebook media links carry an `oe` parameter, the expiry as
 * hexadecimal Unix seconds; the earliest one wins. Links without it (the recorded fixture's are
 * redacted) are given `lifetimeHours` from collection, the low end of the 104–108 hours observed
 * (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289). No links: null.
 */
export function linksExpireAt(
  urls: readonly string[],
  collectedAt: string,
  lifetimeHours: number,
): string | null {
  if (urls.length === 0) return null
  const stated = urls.flatMap((url) => {
    const match = url.match(/[?&]oe=([0-9A-Fa-f]{6,12})(?:&|$)/)
    return match?.[1] ? [Number.parseInt(match[1], 16) * 1000] : []
  })
  const at =
    stated.length > 0
      ? Math.min(...stated)
      : new Date(collectedAt).getTime() + lifetimeHours * 3_600_000
  return new Date(at).toISOString()
}

const SELLER_KEY = /seller/i

/** Conflicts as the actor reports them, minus any entry about a seller field. */
function conflictsOf(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.filter((c): c is Json => isObject(c) && !SELLER_KEY.test(String(c.field ?? '')))
}

/** Field provenance (`detail`, `search`, `seo`), minus seller fields. */
function provenanceOf(value: unknown): Record<string, string> {
  if (!isObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        !SELLER_KEY.test(entry[0]) && typeof entry[1] === 'string',
    ),
  )
}

/** One version's evidence, in the shape of the `evidence` table. */
export interface Evidence {
  evidenceHash: string
  title: string
  description: string | null
  descriptionStatus: DetailEvidenceDescriptionStatus | null
  attributes: DetailEvidenceAttribute[]
  detailSections: DetailEvidenceAttribute[]
  customTitle: string | null
  customSubtitles: string[]
  condition: string | null
  categoryId: string | null
  categoryPath: string[]
  inventoryType: string | null
  lat: number | null
  lng: number | null
  galleryTotal: number | null
  galleryComplete: boolean | null
  photoIds: string[]
  linksExpireAt: string | null
  conflicts: Json[]
  provenance: Record<string, string>
}

/** One detail fetch: a listing's detail row in one job. */
export interface Detail {
  sourceListingId: string
  seq: number
  fetchedAt: string
  detailOutcome: string | null
  detailAttempts: number | null
  descriptionStatus: DetailEvidenceDescriptionStatus | null
  cacheStatus: string | null
  staleFallback: boolean
  /** `directItemUnresolved`: the actor could not identify the requested ID. Never "sold". */
  unresolved: boolean
  /** Null when the fetch gave no evidence: unresolved, or an extraction error. */
  evidence: Evidence | null
}

/** Whether a row carries a detail fetch (as opposed to a search card only). */
function isDetailRow(item: Json): boolean {
  return (
    item.detailAttempted === true ||
    item.directItemUnresolved === true ||
    typeof item.descriptionStatus === 'string'
  )
}

/**
 * Reads one stored actor row. Returns null for anything that is not a detail row: another record
 * type (`sourceOutcome`), a row without a listing ID, or a search card whose details were not
 * fetched. `fallbackAt` is the run's collection time, used when the row carries none.
 */
export function readDetail(
  item: unknown,
  seq: number,
  fallbackAt: string,
  linkLifetimeHours: number,
): Detail | null {
  if (!isObject(item) || item.recordType !== 'listing') return null
  const sourceListingId = idText(item.listingId)
  if (!sourceListingId || !isDetailRow(item)) return null

  const collectedAt = iso(item.collectedAt) ?? fallbackAt
  const fetchedAt = iso(item.detailFetchedAt) ?? collectedAt
  const detailOutcome = text(item.detailOutcome)
  const status = DescriptionStatus.safeParse(item.descriptionStatus)
  const descriptionStatus = status.success ? status.data : null
  const cacheStatus = text(item.detailCacheStatus)
  const unresolved = item.directItemUnresolved === true
  const detail: Detail = {
    sourceListingId,
    seq,
    fetchedAt,
    detailOutcome,
    detailAttempts: finite(item.detailAttempts),
    descriptionStatus,
    cacheStatus,
    staleFallback: cacheStatus === 'stale-fallback',
    unresolved,
    evidence: null,
  }
  if (unresolved || detailOutcome === 'extraction-error') return detail

  const attributes = attributesOf(item.attributes)
  const detailSections = attributesOf(item.detailSections)
  const title = text(item.title) ?? ''
  const description = typeof item.description === 'string' ? item.description : null
  const customTitle = text(item.customTitle)
  const customSubtitles = strings(item.customSubtitles)
  const condition = conditionOf(attributes)
  const categoryId = idText(item.categoryId)
  const categoryPath = strings(item.categoryPath)
  const coordinates = isObject(item.locationCoordinates)
    ? item.locationCoordinates
    : isObject(item.locationDetails)
      ? item.locationDetails
      : {}
  const photos = Array.isArray(item.photos) ? item.photos.filter(isObject) : []
  const photoIds = photos.flatMap((p) => {
    const id = idText(p.id)
    return id ? [id] : []
  })
  const photoUrls = [
    ...photos.flatMap((p) => {
      const uri = isObject(p.image) ? text(p.image.uri) : null
      return uri ? [uri] : []
    }),
    ...strings(item.photoUrls),
  ]
  const galleryTotal = finite(item.photoGalleryTotal)

  detail.evidence = {
    evidenceHash: evidenceHash({
      title,
      description,
      attributes,
      detailSections,
      customTitle,
      customSubtitles,
      condition,
      categoryId,
      categoryPath,
    }),
    title,
    description,
    descriptionStatus,
    attributes,
    detailSections,
    customTitle,
    customSubtitles,
    condition,
    categoryId,
    categoryPath,
    inventoryType: text(item.inventoryType),
    lat: finite(coordinates.latitude),
    lng: finite(coordinates.longitude),
    galleryTotal: galleryTotal !== null && galleryTotal >= 0 ? Math.trunc(galleryTotal) : null,
    galleryComplete:
      typeof item.photoGalleryComplete === 'boolean' ? item.photoGalleryComplete : null,
    photoIds,
    linksExpireAt: linksExpireAt(photoUrls, collectedAt, linkLifetimeHours),
    conflicts: conflictsOf(item.conflicts),
    provenance: provenanceOf(item.provenance),
  }
  return detail
}

/** One fetch per listing per job: the first row of each listing ID wins, as in listing-ingest. */
export function firstPerListing(details: readonly Detail[]): Detail[] {
  const seen = new Set<string>()
  const out: Detail[] = []
  for (const detail of [...details].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(detail.sourceListingId)) continue
    seen.add(detail.sourceListingId)
    out.push(detail)
  }
  return out
}

/** Splits a list into batches of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The event key: one per job, event type and batch, so a replay publishes the same keys. */
export const eventKey = (type: string, jobId: number, batch: number) => `${type}:${jobId}:${batch}`
