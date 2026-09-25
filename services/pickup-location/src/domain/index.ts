// Pure logic: no I/O, no database, no clock or randomness passed in implicitly. The rules of the
// pickup-location module (docs/design/modules/pickup-location.md; listing-location draft §3):
// a gazetteer built from city-pages, place and postcode mentions with their cue and role, the
// decision table over the field point and the text places, and the handover facts.
import { createHash } from 'node:crypto'
import type { LocationPoint } from '@nabvy/contracts/modules/location'
import type {
  PickupLocationBasis,
  PickupLocationCandidateKind,
  PickupLocationConfidence,
  PickupLocationCueStrength,
  PickupLocationHandover,
  PickupLocationNoteCode,
  PickupLocationPass,
  PickupLocationRejection,
  PickupLocationRole,
  PickupLocationSource,
  PickupLocationStatus,
  PickupLocationTextSource,
} from '@nabvy/contracts/modules/pickup-location'
import { distanceKm } from '@nabvy/location'

export interface Thresholds {
  agreeKm: number
  conflictKm: number
  deliveryFarKm: number
  cueWindowChars: number
  maxCandidates: number
}

// --- Gazetteer -------------------------------------------------------------------------------

export interface GazetteerPage {
  cityPageId: string
  name: string
  towns: readonly string[]
  lat: number | null
  lng: number | null
}

/** An allowed display place: a city page (by its name) or one of its towns, at the page's point. */
export interface Place {
  areaId: string
  label: string
  cityPageId: string
  point: LocationPoint | null
}

export interface Gazetteer {
  byAreaId: Map<string, Place>
  byPage: Map<string, Place>
  /** Lower-cased name → the places it names (more than one when pages share a town). */
  byName: Map<string, Place[]>
  /** One alternation over every name, longest first; null when the gazetteer is empty. */
  regex: RegExp | null
}

/** "Chichester, West Sussex" → "Chichester": the part before the first comma. */
export function primaryLabel(name: string): string {
  return name.split(',')[0]?.trim() ?? name.trim()
}

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Words that are also UK place names ("Reading", "Bath", "Sale"). A mention of one counts only
 * with a strong or medium cue (draft §3.3; the product-catalogue alias view is a soft input that
 * would extend this list, docs/questions/pickup-location.md).
 */
export const STOP_LIST: readonly string[] = [
  'reading',
  'bath',
  'sale',
  'deal',
  'wells',
  'march',
  'street',
  'ware',
  'hope',
  'over',
  'wick',
  'barking',
  'hyde',
  'mold',
  'new',
  'ash',
  'rye',
  'leek',
  'send',
  'north',
  'south',
  'east',
  'west',
]
const STOP = new Set(STOP_LIST)

/**
 * "Bognor Regis" is also written "Bognor": a two-word label's first word is an alias when it is
 * six letters or more and not a stop-listed word (a shared first word, "Sutton", is ambiguous
 * and settled like any other, README.md "Decisions").
 */
function firstWordAlias(label: string): string[] {
  const words = label.split(/\s+/)
  const first = words[0] ?? ''
  if (words.length < 2 || first.length < 6 || STOP.has(first.toLowerCase())) return []
  return /^[A-Za-z]+$/.test(first) ? [first] : []
}

export function buildGazetteer(pages: readonly GazetteerPage[]): Gazetteer {
  const byAreaId = new Map<string, Place>()
  const byPage = new Map<string, Place>()
  const byName = new Map<string, Place[]>()
  const add = (place: Place, names: string[]) => {
    byAreaId.set(place.areaId, place)
    for (const name of names) {
      const key = name.toLowerCase().replace(/\s+/g, ' ').trim()
      if (key.length < 3) continue
      const list = byName.get(key) ?? []
      if (!list.some((p) => p.areaId === place.areaId)) list.push(place)
      byName.set(key, list)
    }
  }
  for (const page of pages) {
    const point = page.lat !== null && page.lng !== null ? { lat: page.lat, lng: page.lng } : null
    const label = primaryLabel(page.name)
    const pagePlace: Place = {
      areaId: `cp:${page.cityPageId}`,
      label,
      cityPageId: page.cityPageId,
      point,
    }
    byPage.set(page.cityPageId, pagePlace)
    add(pagePlace, [label, page.name, ...firstWordAlias(label)])
    for (const town of page.towns) {
      const townLabel = town.trim()
      if (!townLabel || townLabel.toLowerCase() === label.toLowerCase()) continue
      add(
        {
          areaId: `town:${page.cityPageId}:${slug(townLabel)}`,
          label: townLabel,
          cityPageId: page.cityPageId,
          point,
        },
        [townLabel, ...firstWordAlias(townLabel)],
      )
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b))
  const regex =
    names.length === 0
      ? null
      : new RegExp(`(?<![a-z0-9])(${names.map(escapeRegex).join('|')})(?![a-z0-9])`, 'gi')
  return { byAreaId, byPage, byName, regex }
}

// --- Mentions ----------------------------------------------------------------------------------

export interface Cue {
  role: PickupLocationRole
  strength: PickupLocationCueStrength
  cue: string | null
}

interface CueRule {
  role: PickupLocationRole
  strength: PickupLocationCueStrength
  /** Matched against the window before the mention (anchored at its end). */
  before?: RegExp
  /** Matched against the text right after the mention. */
  after?: RegExp
}

/** Cue patterns, in priority order (draft §2.3, §3.4). The first that matches wins. */
export const CUES: readonly CueRule[] = [
  {
    role: 'origin',
    strength: 'strong',
    before: /\b(bought|purchased|ordered|imported)\s+(it\s+)?(in|from)\s*(the\s+)?$/i,
  },
  {
    role: 'delivery_area',
    strength: 'strong',
    before:
      /\b(deliver(y|ed|ing)?|courier(ed)?|post(ed|age)?|ship(ped|ping)?|drop(ped)?\s*off)\s*(is\s+)?(available\s+|possible\s+|free\s+)?(to|around|within|across|anywhere\s+in|in\s+the)\s*(the\s+)?$/i,
  },
  { role: 'delivery_area', strength: 'medium', before: /\b(deliver(y)?|courier)\s+$/i },
  {
    role: 'pickup',
    strength: 'strong',
    before:
      /\b(collect(ion|ed|ing)?|pick[\s-]?up|pickup|collection\s+point|to\s+be\s+collected)\s*(is\s+|only\s+|available\s+|possible\s+)*(from|in|at|near)?\s*(the\s+)?$/i,
  },
  {
    role: 'seller_base',
    strength: 'strong',
    before:
      /\b(located|based|situated|we\s+are|we're|i\s+am|i'm|item\s+is|it\s+is|it's|they\s+are|i\s+live|we\s+live|living)\s+(currently\s+)?(in|at|near)\s*(the\s+)?$/i,
  },
  {
    role: 'meetup',
    strength: 'medium',
    before:
      /\b(meet(ing|up)?|meet\s+up|hand\s*over|handover)\s*(you\s+|me\s+)?(in|at|near|around|halfway\s+(in|at))?\s*(the\s+)?$/i,
  },
  {
    role: 'near',
    strength: 'medium',
    before: /\b(near|nr\.?|close\s+to|next\s+to|just\s+outside|outside)\s*$/i,
  },
  { role: 'seller_base', strength: 'medium', after: /^\s*(area|based|postcode|way|side)\b/i },
  { role: 'pickup', strength: 'medium', before: /\b(from|in|at)\s*(the\s+)?$/i },
]

/** The cue for a mention, from the text before and after it. `null` cue means a bare mention. */
export function classifyCue(before: string, after: string): Cue {
  for (const rule of CUES) {
    if (rule.before && !rule.before.test(before)) continue
    if (rule.after && !rule.after.test(after)) continue
    const found = rule.before?.exec(before)?.[0] ?? rule.after?.exec(after)?.[0] ?? ''
    return { role: rule.role, strength: rule.strength, cue: found.trim().slice(0, 60) || null }
  }
  return { role: 'mention', strength: 'weak', cue: null }
}

/** The pickup-class roles: a place the item can be collected from (draft §3.6, "T"). */
export const PICKUP_CLASS: ReadonlySet<PickupLocationRole> = new Set([
  'pickup',
  'seller_base',
  'meetup',
  'near',
])

/** A UK postcode, full or outward only (a district), case-insensitive, any spacing. */
const FULL_POSTCODE =
  /(?<![A-Z0-9])([A-Z]{1,2}[0-9][A-Z0-9]?)\s?([0-9][ABD-HJLNP-UW-Z]{2})(?![A-Z0-9])/gi
const DISTRICT_ONLY = /(?<![A-Z0-9])([A-Z]{1,2}[0-9]{1,2})(?![A-Z0-9])/gi

/** A description line that is keyword stuffing: three or more hashtags (parts-rules' rule). */
const TAG_LINE = /(?:#\w+[\s,]*){3,}/

export function tagBlockRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let offset = 0
  for (const line of text.split('\n')) {
    if (TAG_LINE.test(line)) ranges.push([offset, offset + line.length])
    offset += line.length + 1
  }
  return ranges
}

export interface Mention {
  source: PickupLocationTextSource
  start: number
  end: number
  quote: string
  kind: PickupLocationCandidateKind
  /** The text as found (a full postcode, upper-cased and spaced; or the place name). */
  value: string
  role: PickupLocationRole
  strength: PickupLocationCueStrength
  cue: string | null
  /** The gazetteer places this name could mean; empty for a postcode or an unknown name. */
  places: Place[]
  rejection: PickupLocationRejection | null
}

/** Normalises a postcode: upper case, one space before the inward code. */
export function normalisePostcode(outward: string, inward: string): string {
  return `${outward.toUpperCase()} ${inward.toUpperCase()}`
}

/** The whole postcode district of an outward code: a lettered sub-district is its parent (§3.8). */
export function districtOf(outward: string): string {
  const m = /^([A-Z]{1,2}[0-9]{1,2})/.exec(outward.toUpperCase())
  return m?.[1] ?? outward.toUpperCase()
}

/**
 * Every place name and postcode in one text, in text order, with its cue. Mentions inside a
 * tag block are kept but rejected (`tag_block`); stop-listed names without a cue are rejected
 * (`stop_list`); names the gazetteer does not know never become mentions.
 */
export function extractMentions(
  source: PickupLocationTextSource,
  text: string,
  gazetteer: Gazetteer,
  t: Thresholds,
): Mention[] {
  const out: Mention[] = []
  const blocks = tagBlockRanges(text)
  const inBlock = (i: number) => blocks.some(([s, e]) => i >= s && i < e)
  const taken: [number, number][] = []
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a)
  const push = (m: Omit<Mention, 'rejection'> & { rejection?: PickupLocationRejection | null }) => {
    if (overlaps(m.start, m.end)) return
    taken.push([m.start, m.end])
    out.push({ ...m, rejection: m.rejection ?? (inBlock(m.start) ? 'tag_block' : null) })
  }
  const window = (start: number, end: number) => ({
    before: text.slice(Math.max(0, start - t.cueWindowChars), start),
    after: text.slice(end, end + 20),
  })

  for (const m of text.matchAll(FULL_POSTCODE)) {
    const start = m.index
    const end = start + m[0].length
    const { before, after } = window(start, end)
    const cue = classifyCue(before, after)
    // A bare full postcode is the seller's own (draft §3.2): strong, seller_base.
    const role = cue.role === 'mention' ? 'seller_base' : cue.role
    push({
      source,
      start,
      end,
      quote: m[0],
      kind: 'postcode_full',
      value: normalisePostcode(m[1] ?? '', m[2] ?? ''),
      role,
      strength: 'strong',
      cue: cue.cue,
      places: [],
    })
  }
  for (const m of text.matchAll(DISTRICT_ONLY)) {
    const start = m.index
    const end = start + m[0].length
    const { before, after } = window(start, end)
    const cue = classifyCue(before, after)
    // A district on its own ("PO21") needs a cue, or it is a model number.
    if (cue.role === 'mention') continue
    push({
      source,
      start,
      end,
      quote: m[0],
      kind: 'postcode_district',
      value: districtOf(m[1] ?? ''),
      role: cue.role,
      strength: cue.strength === 'weak' ? 'medium' : cue.strength,
      cue: cue.cue,
      places: [],
    })
  }
  if (gazetteer.regex) {
    for (const m of text.matchAll(gazetteer.regex)) {
      const start = m.index
      const end = start + m[0].length
      const key = m[0].toLowerCase().replace(/\s+/g, ' ')
      const places = gazetteer.byName.get(key) ?? []
      if (places.length === 0) continue
      const { before, after } = window(start, end)
      const cue = classifyCue(before, after)
      const stopped = STOP.has(key) && cue.strength === 'weak'
      push({
        source,
        start,
        end,
        quote: m[0],
        kind: 'place',
        value: m[0],
        role: cue.role,
        strength: cue.strength,
        cue: cue.cue,
        places,
        rejection: stopped ? 'stop_list' : undefined,
      })
    }
  }
  const sorted = out.sort((a, b) => a.start - b.start)
  // "Collection from Bognor or Chichester": a bare place joined to the previous mention by a
  // comma, "or", "and" or a slash takes that mention's role and strength (draft §3.6, row 8).
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as Mention
    const cur = sorted[i] as Mention
    if (cur.role !== 'mention' || cur.rejection) continue
    if (/^\s*(,|or|and|&|\/)\s*$/i.test(text.slice(prev.end, cur.start))) {
      cur.role = prev.role
      cur.strength = prev.strength
      cur.cue = prev.cue
    }
  }
  return sorted.slice(0, t.maxCandidates)
}

// --- Decision ----------------------------------------------------------------------------------

export interface FieldInput {
  /** listing-ingest's city page for the listing, if any. */
  cityPageId: string | null
  /** listing-ingest's raw town label (the card's location text). */
  townLabel: string | null
  /** detail-evidence's coarse coordinates (detail pass only); internal, never displayed. */
  coordinates: LocationPoint | null
}

export interface Candidate extends Mention {
  seq: number
  /** The point used for agreement: a postcode's point, or the chosen place's. */
  point: LocationPoint | null
  /** The gazetteer place shown for this candidate (a postcode snaps to the nearest place). */
  display: Place | null
  /** Whether the name could mean more than one place and nothing settled it. */
  ambiguous: boolean
  fieldDistanceKm: number | null
}

export interface Field {
  label: string | null
  point: LocationPoint | null
  /** The display place for the field: the town label's place, or the page's. */
  display: Place | null
  /** True when the point came from the listing's own coordinates (detail pass). */
  fromCoordinates: boolean
}

export interface Decision {
  status: PickupLocationStatus
  basis: PickupLocationBasis
  source: PickupLocationSource
  confidence: PickupLocationConfidence
  conflict: boolean
  approximate: boolean
  display: Place | null
  district: string | null
  noteCode: PickupLocationNoteCode | null
  notePlaceLabel: string | null
  listedInLabel: string | null
  aiReason: 'uncertain' | 'delivers_elsewhere' | null
  fieldDistanceKm: number | null
}

const km = (a: LocationPoint, b: LocationPoint) => distanceKm(a, b, 'coordinates').km

/** The field: the town label snapped to the gazetteer, else the page, with the coarse point. */
export function fieldFrom(input: FieldInput, gazetteer: Gazetteer): Field {
  const page = input.cityPageId ? (gazetteer.byPage.get(input.cityPageId) ?? null) : null
  const labelKey = input.townLabel?.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
  const labelled = (gazetteer.byName.get(labelKey) ?? []).find(
    (p) => !page || p.cityPageId === page.cityPageId,
  )
  const display = labelled ?? page
  const point = input.coordinates ?? display?.point ?? null
  return {
    label: display?.label ?? input.townLabel ?? null,
    point,
    display,
    fromCoordinates: input.coordinates !== null,
  }
}

/** Nearest gazetteer place with a point, within `withinKm` of `point`. */
export function nearestPlace(
  point: LocationPoint,
  gazetteer: Gazetteer,
  withinKm: number,
): Place | null {
  let best: { place: Place; d: number } | null = null
  for (const place of gazetteer.byAreaId.values()) {
    if (!place.point) continue
    const d = km(point, place.point)
    if (d <= withinKm && (!best || d < best.d)) best = { place, d }
  }
  return best?.place ?? null
}

/**
 * Turns mentions into candidates: settles which place a name means (the one nearest the field
 * when it could mean several), snaps a postcode's point to the nearest display place, and
 * measures each candidate's distance to the field point.
 */
export function candidatesFrom(
  mentions: readonly Mention[],
  postcodePoints: ReadonlyMap<string, LocationPoint>,
  field: Field,
  gazetteer: Gazetteer,
  t: Thresholds,
): Candidate[] {
  return mentions.map((m, seq) => {
    let point: LocationPoint | null = null
    let display: Place | null = null
    let ambiguous = false
    let rejection = m.rejection
    if (m.kind === 'place') {
      let places = m.places
      if (places.length > 1 && field.point) {
        const withPoints = places.filter((p) => p.point)
        if (withPoints.length > 0) {
          const fp = field.point
          places = [
            withPoints.reduce((a, b) =>
              km(fp, a.point as LocationPoint) <= km(fp, b.point as LocationPoint) ? a : b,
            ),
          ]
        }
      }
      if (places.length > 1 && field.display) {
        const same = places.find((p) => p.cityPageId === field.display?.cityPageId)
        if (same) places = [same]
      }
      // Names that share one page or one point ("Bognor" as the page and as its town) are one place.
      const first = places[0]
      if (
        first &&
        places.every(
          (p) =>
            p.cityPageId === first.cityPageId ||
            (p.point &&
              first.point &&
              p.point.lat === first.point.lat &&
              p.point.lng === first.point.lng),
        )
      ) {
        places = [first]
      }
      ambiguous = places.length > 1
      display = places[0] ?? null
      point = display?.point ?? null
      if (!rejection && !display) rejection = 'no_gazetteer_match'
    } else {
      point = postcodePoints.get(m.value) ?? null
      if (!point && !rejection) rejection = 'no_point'
      display = point ? nearestPlace(point, gazetteer, t.conflictKm) : null
    }
    const fieldDistanceKm = point && field.point ? km(point, field.point) : null
    return { ...m, seq, point, display, ambiguous, rejection, fieldDistanceKm }
  })
}

const samePage = (c: Candidate, field: Field) =>
  c.display !== null && field.display !== null && c.display.cityPageId === field.display.cityPageId

const usable = (c: Candidate) => c.rejection === null && (c.point !== null || c.display !== null)

function agrees(c: Candidate, field: Field, t: Thresholds): boolean | null {
  if (c.fieldDistanceKm !== null) return c.fieldDistanceKm <= t.agreeKm
  if (samePage(c, field)) return true
  return null
}

const districtFor = (c: Candidate | null) =>
  c && c.kind !== 'place' ? districtOf(c.value.split(' ')[0] ?? '') : null

/** The decision table (draft §3.6, reduced to the signals this push has; README.md, "Rules"). */
export function decide(
  pass: PickupLocationPass,
  field: Field,
  candidates: readonly Candidate[],
  t: Thresholds,
): Decision {
  const base: Decision = {
    status: 'unknown',
    basis: 'fallback',
    source: 'none',
    confidence: 'none',
    conflict: false,
    approximate: true,
    display: null,
    district: null,
    noteCode: null,
    notePlaceLabel: null,
    listedInLabel: null,
    aiReason: null,
    fieldDistanceKm: null,
  }
  const fieldOnly = (): Decision =>
    field.display
      ? {
          ...base,
          status: 'field_only',
          basis: 'field',
          source: 'listing',
          confidence: field.point ? (field.fromCoordinates ? 'high' : 'medium') : 'low',
          approximate: field.display.point === null,
          display: field.display,
        }
      : { ...base, noteCode: 'pickup_place_not_stated' }

  const live = candidates.filter(usable)
  const pickupClass = live.filter((c) => PICKUP_CLASS.has(c.role))

  if (pickupClass.length === 0) {
    const far = live.find(
      (c) =>
        c.role === 'delivery_area' &&
        c.fieldDistanceKm !== null &&
        c.fieldDistanceKm > t.deliveryFarKm &&
        !c.ambiguous,
    )
    if (far && field.display) {
      return {
        ...fieldOnly(),
        status: 'uncertain',
        confidence: 'low',
        approximate: true,
        noteCode: 'description_delivers_elsewhere',
        notePlaceLabel: far.display?.label ?? null,
        aiReason: pass === 'detail' ? 'delivers_elsewhere' : null,
        fieldDistanceKm: far.fieldDistanceKm,
      }
    }
    if (field.display) return fieldOnly()
    const weak = live.filter((c) => c.role === 'mention' && c.display)
    if (weak.length === 1 && weak[0]?.display) {
      return {
        ...base,
        status: 'from_description',
        basis: 'text',
        source: 'description',
        confidence: 'low',
        approximate: true,
        display: weak[0].display,
        district: districtFor(weak[0]),
      }
    }
    return { ...base, noteCode: 'pickup_place_not_stated' }
  }

  // Several pickup-class places: one place when they lie together; else the one that agrees
  // with the field wins, and the rest are alternates (row 8).
  const primary = pickupClass.find((c) => c.strength === 'strong') ?? (pickupClass[0] as Candidate)
  const together = pickupClass.every(
    (c) =>
      c === primary ||
      (c.display && primary.display && c.display.cityPageId === primary.display.cityPageId) ||
      (c.point && primary.point && km(c.point, primary.point) <= t.agreeKm),
  )
  let chosen = primary
  let other: Candidate | null = null
  if (!together) {
    const agreeing = pickupClass.filter((c) => agrees(c, field, t) === true)
    if (agreeing.length === 1 && agreeing[0]) {
      chosen = agreeing[0]
      other = pickupClass.find((c) => c !== chosen) ?? null
    } else if (agreeing.length === 0) {
      const allStrong = pickupClass.every((c) => c.strength === 'strong' && !c.ambiguous)
      if (!allStrong || pass === 'card') {
        return {
          ...fieldOnly(),
          status: 'uncertain',
          confidence: 'low',
          approximate: true,
          conflict: true,
          aiReason: pass === 'detail' ? 'uncertain' : null,
          fieldDistanceKm: primary.fieldDistanceKm,
        }
      }
    } else {
      chosen = agreeing[0] as Candidate
    }
  }

  const agreement = agrees(chosen, field, t)
  const d = chosen.fieldDistanceKm
  const display = chosen.display ?? (agreement === true ? field.display : null)
  const district = districtFor(chosen)
  const alternate: Partial<Decision> = other
    ? { noteCode: 'description_names_other_pickup', notePlaceLabel: other.display?.label ?? null }
    : {}

  if (agreement === true) {
    return {
      ...base,
      status: 'confirmed',
      basis: 'text',
      source: 'both',
      confidence: 'high',
      conflict: false,
      approximate: display?.point === null,
      display,
      district,
      fieldDistanceKm: d,
      ...alternate,
    }
  }
  if (agreement === null) {
    // No distance to measure: the field or the place has no point. A field label that names
    // another page is a recorded disagreement, shown approximate.
    const differs = field.label !== null && !samePage(chosen, field)
    return {
      ...base,
      status: 'from_description',
      basis: 'text',
      source: 'description',
      confidence: differs ? 'medium' : 'low',
      conflict: differs,
      approximate: true,
      display,
      district,
      noteCode: differs ? 'description_says_collection_from' : null,
      notePlaceLabel: differs ? (display?.label ?? null) : null,
      listedInLabel: differs ? field.label : null,
      ...alternate,
    }
  }
  if (d !== null && d <= t.conflictKm) {
    return {
      ...base,
      status: 'from_description',
      basis: 'text',
      source: 'description',
      confidence: 'medium',
      conflict: true,
      approximate: display?.point === null,
      display,
      district,
      noteCode: 'description_says_collection_from',
      notePlaceLabel: display?.label ?? null,
      listedInLabel: field.label,
      fieldDistanceKm: d,
    }
  }
  if (chosen.strength === 'strong' && !chosen.ambiguous && pass === 'detail') {
    return {
      ...base,
      status: 'conflicting',
      basis: 'text',
      source: 'description',
      confidence: 'low',
      conflict: true,
      approximate: true,
      display,
      district,
      noteCode: 'listed_in',
      notePlaceLabel: field.label,
      listedInLabel: field.label,
      fieldDistanceKm: d,
    }
  }
  return {
    ...fieldOnly(),
    status: 'uncertain',
    confidence: 'low',
    conflict: true,
    approximate: true,
    aiReason: pass === 'detail' ? 'uncertain' : null,
    fieldDistanceKm: d,
  }
}

// --- Handover ----------------------------------------------------------------------------------

const FIELD_COLLECTION = /IN_PERSON|COLLECT|PICKUP|LOCAL/i
const FIELD_POSTAGE = /SHIP|POST|DELIVER|COURIER/i

const TEXT = {
  collectionYes:
    /\b(collect(ion|ed)?\s*(only|available|welcome|possible|preferred)|for\s+collection|pick\s*-?\s*up\s*(only|available|welcome)|can\s+(be\s+)?collect(ed)?|cash\s+on\s+collection)\b/i,
  collectionNo:
    /\b(no\s+collection|collection\s+(is\s+)?not\s+(possible|available|an\s+option)|cannot\s+(be\s+)?collect(ed)?|can'?t\s+(be\s+)?collect(ed)?)\b/i,
  postageOnly:
    /\b(post(age|ing|al)?\s+only|only\s+post(ing|age)?|shipping\s+only|will\s+only\s+post|postage\s+is\s+the\s+only)\b/i,
  deliveryOnly: /\b(delivery\s+only|only\s+deliver(y)?|will\s+only\s+deliver)\b/i,
  courierOnly:
    /\b(courier\s+(delivery\s+)?only|can\s+only\s+send\s+by\s+courier|only\s+(by|via)\s+courier)\b/i,
  postage:
    /\b((can|will|happy\s+to|able\s+to)\s+(post|ship|send)|post(age|ing)?\s+(is\s+)?(available|possible|extra|at\s+cost|\+|£)|can\s+be\s+(posted|shipped|sent)|shipping\s+available|royal\s+mail|tracked\s+delivery|special\s+delivery)\b/i,
  localDelivery:
    /\b((can|will|happy\s+to|able\s+to)\s+deliver|local\s+delivery|delivery\s+(is\s+)?(available|possible|extra|for\s+fuel|at\s+cost)|free\s+delivery\s+within)\b/i,
  meetup:
    /\b((can|happy\s+to|will|able\s+to)\s+meet|meet\s*-?\s*up|meet\s+(in|at|halfway|half\s+way|somewhere))\b/i,
}

/** The handover facts: structured field first, the text adds and never overrides (draft §2.4). */
export function handoverFrom(
  deliveryTypes: readonly string[],
  text: string,
): PickupLocationHandover {
  const fieldCollection = deliveryTypes.some((d) => FIELD_COLLECTION.test(d))
  const fieldPostage = deliveryTypes.some((d) => FIELD_POSTAGE.test(d))
  const out: PickupLocationHandover = {
    collection: fieldCollection ? 'yes' : 'unknown',
    meetupOffered: TEXT.meetup.test(text),
    localDelivery: 'none',
    postage: fieldPostage ? 'field' : 'none',
    deliveryOnlyText: TEXT.deliveryOnly.test(text),
    postageOnlyText: TEXT.postageOnly.test(text),
    courierOnlyText: TEXT.courierOnly.test(text),
  }
  if (out.collection === 'unknown') {
    if (TEXT.collectionYes.test(text)) out.collection = 'yes'
    else if (TEXT.collectionNo.test(text)) out.collection = 'no'
  }
  if (
    out.postage === 'none' &&
    (TEXT.postage.test(text) || out.postageOnlyText || out.courierOnlyText)
  ) {
    out.postage = 'text'
  }
  if (TEXT.localDelivery.test(text) || out.deliveryOnlyText) out.localDelivery = 'text'
  return out
}

// --- Versions and keys -------------------------------------------------------------------------

/** The rule version: the cues, the stop-list and the thresholds, hashed. */
export function ruleVersion(t: Thresholds): string {
  const body = JSON.stringify({
    cues: CUES.map((c) => [c.role, c.strength, c.before?.source ?? '', c.after?.source ?? '']),
    stop: STOP_LIST,
    text: Object.values(TEXT).map((r) => r.source),
    t,
  })
  return `r1.${createHash('sha256').update(body).digest('hex').slice(0, 8)}`
}

/** The event key of one batch: the version and the versions it covers, hashed. */
export function batchKey(
  type: 'resolved' | 'changed',
  version: string,
  rows: readonly { listingId: string; evidenceHash: string }[],
  i: number,
): string {
  const body = rows
    .map((r) => `${r.listingId}@${r.evidenceHash}`)
    .sort()
    .join(',')
  const digest = createHash('sha256').update(`${version}|${body}`).digest('hex').slice(0, 16)
  return `pickup-location.${type}:${version}:${digest}:${i}`
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
